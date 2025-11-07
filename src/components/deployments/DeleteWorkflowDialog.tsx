'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkflowWithSettings } from '@/lib/workflow-types';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface DeleteWorkflowDialogProps {
  workflow: WorkflowWithSettings | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (workflowId: number) => Promise<void>;
  isDeleting: boolean;
}

export function DeleteWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteWorkflowDialogProps) {
  const [confirmationText, setConfirmationText] = useState('');

  const expectedText = workflow?.name || '';
  const isConfirmationValid = confirmationText === expectedText;

  const handleConfirm = async () => {
    if (workflow && isConfirmationValid) {
      console.log(`[DeleteWorkflowDialog] Confirming deletion for workflow ${workflow.id} (${workflow.name})`);
      await onConfirm(workflow.id);
      setConfirmationText('');
      console.log(`[DeleteWorkflowDialog] Deletion completed for workflow ${workflow.id}`);
    } else {
      console.warn(`[DeleteWorkflowDialog] Confirmation invalid or no workflow selected`);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmationText('');
    }
    onOpenChange(newOpen);
  };

  if (!workflow) return null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-black">
            <AlertTriangle className="h-5 w-5" />
            Delete Workflow
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <div className="p-4 bg-gray-100 border-2 border-dashed border-gray-400 rounded-lg">
              <div className="flex items-start gap-2">
                <Trash2 className="h-5 w-5 text-gray-700 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="text-black font-bold">
                    ⚠ Workflow will be archived
                  </p>
                  <p className="text-gray-700 text-sm">
                    This workflow will be moved to the archive:
                  </p>
                  <ul className="text-gray-700 text-sm space-y-1 ml-2">
                    <li>
                      • Workflow: <strong>&quot;{workflow.name}&quot;</strong>
                    </li>
                    <li>• ✓ Execution history preserved</li>
                    <li>• ✓ All workflow versions archived</li>
                    <li>• ✓ Can be restored by admin</li>
                  </ul>
                </div>
              </div>
            </div>

            {workflow.total_executions > 0 && (
              <div className="p-3 bg-gray-50 border border-gray-300 rounded-lg">
                <p className="text-black text-sm">
                  <strong>Note:</strong> This workflow has{' '}
                  <strong>{workflow.total_executions} execution(s)</strong> that
                  will be preserved in the archive.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="confirmation" className="text-sm font-medium">
                Type the workflow name to confirm deletion:
              </Label>
              <Input
                id="confirmation"
                value={confirmationText}
                onChange={e => setConfirmationText(e.target.value)}
                placeholder={expectedText}
                className={`${
                  confirmationText.length > 0
                    ? isConfirmationValid
                      ? 'border-black focus:ring-black border-2'
                      : 'border-gray-400 focus:ring-gray-400 border-dashed'
                    : ''
                }`}
                disabled={isDeleting}
              />
              {confirmationText.length > 0 && !isConfirmationValid && (
                <p className="text-xs text-gray-600">
                  Please type &quot;{expectedText}&quot; exactly
                </p>
              )}
            </div>

            <div className="text-xs text-gray-600">
              <strong>Admin Action:</strong> Only organization administrators
              can delete workflows.
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            onClick={handleConfirm}
            disabled={!isConfirmationValid || isDeleting}
            className="bg-black hover:bg-gray-800 focus:ring-black text-white border-2 border-black"
          >
            {isDeleting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Archiving...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Archive Workflow
              </div>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
