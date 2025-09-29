'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Building2, Users, Crown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

interface OrganizationAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: number;
  workflowName: string;
  onSuccess?: () => void;
}

interface Organization {
  id: string;
  name: string;
}

export function OrganizationAssignmentDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  onSuccess,
}: OrganizationAssignmentDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [initialOrgs, setInitialOrgs] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      fetchOrganizationAccess();
    }
  }, [open, workflowId]);

  const fetchOrganizationAccess = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}/org-access`);

      if (!response.ok) {
        throw new Error('Failed to fetch organization access');
      }

      const data = await response.json();
      setOrganizations(data.organizations || []);
      setSelectedOrgs(data.assignedOrganizations || []);
      setInitialOrgs(data.assignedOrganizations || []);
    } catch (error) {
      console.error('Failed to fetch organization access:', error);
      toast({
        title: 'Error',
        description: 'Failed to load organization access',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}/org-access`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationIds: selectedOrgs,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update organization access');
      }

      toast({
        title: 'Success',
        description: 'Organization access updated successfully',
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update organization access:', error);
      toast({
        title: 'Error',
        description: 'Failed to update organization access',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOrg = (orgId: string) => {
    setSelectedOrgs(prev =>
      prev.includes(orgId)
        ? prev.filter(id => id !== orgId)
        : [...prev, orgId]
    );
  };

  const handleSelectAll = () => {
    setSelectedOrgs(organizations.map(org => org.id));
  };

  const handleDeselectAll = () => {
    setSelectedOrgs([]);
  };

  const hasChanges = JSON.stringify(selectedOrgs.sort()) !== JSON.stringify(initialOrgs.sort());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-2 border-black">
        <DialogHeader className="border-b border-gray-200 pb-4">
          <DialogTitle className="text-xl font-mono font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            ASSIGN ORGANIZATIONS
          </DialogTitle>
          <DialogDescription className="font-mono text-sm">
            Select which organizations can access "{workflowName}"
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <div className="text-sm font-mono text-gray-600">
                  {selectedOrgs.length} of {organizations.length} organizations selected
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    className="border border-black hover:bg-black hover:text-white font-mono text-xs"
                  >
                    SELECT ALL
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeselectAll}
                    className="border border-black hover:bg-black hover:text-white font-mono text-xs"
                  >
                    DESELECT ALL
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-[400px] border border-gray-200 rounded-lg p-4">
                <div className="space-y-3">
                  {organizations.map(org => {
                    const isMediar = MEDIAR_ORG_IDS.includes(org.id);
                    return (
                      <div
                        key={org.id}
                        className={`flex items-center space-x-3 p-3 rounded-lg border ${
                          selectedOrgs.includes(org.id)
                            ? 'border-black bg-gray-50'
                            : 'border-gray-200 hover:border-gray-400'
                        } transition-colors cursor-pointer`}
                        onClick={() => handleToggleOrg(org.id)}
                      >
                        <Checkbox
                          checked={selectedOrgs.includes(org.id)}
                          onCheckedChange={() => handleToggleOrg(org.id)}
                          className="border-2 border-black"
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor={org.id}
                            className="font-mono text-sm cursor-pointer flex items-center gap-2"
                          >
                            {org.name}
                            {isMediar && (
                              <Crown className="w-4 h-4 text-black" title="Mediar Organization" />
                            )}
                          </Label>
                          <div className="text-xs text-gray-500 font-mono mt-1">
                            ID: {org.id}
                          </div>
                        </div>
                        {selectedOrgs.includes(org.id) && (
                          <Users className="w-4 h-4 text-black" />
                        )}
                      </div>
                    );
                  })}

                  {organizations.length === 0 && (
                    <div className="text-center py-8 text-gray-500 font-mono">
                      No organizations available
                    </div>
                  )}
                </div>
              </ScrollArea>

              {hasChanges && (
                <div className="mt-4 p-2 bg-yellow-50 border border-yellow-300 rounded text-sm font-mono">
                  You have unsaved changes
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t border-gray-200 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-2 border-black hover:bg-black hover:text-white font-mono"
          >
            CANCEL
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading || !hasChanges}
            className="bg-black text-white hover:bg-gray-800 font-mono"
          >
            {saving ? 'SAVING...' : 'SAVE CHANGES'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}