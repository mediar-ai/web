'use client';

import ScreenshotView from '@/components/low-level/ScreenshotView';
import UITreeTimeline from '@/components/low-level/UITreeTimeline';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUser } from '@/context/UserContext';
import type { LowLevelEvent } from '@/types';
import {
  ColumnDef,
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { AlertCircle, ArrowUpDown, ChevronDown, ChevronUp, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { createRef, RefObject, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateRange } from 'react-day-picker';

import { AnalysisDisplay } from '@/components/workflow-analysis';
import { FlattenedWorkflowAnalysis } from '@/types';

// Use the flattened type for backward compatibility
type WorkflowStepAnalysis = FlattenedWorkflowAnalysis;

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

type FetchedEventData = {
    low_level_workflow_analysis_id: string;
    generated_output: string;
    feedback: 'good' | 'bad' | 'irrelevant' | null;
    feedback_reason: string | null;
}

type EventFeedbackData = {
    generated_output: string;
    feedback: 'good' | 'bad' | 'irrelevant' | null;
    feedback_reason: string | null;
}

type WorkflowLabelData = {
    low_level_workflow_analysis_id: number;
    selected_labels: string[];
    suggested_labels: string[] | null;
    created_at: string;
}

type ProcessingMode = 'unprocessed' | 'all' | 'range';

interface GenericEvent {
   
  [key: string]: any;
}

type LabelingPageEventPayload = {
  payload?: {
    timestamp?: string;
    type?: string;
    event?: GenericEvent;
  }
}

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as LabelingPageEventPayload;
  return payload?.payload?.timestamp || event.created_at;
};

export default function LabelingPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { setUserId } = useUser();
  const [allEvents, setAllEvents] = useState<LowLevelEvent[]>([]);
  const [allWorkflowAnalyses, setAllWorkflowAnalyses] = useState<WorkflowStepAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [userSelections, ] = useState<Record<string, string[]>>({});
  const [isProcessingLabels, setIsProcessingLabels] = useState(false);
  const [processingRowId, setProcessingRowId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro'); // 🔥 Updated to stable Vertex AI model name
  const [selectedEvent, setSelectedEvent] = useState<LowLevelEvent | null>(null);

  // -- New state for event generation and feedback --
  const [workflowEvents, setWorkflowEvents] = useState<Record<string, EventFeedbackData>>({});
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [currentFeedbackTarget, setCurrentFeedbackTarget] = useState<{analysisId: string, feedback: 'good' | 'bad' | 'irrelevant'} | null>(null);

  // -- New state for advanced batch processing --
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('unprocessed');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);

  // -- New state for table row refs --
  const [rowRefs, setRowRefs] = useState<Record<string, RefObject<HTMLTableRowElement>>>({});

  // -- New state for collapsing screenshot --
  const [isScreenshotCollapsed, setIsScreenshotCollapsed] = useState(false);
  const originalSelectedEvent = useMemo(() => selectedEvent, [selectedEvent]);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setUserId(userId);
  }, [userId, setUserId]);

  const fetchAllEvents = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/low-level/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      return data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(getEventTimestamp(a)).getTime() - new Date(getEventTimestamp(b)).getTime());
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

  const fetchEventData = useCallback(async () => {
    if (!userId) return;
    try {
      // Fetch from workflow labeling table first (where the actual annotations are)
      const labelingResponse = await fetch(`/api/fetch-llm-labels?userId=${userId}`);
      if (!labelingResponse.ok) throw new Error('Failed to fetch workflow labeling data');
      const labelingData = await labelingResponse.json();
      
      const eventMap: Record<string, EventFeedbackData> = {};
      
             // Process workflow labels first
       labelingData.labels.forEach((label: WorkflowLabelData) => {
          const analysisId = String(label.low_level_workflow_analysis_id);
          if (label.selected_labels && label.selected_labels.length > 0) {
              eventMap[analysisId] = {
                  generated_output: label.selected_labels.join('; '), // Join multiple labels
                  feedback: null, // Will be populated from dataset entries if available
                  feedback_reason: null
              };
          }
      });
      
      // Then fetch any existing feedback from dataset entries
      try {
        const response = await fetch(`/api/get-dataset-entries?userId=${userId}&datasetType=workflow_event_feedback`);
        if (response.ok) {
          const data = await response.json();
          data.entries.forEach((entry: FetchedEventData) => {
              const analysisId = String(entry.low_level_workflow_analysis_id);
              if (eventMap[analysisId]) {
                  // Update existing entry with feedback data
                  eventMap[analysisId].feedback = entry.feedback;
                  eventMap[analysisId].feedback_reason = entry.feedback_reason;
                  // Use dataset generated_output if it exists, otherwise keep the labels
                  if (entry.generated_output) {
                      eventMap[analysisId].generated_output = entry.generated_output;
                  }
              } else {
                  // Create new entry from dataset
                  eventMap[analysisId] = {
                      generated_output: entry.generated_output,
                      feedback: entry.feedback,
                      feedback_reason: entry.feedback_reason
                  };
              }
          });
        }
      } catch (datasetErr) {
        console.warn("Could not fetch dataset entries, continuing with workflow labels only:", datasetErr);
      }
      
      setWorkflowEvents(eventMap);
    } catch (err) {
      console.error("Failed to fetch event data:", err);
    }
  }, [userId]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      const [events, analyses] = await Promise.all([
        fetchAllEvents(),
        fetchAllWorkflowAnalyses(),
        fetchEventData(),
      ]);
      const sortedEvents = events?.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(getEventTimestamp(a)).getTime() - new Date(getEventTimestamp(b)).getTime()) || [];
      setAllEvents(sortedEvents);
      setAllWorkflowAnalyses(analyses || []);
      
      const uiTrees = sortedEvents.filter((e: LowLevelEvent) => e.payload.payload?.type === 'ui_tree');
      if (uiTrees.length > 0) {
        setSelectedEvent(uiTrees[uiTrees.length - 1]);
      }
      setLoading(false);
    };
    fetchData();
  }, [fetchAllEvents, fetchAllWorkflowAnalyses, fetchEventData]);
  
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
      // Use direct ID matching via source_ui_tree_event_id for reliable linking
      const currentUiTreeEvent = uiTreeEvents.find(e => e.id === analysis.source_ui_tree_event_id);

      if (currentUiTreeEvent) {
        const currentIndex = uiTreeEvents.findIndex(e => e.id === currentUiTreeEvent.id);
        const previousUiTreeEvent = currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;

        const eventsBetween = previousUiTreeEvent ? allEvents.filter(event => {
          const eventTimestamp = new Date(getEventTimestamp(event)).getTime();
          const prevTimestamp = new Date(getEventTimestamp(previousUiTreeEvent!)).getTime();
          const currentEventTimestamp = new Date(getEventTimestamp(currentUiTreeEvent)).getTime();
          const isRelevant = event.payload.payload?.type !== 'ui_tree' && event.payload.payload?.type !== 'screenshot_diff';
          return isRelevant && eventTimestamp > prevTimestamp && eventTimestamp < currentEventTimestamp;
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

  useEffect(() => {
    setRowRefs(prevRefs =>
      tableData.reduce((acc, value) => {
        acc[value.id] = prevRefs[value.id] || createRef();
        return acc;
      }, {} as Record<string, RefObject<HTMLTableRowElement>>)
    );
  }, [tableData]);

  useEffect(() => {
    if (selectedEvent) {
        // Use direct ID matching via source_ui_tree_event_id for reliable linking
        const analysis = allWorkflowAnalyses.find(a => a.source_ui_tree_event_id === selectedEvent.id);
        if (analysis && rowRefs[analysis.id]) {
            rowRefs[analysis.id].current?.scrollIntoView({
                behavior: 'smooth',
                block: 'end',
            });
        }
    }
  }, [selectedEvent, allWorkflowAnalyses, rowRefs]);

  const saveEventAndFeedback = useCallback(async (
      analysisId: string, 
      generated_output: string, 
      feedback: 'good' | 'bad' | 'irrelevant' | null,
      feedback_reason: string | null
    ) => {
    await fetch('/api/save-dataset-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId,
            datasetType: 'workflow_event_feedback',
            low_level_workflow_analysis_id: analysisId,
            generated_output,
            feedback,
            feedback_reason,
        }),
    });
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
        const response = await fetch('/api/generate-workflow-event', {
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
            const summary = result.step_summary || '';
            setWorkflowEvents(prev => ({ ...prev, [targetRow.id]: { generated_output: summary, feedback: null, feedback_reason: null } }));
            saveEventAndFeedback(targetRow.id, summary, null, null);
        }
    } catch (error) {
        console.error(`Failed to process event for row ${targetRow.id}:`, error);
    } finally {
        setProcessingRowId(null);
    }
  }, [tableData, selectedModel, saveEventAndFeedback]);

  const rowsToProcess = useMemo(() => {
    switch(processingMode) {
      case 'all':
        return tableData;
      case 'range':
        if (!dateRange?.from || !dateRange?.to) return [];
        return tableData.filter(row => {
          const rowDate = new Date(row.timestamp);
          return rowDate >= dateRange.from! && rowDate <= dateRange.to!;
        });
      case 'unprocessed':
      default:
        return tableData.filter(row => !workflowEvents[row.id]?.generated_output);
    }
  }, [processingMode, tableData, dateRange, workflowEvents]);

  const handleProcessWorkflowLabels = async () => {
    setIsOptionsModalOpen(false);
    setIsProcessingLabels(true);

    const batchSize = 20;
    const batches = [];
    for (let i = 0; i < rowsToProcess.length; i += batchSize) {
        batches.push(rowsToProcess.slice(i, i + batchSize));
    }
    setTotalBatches(batches.length);

    for (let i = 0; i < batches.length; i++) {
        setCurrentBatch(i + 1);
        const batch = batches[i];
        console.log(`Processing batch ${i + 1} of ${batches.length}...`);

        const promises = batch.map(targetRow => {
            if (workflowEvents[targetRow.id]?.generated_output) {
                return Promise.resolve(); // Skip already processed items
            }

            const originalIndex = tableData.findIndex(row => String(row.id) === String(targetRow.id));
            const startIndex = Math.max(0, originalIndex - 10);
            const endIndex = Math.min(tableData.length, originalIndex + 11);
            const neighborAnalyses = tableData.slice(startIndex, endIndex).filter(row => row.id !== targetRow.id);

            return fetch('/api/generate-workflow-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: selectedModel,
                    context: {
                        targetAnalysis: targetRow.analysis,
                        neighborAnalyses: neighborAnalyses,
                    },
                }),
            }).then(async response => {
                if (response.ok) {
                    const result = await response.json();
                    const summary = result.step_summary || '';
                    
                    setWorkflowEvents(prev => ({ ...prev, [targetRow.id]: { generated_output: summary, feedback: null, feedback_reason: null } }));
                    await saveEventAndFeedback(targetRow.id, summary, null, null);
                } else {
                    console.error(`Failed to process event for row ${targetRow.id}:`, await response.text());
                }
            }).catch(error => {
                console.error(`Error in fetch for row ${targetRow.id}:`, error);
            });
        });

        await Promise.all(promises);
    }

    setIsProcessingLabels(false);
    setCurrentBatch(0);
    setTotalBatches(0);
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
    if (!currentFeedbackTarget) return;
    const { analysisId, feedback } = currentFeedbackTarget;
    const eventData = workflowEvents[analysisId];

    setWorkflowEvents(prev => ({ ...prev, [analysisId]: { ...eventData, feedback, feedback_reason: feedbackReason } }));
    saveEventAndFeedback(analysisId, eventData.generated_output, feedback, feedbackReason);

    // Reset feedback state
    setIsFeedbackModalOpen(false);
    setFeedbackReason('');
    setCurrentFeedbackTarget(null);
  };

  const uiTreeEvents = useMemo(() => {
    return allEvents.filter(e => e.payload.payload?.type === 'ui_tree');
  }, [allEvents]);

  const selectedAnalysis = useMemo(() => {
      if (!selectedEvent || !allWorkflowAnalyses) return null;
      const eventTime = new Date(selectedEvent.created_at).getTime();
      return allWorkflowAnalyses.find(a => Math.abs(new Date(a.client_timestamp).getTime() - eventTime) < 1000) || null;
  }, [selectedEvent, allWorkflowAnalyses]);



  const relevantScreenshotDiff = useMemo(() => {
    if (!selectedEvent) return null;
    const targetTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
    
    // Time bounds: 2 seconds before, 1 second after
    const beforeBound = targetTimestamp - (2 * 1000); // 2 seconds before
    const afterBound = targetTimestamp + (1 * 1000);  // 1 second after
    
    // Find screenshot_diff events within time bounds
    const candidateEvents = allEvents.filter(event => {
        if (event.payload.payload?.type !== 'screenshot_diff') return false;
        const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
        if (!afterTimestamp) return false;
        
        const afterTime = new Date(afterTimestamp).getTime();
        return afterTime >= beforeBound && afterTime <= afterBound;
    });
    
    // Find the one with after_timestamp closest to the UI tree timestamp
    let closestEvent = null;
    let smallestTimeDiff = Infinity;
    
    for (const event of candidateEvents) {
        const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
        if (afterTimestamp) {
            const afterTime = new Date(afterTimestamp).getTime();
            const timeDiff = Math.abs(afterTime - targetTimestamp);
            if (timeDiff < smallestTimeDiff) {
                smallestTimeDiff = timeDiff;
                closestEvent = event;
            }
        }
    }
    
    return closestEvent;
  }, [allEvents, selectedEvent]);
  
  const afterScreenshotDataUrl = relevantScreenshotDiff?.payload.payload?.event.screenshot_diff?.after || null;

  const handleOutputChange = (analysisId: string, newOutput: string) => {
    setWorkflowEvents(prev => ({
        ...prev,
        [analysisId]: {
            ...prev[analysisId],
            generated_output: newOutput,
        }
    }));
  };
  
  const handleSaveOutput = useCallback((analysisId: string) => {
      const eventData = workflowEvents[analysisId];
      if(eventData) {
          saveEventAndFeedback(analysisId, eventData.generated_output, eventData.feedback, eventData.feedback_reason);
      }
  }, [workflowEvents, saveEventAndFeedback]);

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
          const { timestamp, contextSummary } = row.original;
          return (
            <div className="flex flex-col h-full justify-between">
              <div>
                <div className="font-medium">{new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</div>
                <div className="text-sm text-muted-foreground">
                  <strong>{contextSummary.windowTitle}</strong> ({contextSummary.eventCount} events)
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleProcessSingleRow(row.original)}
                disabled={isProcessingLabels || !!processingRowId}
                className="mt-2 w-full"
              >
                {processingRowId === row.original.id ? (
                  <><RefreshCw className="h-4 w-4 animate-spin mr-2" />Processing...</>
                ) : (
                  'Re-process'
                )}
              </Button>
            </div>
          );
        },
        size: 300,
      },
      {
        accessorKey: 'analysis',
        header: 'LLM Output',
        cell: ({ row }) => {
            const analysis = row.original.analysis;
            return <AnalysisDisplay analysis={analysis} format="compact" />;
        },
        size: 600,
      },
      {
        accessorKey: 'userSelection',
        header: () => <div className="whitespace-normal break-words">Step annotation (generated)</div>,
        cell: ({ row }) => {
            const analysisId = row.original.id;
            const eventData = workflowEvents[analysisId];

            const handleFeedbackClick = (feedbackType: 'good' | 'bad' | 'irrelevant') => {
                setCurrentFeedbackTarget({ analysisId, feedback: feedbackType });
                setIsFeedbackModalOpen(true);
            };

            return (
                <div>
                    {eventData?.generated_output ? (
                        <div className="flex flex-col h-full justify-between">
                            <Textarea
                                value={eventData.generated_output}
                                onChange={(e) => handleOutputChange(analysisId, e.target.value)}
                                onBlur={() => handleSaveOutput(analysisId)}
                                className="text-sm border-0 focus-visible:ring-1 p-0 h-auto resize-none"
                                rows={3}
                            />
                            <div className="flex items-center justify-end space-x-1 mt-2">
                                <TooltipProvider>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={eventData.feedback === 'good' ? 'default' : 'ghost'} size="icon" className="h-6 w-6" onClick={() => handleFeedbackClick('good')} disabled={eventData.feedback === 'bad' || eventData.feedback === 'irrelevant'}>
                                            <ThumbsUp className={`h-4 w-4 ${eventData.feedback === 'good' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Good</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={eventData.feedback === 'irrelevant' ? 'default' : 'ghost'} size="icon" className="h-6 w-6" onClick={() => handleFeedbackClick('irrelevant')} disabled={eventData.feedback === 'good' || eventData.feedback === 'bad'}>
                                            <AlertCircle className={`h-4 w-4 ${eventData.feedback === 'irrelevant' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Irrelevant</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={eventData.feedback === 'bad' ? 'default' : 'ghost'} size="icon" className="h-6 w-6" onClick={() => handleFeedbackClick('bad')} disabled={eventData.feedback === 'good' || eventData.feedback === 'irrelevant'}>
                                            <ThumbsDown className={`h-4 w-4 ${eventData.feedback === 'bad' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Bad</TooltipContent></Tooltip>
                                </TooltipProvider>
                            </div>
                        </div>
                    ) : null}
                </div>
            )
        },
        size: 300,
      },
    ],
    [workflowEvents, handleProcessSingleRow, isProcessingLabels, processingRowId, handleSaveOutput]
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

  const handleProcessSelectedEvent = useCallback(() => {
    if (!selectedAnalysis) return;
    const targetRow = tableData.find(row => row.id === selectedAnalysis.id);
    if (targetRow) {
        handleProcessSingleRow(targetRow);
    }
  }, [selectedAnalysis, tableData, handleProcessSingleRow]);

  const handleFeedbackForSelectedEvent = (feedbackType: 'good' | 'bad' | 'irrelevant') => {
    if (!selectedAnalysis) return;
    setCurrentFeedbackTarget({ analysisId: selectedAnalysis.id, feedback: feedbackType });
    setIsFeedbackModalOpen(true);
  };

  const handleDeleteAllEvents = async () => {
    try {
        await fetch('/api/delete-dataset-entries', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                datasetType: 'workflow_event_feedback',
            }),
        });
        // Clear local state to reflect deletion
        setWorkflowEvents({});
    } catch (error) {
        console.error("Failed to delete all events:", error);
    }
  };

  const handleScreenshotWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isScreenshotCollapsed || uiTreeEvents.length === 0) return;

    // Use horizontal scroll delta
    const scrollAmount = e.deltaX;
    
    const currentIndex = selectedEvent ? uiTreeEvents.findIndex(event => event.id === selectedEvent.id) : -1;
    if (currentIndex === -1) return;

    let newIndex = currentIndex;
    if (scrollAmount > 5) { // Threshold to prevent minor jitters
        newIndex = Math.min(uiTreeEvents.length - 1, currentIndex + 1);
    } else if (scrollAmount < -5) {
        newIndex = Math.max(0, currentIndex - 1);
    }

    if (newIndex !== currentIndex) {
        setSelectedEvent(uiTreeEvents[newIndex]);
    }

    // Debounce the return to original selection
    if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
        setSelectedEvent(originalSelectedEvent);
    }, 1500); // Return to original after 1.5 seconds of inactivity
  };

  // Note: Scrollbar stability is now handled globally in globals.css
  // No need for page-specific scrollbar handling

  if (error) {
    return <div className="p-4 text-red-500 font-bold bg-red-50 rounded-md">Error: {error}</div>;
  }

  return (
    <>
      <div 
        className="sticky top-0 bg-background z-10 border-b pb-4"
      >
        {loading ? (
            <div className="py-4 px-2 h-[220px] flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
        ) : (
            <>
                <div className="relative">
                    <div className="max-w-full overflow-hidden min-h-[60px]">
                        {!isScreenshotCollapsed && afterScreenshotDataUrl && (
                            <div className="w-full">
                                <ScreenshotView 
                                  dataUrl={afterScreenshotDataUrl} 
                                  onWheel={handleScreenshotWheelScroll}
                                />
                            </div>
                        )}
                        {!isScreenshotCollapsed && !afterScreenshotDataUrl && (
                            <div className="w-full h-[200px] flex items-center justify-center border border-dashed border-gray-300 rounded-lg">
                                <p className="text-muted-foreground">No screenshot available</p>
                            </div>
                        )}
                    </div>
                    <Button 
                        variant="outline" 
                        size="icon" 
                        className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background shadow-lg z-20"
                        onClick={() => setIsScreenshotCollapsed(!isScreenshotCollapsed)}
                    >
                        {isScreenshotCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                    </Button>
                </div>
                {selectedAnalysis && (
                    <Card className="my-4">
                        <CardContent className="p-1 flex items-center justify-between">
                            {workflowEvents[selectedAnalysis.id] ? (
                                <Textarea
                                    value={workflowEvents[selectedAnalysis.id].generated_output}
                                    onChange={(e) => handleOutputChange(selectedAnalysis.id, e.target.value)}
                                    onBlur={() => handleSaveOutput(selectedAnalysis.id)}
                                    className="text-xl font-semibold border-0 focus-visible:ring-1 flex-grow p-0 h-14 resize-none"
                                    rows={2}
                                />
                            ) : (
                                <p className="text-xl font-semibold text-muted-foreground flex-grow h-14">No event summary generated.</p>
                            )}
                            <div className="flex items-center space-x-2">
                                <TooltipProvider>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={workflowEvents[selectedAnalysis.id]?.feedback === 'good' ? 'default' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleFeedbackForSelectedEvent('good')} disabled={workflowEvents[selectedAnalysis.id]?.feedback === 'bad' || workflowEvents[selectedAnalysis.id]?.feedback === 'irrelevant'}>
                                            <ThumbsUp className={`h-5 w-5 ${workflowEvents[selectedAnalysis.id]?.feedback === 'good' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Good</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={workflowEvents[selectedAnalysis.id]?.feedback === 'irrelevant' ? 'default' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleFeedbackForSelectedEvent('irrelevant')} disabled={workflowEvents[selectedAnalysis.id]?.feedback === 'good' || workflowEvents[selectedAnalysis.id]?.feedback === 'bad'}>
                                            <AlertCircle className={`h-5 w-5 ${workflowEvents[selectedAnalysis.id]?.feedback === 'irrelevant' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Irrelevant</TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild>
                                        <Button variant={workflowEvents[selectedAnalysis.id]?.feedback === 'bad' ? 'default' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleFeedbackForSelectedEvent('bad')} disabled={workflowEvents[selectedAnalysis.id]?.feedback === 'good' || workflowEvents[selectedAnalysis.id]?.feedback === 'irrelevant'}>
                                            <ThumbsDown className={`h-5 w-5 ${workflowEvents[selectedAnalysis.id]?.feedback === 'bad' ? 'text-white' : ''}`} />
                                        </Button>
                                    </TooltipTrigger><TooltipContent>Bad</TooltipContent></Tooltip>
                                </TooltipProvider>
                                <div className="border-l h-6 mx-2" />
                                <Button variant="outline" size="sm" onClick={handleProcessSelectedEvent} disabled={processingRowId === selectedAnalysis.id}>
                                    <RefreshCw className={`h-4 w-4 mr-2 ${processingRowId === selectedAnalysis.id ? 'animate-spin' : ''}`} />
                                    Re-process
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
                <UITreeTimeline
                    uiTreeEvents={uiTreeEvents}
                    selectedEvent={selectedEvent}
                    onEventSelect={setSelectedEvent}
                />
            </>
        )}
      </div>
      <div className="mt-4 px-4">
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
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
                            <DropdownMenuRadioItem value="gemini-2.5-flash">gemini-2.5-flash</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="gemini-2.5-pro">gemini-2.5-pro</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" onClick={() => setIsOptionsModalOpen(true)} disabled={isProcessingLabels}>
                    {isProcessingLabels ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                    {isProcessingLabels ? `Processing Batch ${currentBatch}/${totalBatches}...` : 'Generate All Events'}
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive">Delete All Events</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete all
                                generated workflow event summaries and their feedback for this user.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAllEvents}>Continue</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            <div className="flex items-center space-x-4">
                <div className="text-sm text-muted-foreground ml-4">
                    Total Steps: {tableData.length}
                </div>
                <Input
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-sm"
                />
            </div>
        </div>
      <div className="border rounded-lg overflow-x-auto">
          <Table>
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
                    ref={rowRefs[row.original.id]}
                    data-state={row.getIsSelected() && "selected"}
                    className={selectedAnalysis?.id === row.original.id ? 'bg-muted/50' : ''}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell 
                        key={cell.id} 
                        style={{ width: cell.column.getSize() }}
                        className="whitespace-normal break-words"
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

      <Dialog open={isOptionsModalOpen} onOpenChange={setIsOptionsModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Processing Options</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div className="flex items-center space-x-2">
                    <label className="w-24">Mode:</label>
                    <Select value={processingMode} onValueChange={(value) => setProcessingMode(value as ProcessingMode)}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="unprocessed">Process Unprocessed</SelectItem>
                            <SelectItem value="all">Reprocess All</SelectItem>
                            <SelectItem value="range">Process by Date</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {processingMode === 'range' && (
                    <div className="flex items-center space-x-2">
                        <label className="w-24">Date Range:</label>
                        <DateRangePicker date={dateRange} onDateChange={setDateRange} />
                    </div>
                )}
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleProcessWorkflowLabels} disabled={rowsToProcess.length === 0}>
                    Generate {rowsToProcess.length} Events
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isFeedbackModalOpen} onOpenChange={setIsFeedbackModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Provide Feedback</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                <label htmlFor="feedback-reason" className="text-sm font-medium">
                    Why is this a {currentFeedbackTarget?.feedback === 'good' ? 'good' : currentFeedbackTarget?.feedback === 'bad' ? 'bad' : 'irrelevant'} event? (Optional)
                </label>
                <Textarea 
                    id="feedback-reason"
                    value={feedbackReason}
                    onChange={(e) => setFeedbackReason(e.target.value)}
                    className="mt-2"
                    placeholder="e.g., The event was not relevant to the workflow, The event was perfectly relevant..."
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