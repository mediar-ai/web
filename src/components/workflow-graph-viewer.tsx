'use client';

import React, { useMemo, useState, useCallback } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  ConnectionLineType,
  Position,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, Code, AlertCircle, ArrowRight, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// Custom node component for workflow steps
function ActionNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`bg-black text-white border-2 px-4 py-3 rounded-xl min-w-[200px] shadow-sm transition-all cursor-pointer hover:shadow-lg hover:scale-105 ${
        selected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-black'
      }`}
      title={(data.description as string) || (data.label as string)}
    >
      <div className="font-mono font-bold text-sm uppercase">
        {data.label as string}
      </div>
      {(data.description as string | undefined) && (
        <div className="text-xs mt-1 text-gray-300 font-mono line-clamp-2">
          {data.description as string}
        </div>
      )}
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`bg-white text-black border-2 px-4 py-3 rounded-xl min-w-[200px] shadow-sm transition-all cursor-pointer hover:shadow-lg hover:scale-105 ${
        selected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-black'
      }`}
      title={(data.description as string) || (data.label as string)}
    >
      <div className="font-mono font-bold text-sm uppercase">
        {data.label as string}
      </div>
      {(data.description as string | undefined) && (
        <div className="text-xs mt-1 text-gray-600 font-mono line-clamp-2">
          {data.description as string}
        </div>
      )}
    </div>
  );
}

function ErrorHandlerNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`bg-black text-white border-2 border-red-600 px-4 py-3 rounded-xl min-w-[200px] shadow-sm transition-all cursor-pointer hover:shadow-lg hover:scale-105 ${
        selected ? 'ring-2 ring-blue-500' : ''
      }`}
      title={(data.description as string) || (data.label as string)}
    >
      <div className="font-mono font-bold text-sm uppercase flex items-center">
        <span className="mr-2">⚠</span>
        {data.label as string}
      </div>
      {(data.description as string | undefined) && (
        <div className="text-xs mt-1 text-gray-300 font-mono line-clamp-2">
          {data.description as string}
        </div>
      )}
    </div>
  );
}

function StartNode({ data }: NodeProps) {
  return (
    <div className="bg-gray-200 text-black border-2 border-gray-400 px-4 py-2 rounded-full min-w-[120px] text-center shadow-sm">
      <div className="font-mono font-bold text-sm uppercase">
        {data.label as string}
      </div>
    </div>
  );
}

function EndNode({ data }: NodeProps) {
  return (
    <div className="bg-gray-200 text-black border-2 border-gray-400 px-4 py-2 rounded-full min-w-[120px] text-center shadow-sm">
      <div className="font-mono font-bold text-sm uppercase">
        {data.label as string}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  action: ActionNode,
  condition: ConditionNode,
  error_handler: ErrorHandlerNode,
  start: StartNode,
  end: EndNode,
};

interface TypeScriptWorkflowMetadata {
  name: string;
  version: string;
  description?: string;
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    default?: any;
    description?: string;
  }>;
  steps: Array<{
    id: string;
    name: string;
    type: 'action' | 'condition' | 'loop' | 'error_handler';
    description?: string;
    position: { x: number; y: number };
    next?: string[];
    onError?: string;
    onSuccess?: string;
    onFailure?: string;
    condition?: string;
    execute?: string;
    inputs?: string[];
    outputs?: string[];
  }>;
  errorHandlers?: Array<{
    id: string;
    name: string;
    catch?: string[];
  }>;
}

interface WorkflowGraphViewerProps {
  metadata: TypeScriptWorkflowMetadata;
  className?: string;
}

