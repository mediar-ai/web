import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SavedSynthesis {
  id: number;
  title: string;
  description?: string;
  processData: {
    context: Record<string, unknown>;
    identifiedWorkflows: string[];
    boundaries: Record<string, unknown>;
    conversation: Array<{ id: string; sender: string; text: string }>;
    results: Array<Record<string, unknown>>;
    fullProcessData: Record<string, unknown>;
  };
  workflowIds: number[];
  modelsUsed: string[];
  totalTokensUsed: number;
  synthesisDuration?: number;
  version: string;
  synthesisStartedAt?: string;
  synthesisCompletedAt?: string;
  createdAt: string;
}

interface SavedSynthesesSectionProps {
  userId: string;
}

export function SavedSynthesesSection({ userId }: SavedSynthesesSectionProps) {
  const [savedSyntheses, setSavedSyntheses] = useState<SavedSynthesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSynthesis, setSelectedSynthesis] = useState<SavedSynthesis | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchSavedSyntheses();
    }
  }, [userId]);

  const fetchSavedSyntheses = async () => {
    try {
      const response = await fetch(`/api/workflows/saved-syntheses?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        setSavedSyntheses(result.data || []);
      } else {
        console.error('Failed to fetch saved syntheses');
      }
    } catch (error) {
      console.error('Error fetching saved syntheses:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (loading) {
    return (
      <div className="w-full p-8 text-center mb-6">
        <Card>
          <CardContent>
            <div className="mb-4 text-left">
              <h3 className="text-lg font-semibold mb-2">Saved Workflow Syntheses</h3>
              <div className="text-center py-8 text-gray-600">Loading saved syntheses...</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (savedSyntheses.length === 0) {
    return null; // Don't show section if no saved syntheses
  }

  return (
    <div className="w-full p-8 text-center mb-6">
      <Card>
        <CardContent>
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <div className="mb-4 text-left">
              <CollapsibleTrigger className="w-full flex items-center justify-between hover:bg-gray-50 p-2 rounded">
                <h3 className="text-lg font-semibold">Saved Workflow Syntheses ({savedSyntheses.length})</h3>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div className="mt-4">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 p-4 bg-white border-b border-black text-sm font-medium text-black">
                    <div className="col-span-4">Title</div>
                    <div className="col-span-2">Created</div>
                    <div className="col-span-2">Workflows</div>
                    <div className="col-span-2">Duration</div>
                    <div className="col-span-2">Model</div>
                  </div>
                  
                  {/* Table Rows */}
                  {savedSyntheses.map((synthesis) => (
                    <div
                      key={synthesis.id}
                      onClick={() => setSelectedSynthesis(synthesis)}
                      className={`grid grid-cols-12 gap-4 p-4 cursor-pointer transition-colors hover:bg-gray-100 border-b border-gray-300 ${
                        selectedSynthesis?.id === synthesis.id 
                          ? 'bg-gray-200 border-black' 
                          : ''
                      }`}
                    >
                      <div className="col-span-4">
                        <div className="font-semibold text-black">{synthesis.title}</div>
                        {synthesis.description && (
                          <div className="text-sm text-gray-600 mt-1">{synthesis.description}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        {formatDate(synthesis.createdAt)}
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        <div>{synthesis.workflowIds.length} workflows</div>
                        <div className="text-xs text-gray-600">{synthesis.processData.identifiedWorkflows.length} identified</div>
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        {formatDuration(synthesis.synthesisDuration)}
                      </div>
                      <div className="col-span-2 text-xs text-black">
                        <div>{synthesis.version}</div>
                        {synthesis.modelsUsed.map(model => (
                          <div key={model} className="text-gray-600">
                            {model.split('-')[0]}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Selected Synthesis Details */}
                  {selectedSynthesis && (
                    <div className="mt-6 border border-black rounded-lg p-4 bg-white">
                      <h4 className="text-lg font-semibold text-black mb-4">
                        {selectedSynthesis.title} - Detailed Steps
                      </h4>
                      
                      <div className="space-y-4">
                        {/* Step 1: Context */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">
                            Step 1: Context & Setup
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            {Object.entries(selectedSynthesis.processData.context).map(([key, value]) => (
                              <div key={key}>
                                <span className="font-medium text-black">{key.replace(/_/g, ' ')}:</span>
                                <p className="text-gray-700 mt-1">{String(value)}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Step 2: Identified Workflows */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">
                            Step 2: Identified Workflows ({selectedSynthesis.processData.identifiedWorkflows.length})
                          </h5>
                          <div className="space-y-2">
                            {selectedSynthesis.processData.identifiedWorkflows.map((workflow, index) => (
                              <div key={index} className="border border-gray-400 rounded px-2 py-1 text-sm text-black">
                                {workflow}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Step 3: Boundaries */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">
                            Step 3: Workflow Boundaries
                          </h5>
                          <div className="space-y-3">
                            {Object.entries(selectedSynthesis.processData.boundaries).map(([workflowName, boundary]) => {
                              const boundaryObj = boundary as Record<string, unknown>;
                              return (
                                <div key={workflowName} className="border-l-4 border-black pl-3">
                                  <div className="font-medium text-black">{workflowName}</div>
                                  <div className="text-sm text-gray-700 mt-1">
                                    <div><strong>Trigger:</strong> {String(boundaryObj?.trigger || 'Not defined')}</div>
                                    <div><strong>Terminator:</strong> {String(boundaryObj?.terminator || 'Not defined')}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Step 4: Review & Edit Synthesized Workflows */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">
                            Step 4: Review & Edit Synthesized Workflows
                          </h5>
                          <div className="space-y-3">
                            {selectedSynthesis.processData.results.length > 0 ? (
                              selectedSynthesis.processData.results.map((workflow: Record<string, unknown>, index: number) => (
                                <div key={index} className="border border-gray-400 rounded p-3">
                                  <div className="font-medium text-black mb-2">Workflow {index + 1}</div>
                                  <div className="text-sm text-gray-700">
                                    {!!(workflow.title && typeof workflow.title === 'string') && (
                                      <div><strong>Title:</strong> {workflow.title}</div>
                                    )}
                                    {!!(workflow.description && typeof workflow.description === 'string') && (
                                      <div><strong>Description:</strong> {workflow.description}</div>
                                    )}
                                    {Array.isArray(workflow.workflow_types) && (
                                      <div><strong>Types:</strong> {workflow.workflow_types.length} workflow types defined</div>
                                    )}
                                    {Array.isArray(workflow.workflow_instances) && (
                                      <div><strong>Instances:</strong> {workflow.workflow_instances.length} instances configured</div>
                                    )}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-gray-600 italic">No synthesized workflows available</div>
                            )}
                          </div>
                        </div>

                        {/* Step 5: Create Timeline Mapping */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">
                            Step 5: Create Timeline Mapping
                          </h5>
                          <div className="space-y-3">
                            <div className="border border-gray-400 rounded p-3">
                              <div className="font-medium text-black mb-2">Synthesis Conversation</div>
                              <div className="text-sm text-gray-700">
                                <div><strong>Messages:</strong> {selectedSynthesis.processData.conversation.length} messages in synthesis conversation</div>
                                {selectedSynthesis.processData.conversation.length > 0 && (
                                  <div className="mt-2 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded text-xs">
                                    {selectedSynthesis.processData.conversation.slice(0, 3).map((msg: Record<string, unknown>, index: number) => (
                                      <div key={index} className="mb-1">
                                        <strong>{String(msg.sender || 'System')}:</strong> {String(msg.text || msg.content || '').substring(0, 100)}...
                                      </div>
                                    ))}
                                    {selectedSynthesis.processData.conversation.length > 3 && (
                                      <div className="text-gray-500">... and {selectedSynthesis.processData.conversation.length - 3} more messages</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="border border-gray-400 rounded p-3">
                              <div className="font-medium text-black mb-2">Timeline Analysis Results</div>
                              <div className="text-sm text-gray-700">
                                <div><strong>Workflows Mapped:</strong> {selectedSynthesis.workflowIds.length} workflows processed</div>
                                <div><strong>Models Used:</strong> {selectedSynthesis.modelsUsed.join(', ')}</div>
                                <div><strong>Total Tokens:</strong> {selectedSynthesis.totalTokensUsed.toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Metadata */}
                        <div className="border border-black rounded-lg p-4 bg-white">
                          <h5 className="font-semibold text-black mb-3">Synthesis Metadata</h5>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="font-medium text-black">Duration:</span>
                              <p className="text-gray-700">{formatDuration(selectedSynthesis.synthesisDuration)}</p>
                            </div>
                            <div>
                              <span className="font-medium text-black">Tokens Used:</span>
                              <p className="text-gray-700">{selectedSynthesis.totalTokensUsed.toLocaleString()}</p>
                            </div>
                            <div>
                              <span className="font-medium text-black">Started:</span>
                              <p className="text-gray-700">
                                {selectedSynthesis.synthesisStartedAt ? formatDate(selectedSynthesis.synthesisStartedAt) : 'Unknown'}
                              </p>
                            </div>
                            <div>
                              <span className="font-medium text-black">Completed:</span>
                              <p className="text-gray-700">
                                {selectedSynthesis.synthesisCompletedAt ? formatDate(selectedSynthesis.synthesisCompletedAt) : 'Unknown'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
} 