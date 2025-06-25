'use client';

// This is the main admin dashboard page, accessible at /admin.
import React, { useEffect, useState, useCallback } from 'react';
import { type UserSessionData } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useAuth, SignIn, useOrganization } from '@clerk/nextjs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const truncateId = (id: string) => `...${id.slice(-4)}`;

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

export default function AdminPage() {
  const { isLoaded, userId, has } = useAuth();
  const { organization, membership } = useOrganization();
  
  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="container mx-auto py-4">
        <div>Loading...</div>
      </div>
    );
  }
  
  // Show sign-in if not authenticated
  if (!userId) {
    return (
      <div className="container mx-auto py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  // Check if user has required role for full access dashboard
  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });
  
  // Access level will be determined by the API based on organization_data_access table
  
  if (!hasAdminRole && !hasMemberRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">You need admin or member privileges to access this dashboard.</p>
          <Link href="/">
            <Button variant="outline">Return to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Pass organization context to the authenticated component
  return (
    <AuthenticatedAdminPage 
      isAdmin={hasAdminRole}
      organizationId={organization?.id}
      organizationName={organization?.name}
      userRole={membership?.role}
    />
  );
}

interface AuthenticatedAdminPageProps {
  isAdmin: boolean;
  isGlobalAdmin: boolean;
  organizationId?: string;
  organizationName?: string;
  userRole?: string;
}

