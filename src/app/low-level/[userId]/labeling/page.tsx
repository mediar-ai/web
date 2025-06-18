'use client';

import { useState, useMemo, useEffect, useCallback, use } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, WrapText, Text } from 'lucide-react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  ColumnSizingState,
} from '@tanstack/react-table';
import { useUser } from '@/context/UserContext';
import type { LowLevelEvent } from '@/types';
import { RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type WorkflowStepAnalysis = {
  id: string; 
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
  client_timestamp: string;
  created_at: string;
};

type TableData = {
  id: string;
  timestamp: Date;
  contextSummary: {
    windowTitle: string;
    eventCount: number;
  };
  analysis: WorkflowStepAnalysis;
  userSelection: string[];
};

type FetchedLabelData = {
    low_level_workflow_analysis_id: number;
    suggested_labels: string[] | null;
    selected_labels: string[] | null;
}

type IndividualFeedback = {
    analysisId: string;
    suggestion: string;
    feedback: 'good' | 'bad';
}

type SavedFeedbackData = {
    feedback: 'good' | 'bad';
    reason: string;
}

export default function LabelingPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { setUserId } = useUser();
  const [allEvents, setAllEvents] = useState<LowLevelEvent[]>([]);
  const [allWorkflowAnalyses, setAllWorkflowAnalyses] = useState<WorkflowStepAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [isWrapped, setIsWrapped] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [userSelections, setUserSelections] = useState<Record<string, string[]>>({});
  const [potentialWorkflows, setPotentialWorkflows] = useState<Record<string, string[]>>({});
  const [isProcessingLabels, setIsProcessingLabels] = useState(false);
  const [processingRowId, setProcessingRowId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro-preview-06-05');

  // -- Feedback state --
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'good' | 'bad' | null>(null);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [currentFeedback, setCurrentFeedback] = useState<IndividualFeedback | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<Record<string, SavedFeedbackData>>({}); // Key: analysisId-suggestion

  useEffect(() => {
    setUserId(userId);
  }, [userId, setUserId]);

  const fetchAllEvents = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/low-level/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      return data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      return [];
    }
  }, [userId]);

  const fetchAllWorkflowAnalyses = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`);
      if (!response.ok) throw new Error('Failed to fetch all workflow analyses');
      const data = await response.json();
      return data.analyses;
    } catch (err) {
      console.error("Failed to fetch all workflow analyses", err);
      return [];
    }
  }, [userId]);

  const fetchLabelingData = useCallback(async () => {
    if (!userId) return;
    try {
        const response = await fetch(`/api/get-workflow-labels?userId=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch labeling data');
        const data = await response.json();
        
        const selections: Record<string, string[]> = {};
        const suggestions: Record<string, string[]> = {};

        data.labels.forEach((label: FetchedLabelData) => {
            const analysisId = String(label.low_level_workflow_analysis_id);
            if (label.selected_labels) {
                selections[analysisId] = label.selected_labels;
            }
            if (label.suggested_labels) {
                suggestions[analysisId] = label.suggested_labels;
            }
        });

        setUserSelections(selections);
        setPotentialWorkflows(suggestions);

        // Fetch feedback data
        const feedbackResponse = await fetch(`/api/get-dataset-entries?userId=${userId}&datasetType=workflow_label_feedback`);
        if (!feedbackResponse.ok) throw new Error('Failed to fetch feedback data');
        const feedbackEntries = await feedbackResponse.json();
        
        const feedbackMap: Record<string, SavedFeedbackData> = {};
        feedbackEntries.entries.forEach((entry: { data: { analysisId: string, suggestion: string, feedback: 'good'|'bad', reason: string } }) => {
            const key = `${entry.data.analysisId}-${entry.data.suggestion}`;
            feedbackMap[key] = { feedback: entry.data.feedback, reason: entry.data.reason };
        });
        setSavedFeedback(feedbackMap);

    } catch (err) {
        console.error("Failed to fetch labeling data:", err);
    }
  }, [userId]);

  useEffect(() => {
    // When the component mounts, fetch all necessary data
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      const [events, analyses] = await Promise.all([
        fetchAllEvents(),
        fetchAllWorkflowAnalyses(),
        fetchLabelingData(),
      ]);
      setAllEvents(events || []);
      setAllWorkflowAnalyses(analyses || []);
      setLoading(false);
    };
    fetchData();
  }, [fetchAllEvents, fetchAllWorkflowAnalyses, fetchLabelingData]);
  
  const tableData = useMemo<TableData[]>(() => {
    if (loading || allEvents.length === 0 || allWorkflowAnalyses.length === 0) {
      return [];
    }
    
    const uiTreeEvents = allEvents.filter(e => e.payload.payload?.type === 'ui_tree');

    const getEventTitle = (event: LowLevelEvent) => {
      const payload = event.payload as { payload?: { event?: { app_name?: string, screen?: { ui_tree?: string } } } };
      const appName = payload?.payload?.event?.app_name || 'Unknown App';
      const uiTree = payload?.payload?.event?.screen?.ui_tree;
      if (uiTree) {
        try {
          const parsedTree = JSON.parse(uiTree);
          return parsedTree.attributes?.name || appName;
        } catch {
          return appName;
        }
      }
      return appName;
    };

    const data = allWorkflowAnalyses.reduce<TableData[]>((acc, analysis) => {
      const eventTime = new Date(analysis.client_timestamp).getTime();
      const currentUiTreeEvent = uiTreeEvents.find(e => Math.abs(new Date(e.created_at).getTime() - eventTime) < 1000);

      if (currentUiTreeEvent) {
        const currentIndex = uiTreeEvents.findIndex(e => e.id === currentUiTreeEvent.id);
        const previousUiTreeEvent = currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;

        const eventsBetween = previousUiTreeEvent ? allEvents.filter(event => {
          const eventTimestamp = new Date(event.created_at).getTime();
          const prevTimestamp = new Date(previousUiTreeEvent!.created_at).getTime();
          const isRelevant = event.payload.payload?.type !== 'ui_tree' && event.payload.payload?.type !== 'screenshot_diff';
          return isRelevant && eventTimestamp > prevTimestamp && eventTimestamp < eventTime;
        }) : [];

        acc.push({
          id: analysis.id,
          timestamp: new Date(analysis.client_timestamp),
          contextSummary: {
            windowTitle: getEventTitle(currentUiTreeEvent),
            eventCount: eventsBetween.length
          },
          analysis: analysis,
          userSelection: userSelections[analysis.id] || [],
        });
      }
      return acc;
    }, []);
    
    return data.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  }, [allWorkflowAnalyses, allEvents, loading, userSelections]);

  const saveLabels = useCallback(async (analysisId: string, suggestions: string[], selections: string[]) => {
      try {
          await fetch('/api/save-workflow-labels', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  userId: userId,
                  analysisId: analysisId,
                  suggestedLabels: suggestions,
                  selectedLabels: selections,
              }),
          });
      } catch (error) {
          console.error("Failed to save labels:", error);
      }
  }, [userId]);

  const handleProcessSingleRow = useCallback(async (targetRow: TableData) => {
    const rowIndex = tableData.findIndex(row => String(row.id) === String(targetRow.id));
    if (rowIndex === -1) {
        console.error("Could not find row in tableData:", targetRow.id);
        return;
    }
    
    setProcessingRowId(targetRow.id);

    const startIndex = Math.max(0, rowIndex - 10);
    const endIndex = Math.min(tableData.length, rowIndex + 11);
    const neighborAnalyses = tableData.slice(startIndex, endIndex).filter(row => row.id !== targetRow.id);

    try {
        const response = await fetch('/api/suggest-workflow-labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: selectedModel,
                context: {
                    targetAnalysis: targetRow.analysis,
                    neighborAnalyses: neighborAnalyses,
                },
            }),
        });

        if (response.ok) {
            const result = await response.json();
            const suggestions = result.workflows || [];
            setPotentialWorkflows(prev => ({ ...prev, [targetRow.id]: suggestions }));
            saveLabels(targetRow.id, suggestions, userSelections[targetRow.id] || []);
        }
    } catch (error) {
        console.error(`Failed to process labels for row ${targetRow.id}:`, error);
    } finally {
        setProcessingRowId(null);
    }
  }, [tableData, selectedModel, saveLabels, userSelections]);

  const handleProcessWorkflowLabels = async () => {
    setIsProcessingLabels(true);
    const rowsToProcess = tableData.filter(row => !potentialWorkflows[row.id] || potentialWorkflows[row.id].length === 0);

    for (let i = 0; i < rowsToProcess.length; i++) {
        const targetRow = rowsToProcess[i];
        const originalIndex = tableData.findIndex(row => String(row.id) === String(targetRow.id));
        const startIndex = Math.max(0, originalIndex - 10);
        const endIndex = Math.min(tableData.length, originalIndex + 11);
        const neighborAnalyses = tableData.slice(startIndex, endIndex).filter(row => row.id !== targetRow.id);

        try {
            const response = await fetch('/api/suggest-workflow-labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: selectedModel,
                    context: {
                        targetAnalysis: targetRow.analysis,
                        neighborAnalyses: neighborAnalyses,
                    },
                }),
            });

            if (response.ok) {
                const result = await response.json();
                const suggestions = result.workflows || [];
                setPotentialWorkflows(prev => ({ ...prev, [targetRow.id]: suggestions }));
                // Save new suggestions to the DB
                saveLabels(targetRow.id, suggestions, userSelections[targetRow.id] || []);
            }
        } catch (error) {
            console.error(`Failed to process labels for row ${targetRow.id}:`, error);
        }
    }
    setIsProcessingLabels(false);
  };
  
  const filteredData = useMemo(() => {
    let searchableData = [...tableData];
    if (searchTerm) {
      searchableData = searchableData.filter(item =>
        Object.values(item.analysis).some(value => 
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        ) ||
        item.contextSummary.windowTitle.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return searchableData;
  }, [tableData, searchTerm]);
  
  const handleSaveFeedback = async () => {
    if (!currentFeedback) return;

    await fetch('/api/save-dataset-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId,
            datasetType: 'workflow_label_feedback',
            data: { ...currentFeedback, reason: feedbackReason },
            notes: `Feedback on suggestion: "${currentFeedback.suggestion}"`,
        }),
    });
    
    const feedbackKey = `${currentFeedback.analysisId}-${currentFeedback.suggestion}`;
    setSavedFeedback(prev => ({ ...prev, [feedbackKey]: { feedback: currentFeedback.feedback, reason: feedbackReason } }));

    // Reset feedback state
    setIsFeedbackModalOpen(false);
    setFeedbackReason('');
    setCurrentFeedback(null);
    setFeedbackType(null);
  };

  const columns = useMemo<ColumnDef<TableData>[]>(
    () => [
      {
        id: 'context',
        header: ({ column }) => (
          <div
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center justify-between cursor-pointer"
          >
            <span className="whitespace-normal break-words">Timestamp & Context</span>
            {column.getIsSorted() === 'desc' ? ' ▼' : column.getIsSorted() === 'asc' ? ' ▲' : <ArrowUpDown className="h-4 w-4 shrink-0" />}
          </div>
        ),
        accessorFn: row => row.timestamp,
        cell: ({ row }) => {
          const { timestamp, contextSummary, id } = row.original;
          const isProcessing = processingRowId === id;
          return (
            <div className="flex flex-col h-full">
                <div className="flex-grow">
                    <div className="font-medium">{(timestamp).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">
                        <strong>{contextSummary.windowTitle}</strong> ({contextSummary.eventCount} events)
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleProcessSingleRow(row.original)}
                    disabled={isProcessingLabels || isProcessing}
                    className="mt-2 w-full"
                >
                    {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                    {isProcessing ? 'Processing...' : 'Re-process'}
                </Button>
            </div>
          );
        },
        size: 125,
      },
      {
        accessorKey: 'analysis',
        header: 'LLM Output',
        cell: ({ row }) => {
            const analysis = row.original.analysis;
            return (
                <div className="space-y-1 text-xs">
                  <p><strong>Workflow:</strong> {analysis.workflow}</p>
                  <p><strong>Step:</strong> {analysis.step}</p>
                  <p><strong>Description:</strong> {analysis.description}</p>
                  <p><strong>Facts:</strong> {analysis.facts}</p>
                  <p><strong>Logic:</strong> {analysis.logic}</p>
                  <p><strong>Tech:</strong> {analysis.tech}</p>
                  <p><strong>Apps:</strong> {analysis.apps}</p>
                  <p><strong>Context:</strong> {analysis.context}</p>
                </div>
            )
        },
        size: 450,
      },
      {
        accessorKey: 'userSelection',
        header: () => <div className="whitespace-normal break-words">Workflow Label (to select)</div>,
        cell: ({ row }) => {
            const analysisId = row.original.id;
            const suggestions = potentialWorkflows[analysisId] || [];
            const selections = userSelections[analysisId] || [];

            if (suggestions.length === 0 && !isProcessingLabels && processingRowId !== analysisId) {
                return null;
            }

            const handleFeedbackClick = (type: 'good' | 'bad', suggestion: string) => {
                setCurrentFeedback({ analysisId, suggestion, feedback: type });
                setFeedbackType(type);
                setIsFeedbackModalOpen(true);
            };

            const handleSelectionChange = (workflow: string) => {
                const newSelections = selections.includes(workflow)
                    ? selections.filter(s => s !== workflow)
                    : [...selections, workflow];
                setUserSelections(prev => ({ ...prev, [analysisId]: newSelections }));
                saveLabels(analysisId, suggestions, newSelections);
            };

            return (
                <div className="space-y-2">
                    {suggestions.map((workflow) => {
                        const feedbackKey = `${analysisId}-${workflow}`;
                        const existingFeedback = savedFeedback[feedbackKey];
                        const isGood = existingFeedback?.feedback === 'good';
                        const isBad = existingFeedback?.feedback === 'bad';

                        return (
                            <div key={workflow} className="flex items-center justify-between space-x-2">
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`${analysisId}-${workflow}`}
                                        checked={selections.includes(workflow)}
                                        onCheckedChange={() => handleSelectionChange(workflow)}
                                    />
                                    <label
                                        htmlFor={`${analysisId}-${workflow}`}
                                        className="text-sm font-medium leading-none"
                                    >
                                        {workflow}
                                    </label>
                                </div>
                                <div className="flex items-center">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button 
                                                    variant={isGood ? 'default' : 'ghost'} 
                                                    size="icon" 
                                                    className="h-6 w-6" 
                                                    onClick={() => handleFeedbackClick('good', workflow)}
                                                    disabled={isBad}
                                                >
                                                    <ThumbsUp className={`h-4 w-4 ${isGood ? 'text-white' : ''}`} />
                                                </Button>
                                            </TooltipTrigger>
                                            {existingFeedback && <TooltipContent>{existingFeedback.reason}</TooltipContent>}
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button 
                                                    variant={isBad ? 'default' : 'ghost'} 
                                                    size="icon" 
                                                    className="h-6 w-6" 
                                                    onClick={() => handleFeedbackClick('bad', workflow)}
                                                    disabled={isGood}
                                                >
                                                    <ThumbsDown className={`h-4 w-4 ${isBad ? 'text-white' : ''}`} />
                                                </Button>
                                            </TooltipTrigger>
                                            {existingFeedback && <TooltipContent>{existingFeedback.reason}</TooltipContent>}
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )
        },
        size: 200,
      },
    ],
    [potentialWorkflows, userSelections, handleProcessSingleRow, saveLabels, savedFeedback]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
  });

  if (error) {
    return <div className="p-4 text-red-500 font-bold bg-red-50 rounded-md">Error: {error}</div>;
  }
  
  return (
    <>
      <div className="">
        <div className="flex items-center justify-end mb-4 space-x-2">
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                      {selectedModel}
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                      value={selectedModel}
                      onValueChange={setSelectedModel}
                  >
                      <DropdownMenuRadioItem value="gemini-2.5-flash-preview-05-20">gemini-2.5-flash-preview-05-20</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="gemini-2.5-pro-preview-06-05">gemini-2.5-pro-preview-06-05</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
              </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={handleProcessWorkflowLabels} disabled={isProcessingLabels}>
              {isProcessingLabels ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {isProcessingLabels ? 'Processing...' : 'Re-process workflow labels'}
          </Button>
          <div className="flex items-center space-x-2">
              <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
              />
              <Button variant="outline" onClick={() => setIsWrapped(!isWrapped)}>
                  {isWrapped ? <Text className="h-4 w-4 mr-2" /> : <WrapText className="h-4 w-4 mr-2" />}
                  {isWrapped ? 'Unwrap Content' : 'Wrap Content'}
              </Button>
          </div>
        </div>
        <div className="border rounded-lg">
          <Table className="w-full">
            <TableHeader>
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <TableHead 
                      key={header.id} 
                      style={{ width: header.getSize() }}
                      className="relative pr-4"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                      <span>Loading data...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell 
                        key={cell.id} 
                        style={{ width: cell.column.getSize() }}
                        className={!isWrapped ? 'truncate' : 'whitespace-normal break-words'}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Dialog open={isFeedbackModalOpen} onOpenChange={setIsFeedbackModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Provide Feedback</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                <label htmlFor="feedback-reason" className="text-sm font-medium">
                    Why is this a {feedbackType} set of suggestions? (Optional)
                </label>
                <Textarea 
                    id="feedback-reason"
                    value={feedbackReason}
                    onChange={(e) => setFeedbackReason(e.target.value)}
                    className="mt-2"
                    placeholder="e.g., The suggestions are too generic, The top suggestion was perfect..."
                />
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleSaveFeedback}>Save Feedback</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
} 