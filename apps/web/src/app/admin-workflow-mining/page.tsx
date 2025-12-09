'use client';

// This is the main admin dashboard page, accessible at /admin.
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { type UserSessionData } from '@/lib/db';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SignIn, useAuth, useOrganization } from '@clerk/nextjs';
import { ChevronDown, ChevronRight, Pencil, RefreshCw, Trash2 } from 'lucide-react';

// Owner-only components

import RoleManagementSection from '@/components/admin/RoleManagementSection';
import { MediarOrgSwitcher } from '@/components/admin/MediarOrgSwitcher';

const truncateId = (id: string) => `...${id.slice(-4)}`;

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

// Resize handle component
const ResizeHandle = ({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) => (
  <div
    className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500 bg-gray-300 opacity-30 hover:opacity-100 transition-all duration-150"
    onMouseDown={onMouseDown}
    style={{ marginRight: '-2px' }}
    title="Drag to resize column"
  />
);

// Live status pill component for user names
const LiveUserPill = ({ isLive }: { isLive: boolean }) => {
  const [showPill, setShowPill] = useState(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isLive) {
      console.log('[LiveUserPill] User is LIVE - showing pill for 2 minutes');
      setShowPill(true);

      // Clear any existing timer (resets on new activity)
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      // Hide after 2 minutes (timer resets each time user becomes live)
      hideTimerRef.current = setTimeout(() => {
        console.log('[LiveUserPill] 2 minutes elapsed - hiding LIVE pill');
        setShowPill(false);
        hideTimerRef.current = null;
      }, 120000); // 2 minutes = 120,000ms

      return () => {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      };
    }
  }, [isLive]);

  if (!showPill) return null;

  return (
    <div className="absolute -top-1 -right-4 z-20 pointer-events-none animate-bounce-in">
      <div className="bg-green-500 text-white text-xs px-2 py-1 rounded-full shadow-lg border border-green-600 font-medium animate-pulse">
        LIVE
      </div>
    </div>
  );
};

// Floating delta pill component for numbers
const FloatingDelta = ({ value, delay = 0 }: { value: number; delay?: number }) => {
  const [showPill, setShowPill] = useState(false);

  useEffect(() => {
    if (value > 0) {
      console.log('[FloatingDelta] Showing +' + value + ' pill');
      setShowPill(true);

      // Hide after 4 seconds
      const hideTimer = setTimeout(() => {
        console.log('[FloatingDelta] Hiding +' + value + ' pill');
        setShowPill(false);
      }, 4000);

      return () => clearTimeout(hideTimer);
    } else {
      setShowPill(false);
    }
  }, [value]);

  if (value <= 0 || !showPill) return null;

  return (
    <div
      className="absolute -top-1 -right-1 z-20 pointer-events-none animate-bounce-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full shadow-lg border border-green-600 font-medium">
        +{value}
      </div>
    </div>
  );
};

export default function AdminPage() {
  const { isLoaded, userId, has } = useAuth();
  const { organization, membership } = useOrganization();

  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="stable-container py-4">
        <div>Loading...</div>
      </div>
    );
  }

  // Show sign-in if not authenticated
  if (!userId) {
    return (
      <div className="stable-container py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  // Check if user has required role for full access dashboard
  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });
  const hasOwnerRole = has({ role: 'org:owner' });

  // Access level will be determined by the API based on organization_data_access table

  if (!hasAdminRole && !hasMemberRole && !hasOwnerRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="max-w-md w-full space-y-8 text-center border border-black rounded-lg p-8">
          <h2 className="text-2xl font-bold text-black">Access Denied</h2>
          <p className="text-black">You need admin or member privileges to access this dashboard.</p>
          <Link href="/">
            <Button variant="black-outline">Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Pass organization context to the authenticated component
  return (
    <AuthenticatedAdminPage
      isAdmin={hasAdminRole}
      isOwner={hasOwnerRole}
      organizationId={organization?.id}
      organizationName={organization?.name}
      userRole={membership?.role}
    />
  );
}

