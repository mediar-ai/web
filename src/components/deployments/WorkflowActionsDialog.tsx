'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface WorkflowActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'rename' | 'duplicate' | null;
  workflowId: number;
  currentName: string;
  currentDescription?: string;
  onSuccess?: () => void;
}

export function WorkflowActionsDialog({
  open,
  onOpenChange,
  mode,
  workflowId,
  currentName,
  currentDescription,
  onSuccess,
}: WorkflowActionsDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when dialog opens - FIXED: Use useEffect instead of useState
  useEffect(() => {
    if (open) {
      if (mode === 'rename') {
        setName(currentName);
        setDescription(currentDescription || '');
      } else if (mode === 'duplicate') {
        setName(''); // Let user enter their own name
        setDescription(currentDescription || '');
      }
      setError(null);
    }
  }, [open, mode, currentName, currentDescription]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === 'rename') {
        // Call rename API
        const response = await fetch(`/api/workflows/${workflowId}/rename`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: name.trim(), description }),
        });

        const result = await response.json();

        if (result.success) {
          onOpenChange(false);
          if (onSuccess) onSuccess();
        } else {
          setError(result.error || 'Failed to rename workflow');
        }
      } else if (mode === 'duplicate') {
        // Call duplicate API with custom name
        const response = await fetch(`/api/workflows/${workflowId}/duplicate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: name.trim(), description }),
        });

        const result = await response.json();

        if (result.success) {
          onOpenChange(false);
          if (onSuccess) onSuccess();
        } else {
          setError(result.error || 'Failed to duplicate workflow');
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      console.error('Action error:', err);
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'rename' ? 'Rename Workflow' : 'Duplicate Workflow';
  const actionText = mode === 'rename' ? 'Rename' : 'Duplicate';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'rename'
              ? 'Enter a new name for your workflow.'
              : 'Choose a name for the duplicated workflow.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Enter workflow name"
              className={error ? 'border-red-500' : ''}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter workflow description"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              actionText
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}