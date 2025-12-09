'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkflowWithSettings } from '@/lib/workflow-types';
import { AlertCircle, Check, Loader2, Monitor, Package, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface WorkflowVersion {
  version_number: string;
  is_active: boolean;
  created_at: string;
  execution_count: number;
}

interface Machine {
  id: number;
  name: string;
  status: string;
  mcp_endpoint: string;
  current_load?: number;
  max_concurrent?: number;
}

interface MachineAssignment {
  assignment_id: number;
  machine_id: number;
  assignment_type: 'exclusive';
  priority: number;
  machine_name: string;
}

interface WorkflowSettingsModalProps {
  workflow: WorkflowWithSettings | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdated?: () => void; // Callback to refresh parent data
}

export function WorkflowSettingsModal({ 
  workflow, 
  open, 
  onOpenChange,
  onSettingsUpdated 
}: WorkflowSettingsModalProps) {
  // Version management state
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [activatingVersion, setActivatingVersion] = useState<string | null>(null);

  // Machine assignment state
  const [availableMachines, setAvailableMachines] = useState<Machine[]>([]);
  const [machineAssignments, setMachineAssignments] = useState<MachineAssignment[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [addingAssignment, setAddingAssignment] = useState(false);
  const [removingAssignment, setRemovingAssignment] = useState<number | null>(null);

  // Feedback state
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const loadVersions = useCallback(async () => {
    if (!workflow) return;
    
    setLoadingVersions(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/versions`);
      if (!response.ok) throw new Error(`Failed to load versions: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        setVersions(data.versions || []);
      } else {
        throw new Error(data.error || 'Failed to load versions');
      }
    } catch (error) {
      console.error('Error loading versions:', error);
      setErrorMessage(`Failed to load versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingVersions(false);
    }
  }, [workflow]);

  const loadMachines = useCallback(async () => {
    setLoadingMachines(true);
    try {
      const response = await fetch('/api/machines?status=active&include_load=true');
      if (!response.ok) throw new Error(`Failed to load machines: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        setAvailableMachines(data.machines || []);
      } else {
        throw new Error(data.error || 'Failed to load machines');
      }
    } catch (error) {
      console.error('Error loading machines:', error);
      setErrorMessage(`Failed to load machines: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  const loadMachineAssignments = useCallback(async () => {
    if (!workflow) return;
    
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines`);
      if (!response.ok) throw new Error(`Failed to load machine assignments: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        console.log('🔍 Machine assignments loaded:', data.assignments);
        setMachineAssignments(data.assignments || []);
      } else {
        throw new Error(data.error || 'Failed to load machine assignments');
      }
    } catch (error) {
      console.error('Error loading machine assignments:', error);
      setErrorMessage(`Failed to load machine assignments: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [workflow]);

  // Load data when modal opens
  useEffect(() => {
    if (open && workflow) {
      loadVersions();
      loadMachines();
      loadMachineAssignments();
    }
  }, [open, workflow, loadVersions, loadMachineAssignments, loadMachines]);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (successMessage || errorMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage('');
        setErrorMessage('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, errorMessage]);

  const activateVersion = async (versionNumber: string) => {
    if (!workflow) return;
    
    setActivatingVersion(versionNumber);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/activate/${versionNumber}`, {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error(`Failed to activate version: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Version ${versionNumber} activated successfully`);
        await loadVersions(); // Refresh versions
        onSettingsUpdated?.(); // Notify parent to refresh
      } else {
        throw new Error(data.error || 'Failed to activate version');
      }
    } catch (error) {
      console.error('Error activating version:', error);
      setErrorMessage(`Failed to activate version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setActivatingVersion(null);
    }
  };

  const addMachineAssignment = async () => {
    if (!workflow || !selectedMachineId) return;
    
    setAddingAssignment(true);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_assignments: [
          {
            machine_id: parseInt(selectedMachineId),
            assignment_type: 'exclusive',
            priority: machineAssignments.length + 1,
            conditions: {},
            reason: 'Assigned via UI'
          }
          ]
        })
      });
      
      if (!response.ok) throw new Error(`Failed to add machine assignment: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Machine assignment added successfully`);
        setSelectedMachineId('');
        await loadMachineAssignments(); // Refresh assignments
        onSettingsUpdated?.(); // Notify parent to refresh
      } else {
        throw new Error(data.error || 'Failed to add machine assignment');
      }
    } catch (error) {
      console.error('Error adding machine assignment:', error);
      setErrorMessage(`Failed to add machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setAddingAssignment(false);
    }
  };

  const removeMachineAssignment = async (assignmentId: number) => {
    if (!workflow) return;
    
    console.log('🗑️ Removing assignment ID:', assignmentId);
    setRemovingAssignment(assignmentId);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines?assignment_id=${assignmentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error(`Failed to remove machine assignment: ${response.status}`);
      
      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Machine assignment removed successfully`);
        await loadMachineAssignments(); // Refresh assignments
        onSettingsUpdated?.(); // Notify parent to refresh
      } else {
        throw new Error(data.error || 'Failed to remove machine assignment');
      }
    } catch (error) {
      console.error('Error removing machine assignment:', error);
      setErrorMessage(`Failed to remove machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRemovingAssignment(null);
    }
  };

  const getActiveVersion = () => versions.find(v => v.is_active);
  const getAvailableMachinesForAssignment = () => {
    const assignedMachineIds = machineAssignments.map(a => a.machine_id);
    return availableMachines.filter(m => !assignedMachineIds.includes(m.id));
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto border-black-outline">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Package className="w-6 h-6" />
            {workflow.name}
          </DialogTitle>
          <DialogDescription>Version and machine assignment management</DialogDescription>
        </DialogHeader>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-black rounded-lg">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-green-800">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-black rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-red-800">{errorMessage}</span>
          </div>
        )}

        <div className="space-y-6 mt-6">
          {/* Version Management Section */}
          <Card className="border-black-outline">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Version Management
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingVersions ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading versions...</span>
                </div>
              ) : versions.length === 0 ? (
                <p className="text-muted-foreground py-4">No versions found for this workflow.</p>
              ) : (
                <div className="space-y-2">
                  {/* Active Version */}
                  {getActiveVersion() && (
                    <div className="p-2 bg-black text-white rounded border border-black">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Star className="w-3.5 h-3.5" />
                          <span className="font-medium">v{getActiveVersion()!.version_number}</span>
                        </div>
                        <span className="text-sm">{getActiveVersion()!.execution_count} executions</span>
                      </div>
                    </div>
                  )}

                  {/* Other Versions */}
                  <div className="space-y-1">
                    {versions
                      .filter(v => !v.is_active)
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .slice(0, 8)
                      .map((version) => (
                        <div key={version.version_number} className="flex items-center justify-between p-2 border border-black rounded text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">v{version.version_number}</span>
                            <span className="text-muted-foreground">{version.execution_count} exec</span>
                            <span className="text-muted-foreground">
                              {new Date(version.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <Button
                            variant="black-outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => activateVersion(version.version_number)}
                            disabled={activatingVersion === version.version_number}
                          >
                            {activatingVersion === version.version_number ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              'Activate'
                            )}
                          </Button>
                        </div>
                      ))}
                    {versions.filter(v => !v.is_active).length > 8 && (
                      <div className="text-center text-sm text-muted-foreground pt-1">
                        +{versions.filter(v => !v.is_active).length - 8} more versions
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Machine Assignment Section */}
          <Card className="border-black-outline">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="w-5 h-5" />
                Machine Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current Assignments */}
              {machineAssignments.length > 0 && (
                <div className="space-y-1">
                  <h4 className="font-medium text-sm">Current Assignments</h4>
                  {machineAssignments
                    .sort((a, b) => a.priority - b.priority)
                    .map((assignment) => (
                      <div key={assignment.assignment_id} className="flex items-center justify-between p-2 border border-black rounded text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{assignment.machine_name}</span>
                          <Badge className={assignment.assignment_type === 'exclusive' 
                            ? 'bg-black text-white border border-black text-xs' 
                            : 'bg-white text-black border border-black text-xs'
                          }>
                            {assignment.assignment_type}
                          </Badge>
                        </div>
                        <Button
                          variant="black-outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => removeMachineAssignment(assignment.assignment_id)}
                          disabled={removingAssignment === assignment.assignment_id}
                        >
                          {removingAssignment === assignment.assignment_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    ))}
                </div>
              )}

              {/* Add Assignment */}
              {getAvailableMachinesForAssignment().length > 0 && (
                <div className="space-y-2 pt-3 border-t border-black">
                  <h4 className="font-medium text-sm">Add Assignment</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Select value={selectedMachineId} onValueChange={setSelectedMachineId}>
                      <SelectTrigger className="border-black-outline h-8 text-sm">
                        <SelectValue placeholder="Select machine" />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableMachinesForAssignment().map((machine) => (
                          <SelectItem key={machine.id} value={machine.id.toString()}>
                            <div className="flex items-center gap-2">
                              <span>{machine.name}</span>
                              {machine.current_load !== undefined && machine.max_concurrent && (
                                <span className="text-xs text-muted-foreground">
                                  ({machine.current_load}/{machine.max_concurrent})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex items-center justify-center h-8 px-3 border-2 border-black rounded bg-black text-white text-xs font-mono">
                      EXCLUSIVE
                    </div>

                    <Button
                      variant="black-outline"
                      className="h-8 text-xs"
                      onClick={addMachineAssignment}
                      disabled={!selectedMachineId || addingAssignment}
                    >
                      {addingAssignment ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Add'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {loadingMachines && (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading machines...</span>
                </div>
              )}

              {/* No machines available */}
              {!loadingMachines && availableMachines.length === 0 && (
                <p className="text-muted-foreground py-4">No machines available for assignment.</p>
              )}

              {/* All machines assigned */}
              {!loadingMachines && getAvailableMachinesForAssignment().length === 0 && availableMachines.length > 0 && (
                <p className="text-muted-foreground py-4">All available machines are already assigned to this workflow.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}