export default function WorkflowGraphViewer({
  metadata,
  className = '',
}: WorkflowGraphViewerProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedStep = useMemo(() => {
    if (!selectedNode || selectedNode === 'start' || selectedNode === 'end')
      return null;
    return metadata.steps.find(step => step.id === selectedNode);
  }, [selectedNode, metadata.steps]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.id === 'start' || node.id === 'end') return;
    setSelectedNode(node.id);
    setDetailsOpen(true);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const generatedNodes: Node[] = [];
    const generatedEdges: Edge[] = [];

    // Add start node
    generatedNodes.push({
      id: 'start',
      type: 'start',
      position: { x: 0, y: 250 },
      data: { label: 'START' },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    // Add workflow steps - horizontal layout
    metadata.steps.forEach((step, index) => {
      const nodeType =
        step.type === 'condition'
          ? 'condition'
          : step.type === 'error_handler'
            ? 'error_handler'
            : 'action';

      generatedNodes.push({
        id: step.id,
        type: nodeType,
        position: { x: 200 + index * 250, y: 250 },
        data: {
          label: step.name,
          description: step.description,
          type: step.type,
          condition: step.condition,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });

      // Connect start node to first step
      if (index === 0) {
        generatedEdges.push({
          id: `start-${step.id}`,
          source: 'start',
          target: step.id,
          type: 'default',
          style: { stroke: '#000', strokeWidth: 2 },
        });
      }

      // Add edges for step connections
      if (step.next && step.next.length > 0) {
        step.next.forEach(nextStepId => {
          generatedEdges.push({
            id: `${step.id}-${nextStepId}`,
            source: step.id,
            target: nextStepId,
            type: 'default',
            style: { stroke: '#000', strokeWidth: 2 },
          });
        });
      }

      // Add conditional edges
      if (step.onSuccess) {
        generatedEdges.push({
          id: `${step.id}-success-${step.onSuccess}`,
          source: step.id,
          target: step.onSuccess,
          type: 'default',
          label: 'True',
          style: { stroke: '#000', strokeWidth: 2 },
        });
      }

      if (step.onFailure) {
        generatedEdges.push({
          id: `${step.id}-failure-${step.onFailure}`,
          source: step.id,
          target: step.onFailure,
          type: 'default',
          label: 'False',
          style: { stroke: '#000', strokeWidth: 2, strokeDasharray: '5,5' },
        });
      }

      // Add error handler edges
      if (step.onError) {
        generatedEdges.push({
          id: `${step.id}-error-${step.onError}`,
          source: step.id,
          target: step.onError,
          type: 'default',
          label: 'On Error',
          style: { stroke: '#DC2626', strokeWidth: 2, strokeDasharray: '5,5' },
        });
      }
    });

    // Add end node
    const lastStep = metadata.steps[metadata.steps.length - 1];
    if (lastStep) {
      const endPosition = {
        x: 200 + metadata.steps.length * 250,
        y: 250,
      };

      generatedNodes.push({
        id: 'end',
        type: 'end',
        position: endPosition,
        data: { label: 'END' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });

      // Connect last step to end (if it doesn't have explicit next steps)
      if (!lastStep.next || lastStep.next.length === 0) {
        generatedEdges.push({
          id: `${lastStep.id}-end`,
          source: lastStep.id,
          target: 'end',
          type: 'default',
          style: { stroke: '#000', strokeWidth: 2 },
        });
      }
    }

    return { nodes: generatedNodes, edges: generatedEdges };
  }, [metadata]);

  return (
    <div
      className={`w-full h-[600px] border-2 border-black bg-white relative ${className}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        connectionLineType={ConnectionLineType.SmoothStep}
        onNodeClick={onNodeClick}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
      >
        <Background color="#000" gap={16} size={1} />
        <Controls className="border-2 border-black bg-white" />
        <MiniMap
          nodeColor={node => {
            switch (node.type) {
              case 'condition':
                return '#FFF';
              case 'error_handler':
                return '#DC2626';
              case 'start':
              case 'end':
                return '#E5E7EB';
              default:
                return '#000';
            }
          }}
          nodeStrokeWidth={2}
          className="border-2 border-black bg-white"
        />
      </ReactFlow>

      {/* Details Panel */}
      {detailsOpen && selectedStep && (
        <div className="absolute top-0 right-0 w-96 h-full bg-white border-l-2 border-black overflow-y-auto z-10 shadow-2xl">
          <Card className="border-0 rounded-none h-full">
            <CardHeader className="bg-black text-white border-b-2 border-black sticky top-0 z-10">
              <div className="flex items-center justify-between">
                <CardTitle className="font-mono text-sm uppercase flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Step Details
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailsOpen(false)}
                  className="text-white hover:bg-gray-800"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {/* Step Name */}
              <div>
                <h3 className="font-mono font-bold text-lg">
                  {selectedStep.name}
                </h3>
                <Badge variant="outline" className="mt-1 font-mono">
                  {selectedStep.type}
                </Badge>
              </div>

              {/* Description */}
              {selectedStep.description && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-1">
                    Description
                  </div>
                  <p className="text-sm">{selectedStep.description}</p>
                </div>
              )}

              {/* Step ID */}
              <div>
                <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-1">
                  Step ID
                </div>
                <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                  {selectedStep.id}
                </code>
              </div>

              {/* Connections */}
              {selectedStep.next && selectedStep.next.length > 0 && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" />
                    Next Steps
                  </div>
                  <div className="space-y-1">
                    {selectedStep.next.map((nextId, idx) => (
                      <div
                        key={idx}
                        className="text-sm bg-gray-100 px-2 py-1 rounded font-mono cursor-pointer hover:bg-gray-200"
                        onClick={() => {
                          setSelectedNode(nextId);
                          const step = metadata.steps.find(
                            s => s.id === nextId
                          );
                          if (!step) setDetailsOpen(false);
                        }}
                      >
                        → {nextId}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Conditional Branches */}
              {selectedStep.onSuccess && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-green-600 mb-1">
                    On Success
                  </div>
                  <div
                    className="text-sm bg-green-50 border border-green-200 px-2 py-1 rounded font-mono cursor-pointer hover:bg-green-100"
                    onClick={() => setSelectedNode(selectedStep.onSuccess!)}
                  >
                    → {selectedStep.onSuccess}
                  </div>
                </div>
              )}

              {selectedStep.onFailure && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-orange-600 mb-1">
                    On Failure
                  </div>
                  <div
                    className="text-sm bg-orange-50 border border-orange-200 px-2 py-1 rounded font-mono cursor-pointer hover:bg-orange-100"
                    onClick={() => setSelectedNode(selectedStep.onFailure!)}
                  >
                    → {selectedStep.onFailure}
                  </div>
                </div>
              )}

              {/* Error Handler */}
              {selectedStep.onError && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-red-600 mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Error Handler
                  </div>
                  <div
                    className="text-sm bg-red-50 border border-red-200 px-2 py-1 rounded font-mono cursor-pointer hover:bg-red-100"
                    onClick={() => setSelectedNode(selectedStep.onError!)}
                  >
                    → {selectedStep.onError}
                  </div>
                </div>
              )}

              {/* Condition Code */}
              {selectedStep.condition && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
                    <Code className="w-3 h-3" />
                    Condition
                  </div>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto font-mono">
                    {selectedStep.condition.length > 200
                      ? `${selectedStep.condition.substring(0, 200)}...`
                      : selectedStep.condition}
                  </pre>
                </div>
              )}

              {/* Execute Code */}
              {selectedStep.execute && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
                    <Code className="w-3 h-3" />
                    Execute Function
                  </div>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto font-mono max-h-48">
                    {selectedStep.execute.length > 300
                      ? `${selectedStep.execute.substring(0, 300)}...`
                      : selectedStep.execute}
                  </pre>
                </div>
              )}

              {/* Inputs */}
              {selectedStep.inputs && selectedStep.inputs.length > 0 && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-1">
                    Input Variables
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedStep.inputs.map((input, idx) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="text-xs font-mono"
                      >
                        {input}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Outputs */}
              {selectedStep.outputs && selectedStep.outputs.length > 0 && (
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-gray-500 mb-1">
                    Output Variables
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedStep.outputs.map((output, idx) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="text-xs font-mono"
                      >
                        {output}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