function AuthenticatedAdminPage({ 
  isAdmin, 
  organizationId, 
  organizationName, 
  userRole
}: Omit<AuthenticatedAdminPageProps, 'isGlobalAdmin'>) {
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
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



  useEffect(() => {
    fetchSessions();
    setLoading(false);
  }, [fetchSessions]);

  const handleEditName = (userId: string, currentName: string) => {
    setEditingUser(userId);
    setUserNameInput(currentName || '');
  };

  const handleSaveName = async (userId: string) => {
    if (!userNameInput.trim()) return;
    
    const { error } = await supabase
      .from('mediar_users')
      .upsert({ user_id: userId, name: userNameInput.trim() }, { onConflict: 'user_id' });
    
    if (error) {
      console.error('Error updating user name:', error);
      return;
    }
    
    setEditingUser(null);
    setUserNameInput('');
    await fetchSessions(); // Refresh the user list
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      // Delete from mediar_users table
      const { error: mediarUsersError } = await supabase
        .from('mediar_users')
        .delete()
        .eq('user_id', userId);

      if (mediarUsersError) {
        console.error('Error deleting from mediar_users:', mediarUsersError);
        return;
      }

      // Delete from session_metadata table
      const { error: sessionError } = await supabase
        .from('session_metadata')
        .delete()
        .eq('user_id', userId);

      if (sessionError) {
        console.error('Error deleting from session_metadata:', sessionError);
        return;
      }

      setUserToDelete(null);
      await fetchSessions(); // Refresh the user list
    } catch (error) {
      console.error('Failed to delete user:', error);
      // You might want to show an error notification to the user here
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteStatus({ message: 'Sending invitation...', error: false });

    try {
      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const result = await response.json();

      if (response.ok) {
        setInviteStatus({ message: result.message, error: false });
        // Optionally close the dialog after a delay
        setTimeout(() => {
          setIsInviteDialogOpen(false);
          setInviteEmail('');
          setInviteRole('org:member');
          setInviteStatus(null);
        }, 2000);
      } else {
        throw new Error(result.details || 'Failed to send invitation.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setInviteStatus({ message: errorMessage, error: true });
    }
  };

  // Get access level display text
  const getAccessLevelText = () => {
    if (isGlobalAdmin) {
      return "Mediar Admin - Global Access";
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
    if (isGlobalAdmin) return "text-purple-600";
    if (isAdmin) return "text-blue-600";
    return "text-green-600";
  };

  if (loading) {
    return (
      <div className="container mx-auto py-4">
        <h1 className="text-xl font-bold mb-3">Admin - All Users</h1>
        <div>Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h1 className="text-xl font-bold">
            {isGlobalAdmin ? "All Users" : `${organizationName || "Organization"} Users`}
          </h1>
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
          <Button 
            variant="outline" 
            onClick={fetchSessions}
            size="sm"
          >
            Refresh
          </Button>
          <Input 
            type="text"
            placeholder="Filter by User ID or Name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-48"
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
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email Address</label>
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
                    <label htmlFor="role" className="block text-sm font-medium text-gray-700">Role</label>
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
      
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" className="px-1 py-2 w-[30%]">User</th>
            <th scope="col" className="px-1 py-2">SS</th>
            <th scope="col" className="px-1 py-2" style={{ minWidth: '90px' }}>Type</th>
            <th scope="col" className="px-1 py-2">EVENTS</th>
            <th scope="col" className="px-1 py-2">STEPS TTL/PRCSD</th>
            <th scope="col" className="px-1 py-2">ANNOTATION<br/>LLM/HUMAN</th>
            <th scope="col" className="px-1 py-2">WORKFLOW (DISTINCT)</th>
            <th scope="col" className="px-1 py-2">Duration</th>
            <th scope="col" className="px-1 py-2" style={{ minWidth: '180px' }}>Last Active</th>
            <th scope="col" className="px-1 py-2 text-right">Actions</th>
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
              const liveSessions = userData.sessions.filter(s => s.status === 'live').length;
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

              if (hasWeb && hasLowLevel) {
                userType = 'mixed';
              } else if (hasWeb) {
                userType = 'web';
              } else if (hasLowLevel) {
                userType = 'low-level';
              }

              return (
                <React.Fragment key={userId}>
                  <tr className="bg-white border-b hover:bg-gray-50">
                    <td className="px-1 py-1 font-medium text-gray-900 whitespace-nowrap">
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
                            <Link href={`/low-level/${userId}/workflow`} className="mr-2 border-b border-dotted border-gray-400 group-hover:border-gray-600">
                              {userData.name || `User ${truncateId(userId)}`}
                            </Link>
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
                    </td>
                    <td className="px-1 py-1">{liveSessions}</td>
                    <td className="px-1 py-1">{userType}</td>
                    <td className="px-1 py-1">{totalEvents}</td>
                    <td className="px-1 py-1">
                      {totalProcessedEvents} / {totalUiSteps}
                    </td>
                    <td className="px-1 py-1">{totalLlmLabeledSteps} / {totalHumanAnnotatedSteps}</td>
                    <td className="px-1 py-1">{Math.max(...userData.sessions.map(s => s.distinct_workflows_created || 0), 0)}</td>
                    <td className="px-1 py-1">{formatDuration(totalDuration)}</td>
                    <td className="px-1 py-1">{mostRecentSession ? new Date(mostRecentSession.timestamp).toLocaleString() : 'Never'}</td>
                    <td className="px-1 py-1 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        {isAdmin && (
                          <Button 
                            variant="destructive" 
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
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-gray-700 uppercase bg-gray-100">
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
                              <tr key={session.id} className="border-b border-gray-200">
                                <td className="px-1 py-1 font-mono text-xs">{truncateId(session.id)}</td>
                                <td className="px-1 py-1">{session.type}</td>
                                <td className="px-1 py-1">{session.eventCount || 0}</td>
                                <td className="px-1 py-1">{formatDuration(session.duration_seconds || 0)}</td>
                                <td className="px-1 py-1">
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    session.status === 'live' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {session.status}
                                  </span>
                                </td>
                                <td className="px-1 py-1 text-gray-500">{new Date(session.timestamp).toLocaleString()}</td>
                                <td className="px-1 py-1 text-right">
                                  {session.type.toLowerCase() === 'low-level' ? (
                                    <Link href={`/sessions/low-level/${session.id}`}>
                                      <Button size="sm" variant="outline">Raw JSON</Button>
                                    </Link>
                                  ) : (
                                    <Button size="sm" variant="outline" disabled>Raw JSON</Button>
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
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete User
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
} 