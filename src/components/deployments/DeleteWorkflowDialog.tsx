'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
      await onConfirm(workflow.id);
      setConfirmationText('');
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
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Delete Workflow
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Trash2 className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="text-red-800 font-medium">
                    This action cannot be undone!
                  </p>
                  <p className="text-red-700 text-sm">
                    You are about to permanently delete:
                  </p>
                  <ul className="text-red-700 text-sm space-y-1 ml-2">
                    <li>
                      • Workflow: <strong>&quot;{workflow.name}&quot;</strong>
                    </li>
                    <li>• All execution history and logs</li>
                    <li>• All workflow versions</li>
                    <li>• All associated data</li>
                  </ul>
                </div>
              </div>
            </div>

            {workflow.total_executions > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-amber-800 text-sm">
                  <strong>Warning:</strong> This workflow has{' '}
                  <strong>{workflow.total_executions} execution(s)</strong> that
                  will be permanently deleted.
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
                      ? 'border-green-500 focus:ring-green-500'
                      : 'border-red-500 focus:ring-red-500'
                    : ''
                }`}
                disabled={isDeleting}
              />
              {confirmationText.length > 0 && !isConfirmationValid && (
                <p className="text-xs text-red-600">
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
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!isConfirmationValid || isDeleting}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
          >
            {isDeleting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Deleting...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Workflow
              </div>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