interface AuthenticatedAdminPageProps {
  isAdmin: boolean;
  isOwner: boolean;
  isGlobalAdmin: boolean;
  organizationId?: string;
  organizationName?: string;
  userRole?: string;
}

function AuthenticatedAdminPage({
  isAdmin,
  isOwner,
  organizationId,
  organizationName,
  userRole
}: Omit<AuthenticatedAdminPageProps, 'isGlobalAdmin'>) {
  const { userId } = useAuth();
  const { organization } = useOrganization();
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState('');
  const [filter, setFilter] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [userToDelete, setUserToDelete] = useState<{id: string, name: string} | null>(null);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState<boolean>(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('org:member');
  const [inviteStatus, setInviteStatus] = useState<{message: string, error: boolean} | null>(null);

  // Column widths state and localStorage persistence
  const defaultColumnWidths = useMemo(() => ({
    user: 300,
    organization: 150,
    ss: 60,
    type: 90,
    events: 80,
    steps: 120,
    annotation: 120,
    workflow: 120,
    duration: 80,
    lastActive: 180,
    actions: 80
  }), []);

  // Live user tracking (users with recent activity)
  const [liveUsers, setLiveUsers] = useState<Set<string>>(new Set());

  // Delta tracking for floating number pills (using refs to avoid re-renders)
  const previousData = useRef<Record<string, {
    events: number;
    steps: number;
    workflows: number;
    processed: number;
    llmLabeled: number;
    humanAnnotated: number;
  }>>({});
  const [deltas, setDeltas] = useState<Record<string, {
    events: number;
    steps: number;
    workflows: number;
    processed: number;
    llmLabeled: number;
    humanAnnotated: number;
  }>>({});

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(defaultColumnWidths);

  // Use refs to avoid stale closures in event handlers
  const resizeState = useRef<{
    isResizing: string | null;
    startX: number;
    startWidth: number;
  }>({
    isResizing: null,
    startX: 0,
    startWidth: 0
  });

  // Load column widths from localStorage on mount
  useEffect(() => {
    const savedWidths = localStorage.getItem('admin-table-column-widths');
    if (savedWidths) {
      try {
        const parsed = JSON.parse(savedWidths);
        setColumnWidths({ ...defaultColumnWidths, ...parsed });
      } catch (error) {
        console.error('Failed to parse saved column widths:', error);
      }
    }
  }, [defaultColumnWidths]);

  // Save column widths to localStorage
  const saveColumnWidths = useCallback((widths: Record<string, number>) => {
    localStorage.setItem('admin-table-column-widths', JSON.stringify(widths));
  }, []);

  // Handle mouse move during resize
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizeState.current.isResizing) return;

    e.preventDefault();
    const deltaX = e.clientX - resizeState.current.startX;
    const newWidth = Math.max(50, resizeState.current.startWidth + deltaX); // Minimum width of 50px

    setColumnWidths(prev => ({
      ...prev,
      [resizeState.current.isResizing!]: newWidth
    }));
  }, []);

  // Handle mouse up to end resize
  const handleMouseUp = useCallback(() => {
    if (resizeState.current.isResizing) {
      setColumnWidths(currentWidths => {
        saveColumnWidths(currentWidths);
        return currentWidths;
      });
      resizeState.current.isResizing = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, [handleMouseMove, saveColumnWidths]);

  // Handle column resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();

    resizeState.current = {
      isResizing: columnKey,
      startX: e.clientX,
      startWidth: columnWidths[columnKey]
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths, handleMouseMove, handleMouseUp]);

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleMouseMove, handleMouseUp]);

  const toggleUserExpansion = (userId: string) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const fetchSessions = useCallback(async () => {
    // Always include orgId - the API will determine access level based on organization_data_access table
    const params = new URLSearchParams({ v: Date.now().toString() });
    if (organizationId) {
      params.append('orgId', organizationId);
    }

    const response = await fetch(`/api/sessions?${params}`);
    const sessionData = await response.json();

    // Detect live users (users with actual data changes = events deltas > 0)
    const newLiveUsers = new Set<string>();

    // Calculate deltas for floating number pills
    const newDeltas: Record<string, {
      events: number;
      steps: number;
      workflows: number;
      processed: number;
      llmLabeled: number;
      humanAnnotated: number;
    }> = {};

    Object.entries(sessionData as Record<string, UserSessionData>).forEach(([userId, userData]) => {
      // Calculate deltas for this user first
      const currentEvents = userData.sessions.reduce((sum: number, s) => sum + (s.eventCount || 0), 0);
      const currentSteps = userData.sessions.reduce((sum: number, s) => sum + (s.total_ui_steps || 0), 0);
      const currentProcessed = userData.sessions.reduce((sum: number, s) => sum + (s.processed_event_count || 0), 0);
      const currentWorkflows = userData.workflowCount || 0;
      const currentLlmLabeled = userData.sessions.reduce((sum: number, s) => sum + (s.llm_labeled_steps || 0), 0);
      const currentHumanAnnotated = userData.sessions.reduce((sum: number, s) => sum + (s.human_annotated_steps || 0), 0);

      const previous = previousData.current[userId];
      if (previous) {
        newDeltas[userId] = {
          events: Math.max(0, currentEvents - previous.events),
          steps: Math.max(0, currentSteps - previous.steps),
          workflows: Math.max(0, currentWorkflows - previous.workflows),
          processed: Math.max(0, currentProcessed - previous.processed),
          llmLabeled: Math.max(0, currentLlmLabeled - previous.llmLabeled),
          humanAnnotated: Math.max(0, currentHumanAnnotated - previous.humanAnnotated),
        };

        // Mark user as LIVE if they have any events increase
        if (newDeltas[userId].events > 0) {
          newLiveUsers.add(userId);
          console.log('[Admin] 🟢 Live user detected (events +' + newDeltas[userId].events + '):', userId, userData.name || 'Unnamed');
        }
      }

      // Update previous data for next comparison
      previousData.current[userId] = {
        events: currentEvents,
        steps: currentSteps,
        workflows: currentWorkflows,
        processed: currentProcessed,
        llmLabeled: currentLlmLabeled,
        humanAnnotated: currentHumanAnnotated,
      };
    });

    // Debug logging for deltas
    const hasAnyDeltas = Object.values(newDeltas).some(delta =>
      delta.events > 0 || delta.steps > 0 || delta.workflows > 0 || delta.processed > 0 || delta.llmLabeled > 0 || delta.humanAnnotated > 0
    );
    if (hasAnyDeltas) {
      console.log('[Admin] 🔥 Number deltas detected:', newDeltas);
    }

    setLiveUsers(newLiveUsers);
    setDeltas(newDeltas);
    setUserSessions(sessionData);

    // Check if this organization has global access by making a simple API call
    if (organizationId) {
      try {
        const accessResponse = await fetch(`/api/organization-access?orgId=${organizationId}`);
        if (accessResponse.ok) {
          const accessData = await accessResponse.json();
          setIsGlobalAdmin(accessData.isGlobal || false);
        }
      } catch (error) {
        console.error('Failed to fetch organization access level:', error);
      }
    }
  }, [organizationId]);

  // Wrapper for live refresh that shows indicator
  const liveRefreshSessions = useCallback(async () => {
    setIsLiveRefreshing(true);
    try {
      await fetchSessions();
    } finally {
      // Keep indicator visible for a short time so users can see it
      setTimeout(() => setIsLiveRefreshing(false), 1000);
    }
  }, [fetchSessions]);

  // Debounced version for manual refresh button clicks and other user actions
  const debouncedFetchSessions = useDebouncedCallback(liveRefreshSessions, 500);

  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      await fetchSessions();
      setLoading(false);
    }

    initialFetch();

    // Set up polling for data updates
    const pollData = () => {
      liveRefreshSessions();
    };

    // Handle visibility changes to adjust polling frequency
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('[Admin] 👁️ Page visible - refreshing immediately');
        pollData();
      }
      console.log(`[Admin] Polling frequency: ${document.hidden ? '30s' : '2s'}`);
    };

    // Set up polling interval - 2s when active, 30s when hidden
    const getInterval = () => document.hidden ? 30000 : 2000;
    let pollingInterval: NodeJS.Timeout;

    const startPolling = () => {
      const poll = () => {
        if (!document.hidden) {
          console.log('[Admin] 🔄 Polling for updates...');
          pollData();
        }
        pollingInterval = setTimeout(poll, getInterval());
      };
      pollingInterval = setTimeout(poll, 2000); // Start after 2s
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('[Admin] [SUCCESS] Intelligent polling enabled - updates every 2s when active, 30s when hidden');

    return () => {
      clearTimeout(pollingInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[Admin] 🛑 Polling stopped');
    };
  }, [fetchSessions, liveRefreshSessions, debouncedFetchSessions]);

  const handleEditName = (userId: string, currentName: string) => {
    setEditingUser(userId);
    setUserNameInput(currentName || '');
  };

  const handleSaveName = async (userId: string) => {
    if (!userNameInput.trim()) return;

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name: userNameInput.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Error updating user name:', error);
        return;
      }

      setEditingUser(null);
      setUserNameInput('');
      await fetchSessions(); // Refresh the user list
    } catch (error) {
      console.error('Error updating user name:', error);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to delete user:', error);
        return;
      }

      setUserToDelete(null);
      await fetchSessions(); // Refresh the user list
    } catch (error) {
      console.error('Failed to delete user:', error);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteStatus({ message: 'Sending invitation...', error: false });

    try {
      // Use Clerk frontend API directly
      await organization?.inviteMember({
        emailAddress: inviteEmail,
        role: inviteRole as 'org:admin' | 'org:member'
      });

      setInviteStatus({ message: `Invitation sent to ${inviteEmail}`, error: false });

      // Close the dialog after a delay
      setTimeout(() => {
        setIsInviteDialogOpen(false);
        setInviteEmail('');
        setInviteRole('org:member');
        setInviteStatus(null);
      }, 2000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send invitation';
      setInviteStatus({ message: errorMessage, error: true });
    }
  };

  // Get access level display text
  const getAccessLevelText = () => {
    if (isGlobalAdmin) {
      return "Mediar Admin - Global Access";
    }
    if (isOwner && organizationName) {
      return `Owner - ${organizationName}`;
    }
    if (isAdmin && organizationName) {
      return `Admin - ${organizationName}`;
    }
    if (organizationName) {
      return `Member - ${organizationName}`;
    }
    return "Organization Access";
  };

  const getAccessLevelColor = () => {
    return "text-black";
  };

  if (loading) {
    return (
      <div className="stable-container py-4">
        <h1 className="text-xl font-bold mb-3">Admin - All Users</h1>
        <div>Loading sessions...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex justify-between items-center mb-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">
                {isGlobalAdmin ? "All Users" : `${organizationName || "Organization"} Users`}
              </h1>
              <MediarOrgSwitcher inSidebar={true} />
            </div>
            <span className={`text-sm font-medium ${getAccessLevelColor()}`}>
              {getAccessLevelText()}
            </span>
            {userRole && (
              <span className="text-xs text-gray-500 ml-2">
                Role: {userRole}
              </span>
            )}
          </div>
        <div className="flex items-center gap-2">
          {isLiveRefreshing && (
            <div className="flex items-center gap-1 text-xs text-black bg-white px-2 py-1 rounded border border-black">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Auto-updating...
            </div>
          )}
          <Input
            type="text"
            placeholder="Filter by User ID or Name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-48 border-black focus:border-black focus:ring-black"
          />
          <ThemeSwitcher />
          {isAdmin && (
            <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Invite User</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite New User to {organizationName}</DialogTitle>
                  <DialogDescription>
                    The user will receive an email with a link to join your organization.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInviteUser} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-black">Email Address</label>
                    <Input
                      id="email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="role" className="block text-sm font-medium text-black">Role</label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger id="role" className="mt-1">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="org:admin">Admin</SelectItem>
                        <SelectItem value="org:member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">Send Invitation</Button>
                  </div>
                </form>
                {inviteStatus && (
                  <div className={`mt-4 text-sm ${inviteStatus.error ? 'text-red-600' : 'text-green-600'}`}>
                    {inviteStatus.message}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Overall Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card className="border-black">
          <CardContent className="p-4">
            <div className="relative">
              <p className="text-sm font-mono text-gray-600">TOTAL USERS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {Object.keys(userSessions).length}
              </p>
              <FloatingDelta value={Object.keys(userSessions).length - Object.keys(previousData.current).length} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardContent className="p-4">
            <div className="relative">
              <p className="text-sm font-mono text-gray-600">TOTAL EVENTS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {Object.values(userSessions).reduce((total, userData) =>
                  total + userData.sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0), 0
                )}
              </p>
              <FloatingDelta value={
                Object.values(deltas).reduce((sum, d) => sum + (d.events || 0), 0)
              } />
            </div>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardContent className="p-4">
            <div className="relative">
              <p className="text-sm font-mono text-gray-600">TOTAL STEPS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {Object.values(userSessions).reduce((total, userData) =>
                  total + userData.sessions.reduce((sum, s) => sum + (s.total_ui_steps || 0), 0), 0
                )}
              </p>
              <FloatingDelta value={
                Object.values(deltas).reduce((sum, d) => sum + (d.steps || 0), 0)
              } />
            </div>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardContent className="p-4">
            <div className="relative">
              <p className="text-sm font-mono text-gray-600">WORKFLOWS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {Object.values(userSessions).reduce((total, userData) =>
                  total + (userData.workflowCount || 0), 0
                )}
              </p>
              <FloatingDelta value={
                Object.values(deltas).reduce((sum, d) => sum + (d.workflows || 0), 0)
              } />
            </div>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardContent className="p-4">
            <div className="relative">
              <p className="text-sm font-mono text-gray-600">ACTIVE USERS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {liveUsers.size}
              </p>
              {liveUsers.size > 0 && (
                <div className="absolute -top-1 -right-1 z-20 pointer-events-none animate-bounce-in">
                  <div className="bg-black text-white text-xs px-2 py-1 rounded-full shadow-lg border border-black font-medium animate-pulse">
                    LIVE
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Owner-Only Sections */}
      {isOwner && (
        <div className="space-y-6 mb-6">

          <RoleManagementSection isOwner={isOwner} isAdmin={isAdmin} currentUserId={userId || undefined} />
        </div>
      )}

      <div className="rounded-lg border border-black overflow-hidden">
        <table className="w-full text-sm text-left" style={{ tableLayout: 'fixed' }}>
          <thead className="text-xs text-black uppercase bg-white border-b border-black">
            <tr>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.user}px` }}>
                User
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'user')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.organization}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">Organization</TooltipTrigger>
                  <TooltipContent>
                    <p>User&apos;s organization name</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'organization')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.ss}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">SS</TooltipTrigger>
                  <TooltipContent>
                    <p>Total Sessions - Total number of sessions for this user</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'ss')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.type}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">Type</TooltipTrigger>
                  <TooltipContent>
                    <p>Session type: web, low-level, or mixed</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'type')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.events}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">EVENTS</TooltipTrigger>
                  <TooltipContent>
                    <p>Total number of events across all sessions</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'events')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.steps}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">STEPS PRCSD/TTL</TooltipTrigger>
                  <TooltipContent>
                    <p>Workflow Analyses: Completed / Total UI Steps - Shows processing completion percentage</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'steps')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.annotation}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">ANNOTATION<br/>LLM/HUMAN</TooltipTrigger>
                  <TooltipContent>
                    <p>Annotated steps: LLM labeled / Human annotated</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'annotation')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.workflow}px` }}>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">WORKFLOW (DISTINCT)</TooltipTrigger>
                  <TooltipContent>
                    <p>Number of distinct workflows created</p>
                  </TooltipContent>
                </Tooltip>
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'workflow')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.duration}px` }}>
                Duration
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'duration')} />
              </th>
              <th scope="col" className="px-1 py-2 relative" style={{ width: `${columnWidths.lastActive}px` }}>
                Last Active
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'lastActive')} />
              </th>
              <th scope="col" className="px-1 py-2 text-right relative" style={{ width: `${columnWidths.actions}px` }}>
                Actions
                <ResizeHandle onMouseDown={(e) => handleResizeStart(e, 'actions')} />
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(userSessions)
              .filter(([userId, userData]) => {
                if (!userId) return false;
                if (!filter) return true;
                return userId.includes(filter) ||
                  (userData.name && userData.name.toLowerCase().includes(filter.toLowerCase()));
              })
              .sort(([, aData], [, bData]) => {
                // Sort by most recent session activity
                const aLatest = Math.max(...aData.sessions.map(s => new Date(s.timestamp).getTime()));
                const bLatest = Math.max(...bData.sessions.map(s => new Date(s.timestamp).getTime()));
                return bLatest - aLatest;
              })
              .map(([userId, userData]) => {
                const totalSessions = userData.sessions.length;
                const totalEvents = userData.sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0);
                const totalUiSteps = userData.sessions.reduce((sum, s) => sum + (s.total_ui_steps || 0), 0);
                const totalProcessedEvents = userData.sessions.reduce((sum, s) => sum + (s.processed_event_count || 0), 0);
                const totalDuration = userData.sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
                const totalLlmLabeledSteps = userData.sessions.reduce((sum, s) => sum + (s.llm_labeled_steps || 0), 0);
                const totalHumanAnnotatedSteps = userData.sessions.reduce((sum, s) => sum + (s.human_annotated_steps || 0), 0);
                const mostRecentSession = userData.sessions.sort((a, b) =>
                  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                )[0];

                const sessionTypes = new Set(userData.sessions.map(s => s.type?.toLowerCase()).filter(Boolean));
                let userType = 'N/A';
                const hasWeb = sessionTypes.has('web');
                const hasLowLevel = sessionTypes.has('low-level');
                const hasMixed = sessionTypes.has('mixed');

                if ((hasWeb && hasLowLevel) || (hasWeb && hasMixed) || (hasLowLevel && hasMixed)) {
                  userType = 'mixed';
                } else if (hasWeb) {
                  userType = 'web';
                } else if (hasLowLevel || hasMixed) {
                  userType = 'low-level';
                }

                return (
                  <React.Fragment key={userId}>
                    <tr className="bg-white border-b border-black hover:bg-gray-50">
                      <td className="px-1 py-1 font-medium text-black whitespace-nowrap relative">
                        <div className="flex items-center">
                          <button
                            onClick={() => toggleUserExpansion(userId)}
                            className="mr-1 p-1 hover:bg-gray-200 rounded"
                          >
                            {expandedUsers.has(userId) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          {editingUser === userId ? (
                            <div className="flex items-center">
                              <Input
                                type="text"
                                value={userNameInput}
                                onChange={(e) => setUserNameInput(e.target.value)}
                                placeholder="Enter user name"
                                className="mr-2 h-8"
                              />
                              <Button onClick={() => handleSaveName(userId)} className="mr-2 h-8">Save</Button>
                              <Button variant="outline" onClick={() => setEditingUser(null)} className="h-8">Cancel</Button>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-2 cursor-pointer group"
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link href={`/low-level/${userId}/workflow`} className="mr-2 border-b border-dotted border-gray-400 group-hover:border-gray-600">
                                    {userData.name || `User ${truncateId(userId)}`}
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Full User ID: {userId}</p>
                                  {userData.name && <p>Name: {userData.name}</p>}
                                </TooltipContent>
                              </Tooltip>
                              {isAdmin && (
                                <button
                                  onClick={() => handleEditName(userId, userData.name || '')}
                                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <LiveUserPill isLive={liveUsers.has(userId)} />
                      </td>
                      <td className="px-1 py-1">
                        <Tooltip>
                          <TooltipTrigger className="cursor-help truncate max-w-[100px] block">
                            {userData.organizationName}
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{userData.organizationName}</p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-1 py-1">{totalSessions}</td>
                      <td className="px-1 py-1">{userType}</td>
                      <td className="px-1 py-1 relative">
                        {totalEvents}
                        <FloatingDelta value={deltas[userId]?.events || 0} />
                      </td>
                      <td className="px-1 py-1 relative">
                        {totalProcessedEvents} / {totalUiSteps}
                        <FloatingDelta value={deltas[userId]?.processed || 0} delay={100} />
                      </td>
                      <td className="px-1 py-1 relative">
                        {totalLlmLabeledSteps} / {totalHumanAnnotatedSteps}
                        <FloatingDelta value={deltas[userId]?.llmLabeled || 0} delay={150} />
                        <FloatingDelta value={deltas[userId]?.humanAnnotated || 0} delay={250} />
                      </td>
                      <td className="px-1 py-1 relative">
                        {userData.workflowCount}
                        <FloatingDelta value={deltas[userId]?.workflows || 0} delay={200} />
                      </td>
                      <td className="px-1 py-1">{formatDuration(totalDuration)}</td>
                      <td className="px-1 py-1">{mostRecentSession ? new Date(mostRecentSession.timestamp).toLocaleString() : 'Never'}</td>
                      <td className="px-1 py-1 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {isAdmin && (
                            <Button
                              variant="black-outline"
                              size="sm"
                              onClick={() => setUserToDelete({ id: userId, name: userData.name || `User ${truncateId(userId)}` })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedUsers.has(userId) && (
                      <tr>
                        <td colSpan={10} className="px-4 py-2 bg-gray-50">
                          <table className="w-full text-sm text-left border border-black">
                            <thead className="text-xs text-black uppercase bg-white border-b border-black">
                              <tr>
                                <th scope="col" className="px-1 py-1">Session ID</th>
                                <th scope="col" className="px-1 py-1">Type</th>
                                <th scope="col" className="px-1 py-1">Events</th>
                                <th scope="col" className="px-1 py-1">Duration</th>
                                <th scope="col" className="px-1 py-1">Status</th>
                                <th scope="col" className="px-1 py-1">Timestamp</th>
                                <th scope="col" className="px-1 py-1 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userData.sessions.map((session) => (
                                <tr key={session.id} className="border-b border-black">
                                  <td className="px-1 py-1 font-mono text-xs">
                                    <Tooltip>
                                      <TooltipTrigger className="cursor-help">
                                        {truncateId(session.id)}
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Full Session ID: {session.id}</p>
                                        <p>Session Type: {session.type}</p>
                                        <p>Status: {session.status}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>
                                  <td className="px-1 py-1">{session.type}</td>
                                  <td className="px-1 py-1">{session.eventCount || 0}</td>
                                  <td className="px-1 py-1">{formatDuration(session.duration_seconds || 0)}</td>
                                  <td className="px-1 py-1">
                                    <span className={`px-2 py-0.5 text-xs rounded-full border border-black ${
                                      session.status === 'live' ? 'bg-black text-white' : 'bg-white text-black'
                                    }`}>
                                      {session.status}
                                    </span>
                                  </td>
                                  <td className="px-1 py-1 text-gray-500">{new Date(session.timestamp).toLocaleString()}</td>
                                  <td className="px-1 py-1 text-right">
                                    {session.type.toLowerCase() === 'low-level' ? (
                                      <Link href={`/sessions/low-level/${session.id}`}>
                                        <Button size="sm" variant="black-outline">Raw JSON</Button>
                                      </Link>
                                    ) : (
                                      <Button size="sm" variant="black-outline" disabled>Raw JSON</Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      {userToDelete && (
        <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete all data for user{' '}
                <span className="font-bold">{userToDelete.name}</span> and remove all their associated sessions, events, and screenshots from our servers.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleDeleteUser(userToDelete.id)}
                className="bg-black text-white hover:bg-gray-800"
              >
                Delete User
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      </div>
    </TooltipProvider>
  );
}