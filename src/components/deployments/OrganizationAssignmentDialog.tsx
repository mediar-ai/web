'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
import { Building2, Users, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [initialOrgs, setInitialOrgs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchOrganizationAccess = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}/org-access`);

      if (!response.ok) {
        throw new Error('Failed to fetch organization access');
      }

      const data = await response.json();
      setOrganizations(data.organizations || []);
      const assignedOrgs = data.assignedOrganizations || [];
      setSelectedOrgs(assignedOrgs);
      setInitialOrgs(assignedOrgs);
    } catch (error) {
      console.error('Failed to fetch organization access:', error);
      toast.error('Failed to load organization access');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (open) {
      fetchOrganizationAccess();
    } else {
      // Reset state when dialog closes
      setLoading(true);
      setSaving(false);
      setOrganizations([]);
      setSelectedOrgs([]);
      setInitialOrgs([]);
      setSearchTerm('');
    }
  }, [open, workflowId, fetchOrganizationAccess]);

  const handleSave = async () => {
    if (saving) return; // Prevent double-click

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
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update organization access');
      }

      // Call success callback
      onSuccess?.();
      // Close dialog
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update organization access:', error);
      toast.error('Failed to update organization access');
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

  // Filter and sort organizations
  const filteredOrganizations = organizations
    .filter(org => {
      const searchLower = searchTerm.toLowerCase().trim();
      if (!searchLower) return true;

      return (
        org.name.toLowerCase().includes(searchLower) ||
        org.id.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      // Sort by: 1) Selected first, 2) Alphabetically by name
      const aSelected = selectedOrgs.includes(a.id);
      const bSelected = selectedOrgs.includes(b.id);

      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      return a.name.localeCompare(b.name);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-2 border-black">
        <DialogHeader className="border-b border-gray-200 pb-4">
          <DialogTitle className="text-xl font-mono font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            ASSIGN ORGANIZATIONS
          </DialogTitle>
          <DialogDescription className="font-mono text-sm">
            Select which organizations can access &ldquo;{workflowName}&rdquo;
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

              {/* Search bar */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search organizations by name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border-2 border-black rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black"
                  >
                    <span className="font-mono text-xs">CLEAR</span>
                  </button>
                )}
              </div>

              {searchTerm && filteredOrganizations.length !== organizations.length && (
                <div className="mb-2 text-sm font-mono text-gray-600">
                  Showing {filteredOrganizations.length} of {organizations.length} organizations
                </div>
              )}

              <ScrollArea className="h-[400px] border border-gray-200 rounded-lg p-4">
                <div className="space-y-3">
                  {filteredOrganizations.map(org => {
                    const isSelected = selectedOrgs.includes(org.id);
                    return (
                      <div
                        key={org.id}
                        className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer ${
                          isSelected
                            ? 'border-black bg-gray-50'
                            : 'border-gray-200 hover:border-gray-400'
                        } transition-colors`}
                        onClick={() => handleToggleOrg(org.id)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleOrg(org.id)}
                          className="border-2 border-black"
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor={org.id}
                            className="font-mono text-sm flex items-center gap-2 cursor-pointer"
                          >
                            {org.name}
                          </Label>
                          <div className="text-xs text-gray-500 font-mono mt-1">
                            ID: {org.id}
                          </div>
                        </div>
                        {isSelected && (
                          <Users className="w-4 h-4 text-black" />
                        )}
                      </div>
                    );
                  })}

                  {filteredOrganizations.length === 0 && (
                    <div className="text-center py-8 text-gray-500 font-mono">
                      {searchTerm ? 'No organizations match your search' : 'No organizations available'}
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
            onClick={() => {
              if (!saving) {
                onOpenChange(false);
              }
            }}
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