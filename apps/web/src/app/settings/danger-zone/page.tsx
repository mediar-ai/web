'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { DeleteWorkflowDialog } from '@/components/deployments/DeleteWorkflowDialog';
import { useOrganizationList, useUser, useAuth, useOrganization } from '@clerk/nextjs';
import { AlertTriangle, Trash2, Calendar, Activity, Clock } from 'lucide-react';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowWithSettings } from '@/lib/workflow-types';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { toast } from 'sonner';
import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function DangerZoneContent() {
  const { user } = useUser();
  const { userId } = useAuth();
  const { userMemberships } = useOrganizationList();
  const { organization, membership } = useOrganization();
  const posthog = usePostHog();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowWithSettings | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check if user has admin privileges
  const hasMediarEmail = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;

  const isMemberOfMediarOrg = userMemberships?.data?.some(
    membership => MEDIAR_ORG_IDS.includes(membership.organization.id)
  ) || false;

  const isGlobalAdmin = hasMediarEmail || isMemberOfMediarOrg;
  
  // Check if user is admin or owner of their current organization
  const isOrgAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  
  // Allow deletion if user is either a global admin OR an admin/owner of their organization
  const canDelete = isGlobalAdmin || isOrgAdmin;
  
  console.log(`[DangerZone] Permission check:`, {
    hasMediarEmail,
    isMemberOfMediarOrg,
    isGlobalAdmin,
    orgRole: membership?.role,
    isOrgAdmin,
    canDelete,
    organizationId: organization?.id,
    organizationName: organization?.name
  });

  // Fetch workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/list?viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/list';
      const response = await fetch(apiUrl);
      const workflowData = await response.json();
      if (workflowData.success) {
        const sortedWorkflows = (workflowData.workflows || []).sort(
          (a: WorkflowWithSettings, b: WorkflowWithSettings) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateB - dateA; // Most recent first
          }
        );
        setWorkflows(sortedWorkflows);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
      toast.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, [viewOrgId]);

  useEffect(() => {
    if (userId) {
      fetchWorkflows();
    }
  }, [userId, fetchWorkflows]);

  // Handle delete workflow
  const handleDeleteWorkflow = async (workflowId: number) => {
    console.log(`[DangerZone] handleDeleteWorkflow called for workflow ID: ${workflowId}`);
    
    if (!canDelete) {
      console.warn(`[DangerZone] Delete permission denied for workflow ${workflowId}`);
      toast.error('You do not have permission to delete workflows');
      return;
    }

    setIsDeleting(true);
    console.log(`[DangerZone] Starting deletion process for workflow ${workflowId}`);

    try {
      posthog?.capture('danger_zone_delete_workflow', {
        workflow_id: workflowId,
        timestamp: new Date().toISOString(),
      });

      console.log(`[DangerZone] Sending DELETE request to /api/remote-workflows/${workflowId}`);
      const response = await fetch(`/api/remote-workflows/${workflowId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      console.log(`[DangerZone] DELETE response:`, { status: response.status, result });
      
      if (result.success) {
        console.log(`[DangerZone] Workflow ${workflowId} deleted successfully, refreshing workflow list`);
        toast.success('Workflow deleted successfully');
        setDeleteDialogOpen(false);
        setSelectedWorkflow(null);
        fetchWorkflows();
      } else {
        console.error('[DangerZone] Failed to delete workflow:', result.error);
        if (response.status === 403) {
          toast.error('This action requires organization admin privileges');
        } else {
          toast.error(`Failed to delete workflow: ${result.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('[DangerZone] Error deleting workflow:', error);
      toast.error('Error deleting workflow');
    } finally {
      console.log(`[DangerZone] Deletion process completed for workflow ${workflowId}, setting isDeleting=false`);
      setIsDeleting(false);
    }
  };

  const openDeleteDialog = (workflow: WorkflowWithSettings) => {
    setSelectedWorkflow(workflow);
    setDeleteDialogOpen(true);
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds === 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
          <PageHeader
            title="Danger Zone"
            subtitle="Permanently delete workflows and their data"
          />

          {/* Warning Banner */}
          <div className="mb-6 border-2 border-black bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <h2 className="font-mono font-bold text-lg mb-2 uppercase">Warning: Destructive Actions</h2>
                <p className="font-mono text-sm text-gray-600 mb-3">
                  This section contains operations that permanently delete data. These actions cannot be undone.
                </p>
                <ul className="font-mono text-sm text-gray-600 space-y-1">
                  <li>• Deleting a workflow removes all execution history and logs</li>
                  <li>• All workflow versions will be permanently deleted</li>
                  <li>• Scheduled executions will be cancelled</li>
                  <li>• This action requires organization admin or owner privileges</li>
                </ul>
                {!canDelete && (
                  <div className="mt-4 p-3 bg-gray-100 border-2 border-gray-400">
                    <p className="font-mono text-sm font-bold">
                      You do not have permission to delete workflows.
                    </p>
                    <p className="font-mono text-sm text-gray-700 mt-2">
                      {organization ? (
                        <>Your current role in &quot;{organization.name}&quot;: {membership?.role?.replace('org:', '').toUpperCase() || 'MEMBER'}. Only organization admins and owners can delete workflows.</>
                      ) : (
                        <>Please select an organization or contact your organization administrator.</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Workflows List */}
          <div className="space-y-4">
            <h2 className="font-mono font-bold text-sm uppercase">All Workflows</h2>

            {loading ? (
              <div className="border-2 border-black divide-y divide-gray-200">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2 flex-1">
                        <Skeleton className="w-48 h-5" />
                        <Skeleton className="w-64 h-4" />
                      </div>
                      <Skeleton className="w-32 h-10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : workflows.length === 0 ? (
              <div className="border-2 border-dashed border-black p-12 text-center">
                <p className="font-mono text-gray-600">No workflows found</p>
              </div>
            ) : (
              <div className="border-2 border-black divide-y divide-gray-200">
                {workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-mono font-bold text-base">
                            {workflow.name}
                          </h3>
                          {workflow.version_info?.current_version && (
                            <span className="text-xs font-mono text-gray-500">
                              v{workflow.version_info.current_version}
                            </span>
                          )}
                          {workflow.cron_expression && workflow.cron_enabled && (
                            <span className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-2 py-0.5 text-xs font-mono">
                              <Calendar className="w-3 h-3" />
                              Scheduled
                            </span>
                          )}
                        </div>
                        {workflow.description && (
                          <p className="text-sm text-gray-600 mb-3 font-mono">
                            {workflow.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs font-mono text-gray-600">
                          <div className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            <span>{workflow.total_executions || 0} executions</span>
                          </div>
                          {workflow.current_version_stats?.average_duration_seconds !== undefined && (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>Avg: {formatDuration(workflow.current_version_stats.average_duration_seconds)}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <span>Success Rate: {workflow.current_version_stats?.success_rate?.toFixed(0) || 100}%</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <Button
                          onClick={() => openDeleteDialog(workflow)}
                          disabled={!canDelete}
                          className="bg-white text-black border-2 border-black hover:bg-black hover:text-white"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          DELETE WORKFLOW
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteWorkflowDialog
        workflow={selectedWorkflow}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteWorkflow}
        isDeleting={isDeleting}
      />
    </DashboardLayout>
  );
}

export default function DangerZonePage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto"></div>
        </div>
      </DashboardLayout>
    }>
      <DangerZoneContent />
    </Suspense>
  );
}
