'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { type UserSessionData } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { useDebouncedCallback } from 'use-debounce';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
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

const truncateId = (id: string) => `...${id.slice(-4)}`;

const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || seconds === 0) return 'N/A';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  
  let result = '';
  if (h > 0) result += `${h}h `;
  if (m > 0) result += `${m}m`;
  
  return result.trim();
};

export default function AdminPage() {
  // Enhanced admin features only for specific users
  const ENHANCED_ADMIN_USERS = [
    '29303245-5cbb-671e-2930-32455cbb671e',
    'c4cc0b1a-4e8b-e98c-c4cc-0b1a4e8be98c'
  ];
  
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState('');
  const [filter, setFilter] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [userToDelete, setUserToDelete] = useState<{id: string, name: string} | null>(null);

  // Check if current user has enhanced admin privileges
  const hasEnhancedAccess = currentUserId && ENHANCED_ADMIN_USERS.includes(currentUserId);

  useEffect(() => {
    // Get user ID from localStorage or URL parameter
    const storedUserId = localStorage.getItem('user_id');
    const urlParams = new URLSearchParams(window.location.search);
    const urlUserId = urlParams.get('userId');
    
    const userId = urlUserId || storedUserId;
    setCurrentUserId(userId);
  }, []);

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
    const response = await fetch(`/api/sessions?v=${Date.now()}`);
    const sessionData = await response.json();
    setUserSessions(sessionData);
  }, []);

  // Debounce for 2 seconds to handle the firehose of events and refresh efficiently.
  const debouncedFetchSessions = useDebouncedCallback(fetchSessions, 2000);

  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      await fetchSessions();
      setLoading(false);
    }
    initialFetch();

    const channel = supabase
      .channel('public:session_metadata')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_metadata' }, 
        () => {
          debouncedFetchSessions();
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error('[Realtime] Subscription error:', err as Error);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSessions, debouncedFetchSessions]);

  const handleSaveName = async (userId: string) => {
    try {
      await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: userNameInput }),
      });
      setEditingUser(null);
      setUserNameInput('');
      debouncedFetchSessions(); // Refresh data using debounced fetch
    } catch (error) {
      console.error('Failed to save user name:', error);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || `Failed to delete user: ${response.statusText}`);
      }
      
      setUserToDelete(null); // Close the dialog
      await fetchSessions(); // Refresh the user list
    } catch (error) {
      console.error('Failed to delete user:', error);
      // You might want to show an error notification to the user here
    }
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
        <h1 className="text-xl font-bold">All Users</h1>
        <div className="flex items-center gap-2">
          {hasEnhancedAccess && (
            <span className="text-xs text-green-600 font-semibold px-2 py-1 bg-green-100 rounded">
              Enhanced Access
            </span>
          )}
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
                            <Pencil 
                              className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" 
                              onClick={() => {
                                setEditingUser(userId);
                                setUserNameInput(userData.name || '');
                              }}
                            />
                          </div>
                        )}
                        {liveSessions > 0 && (
                          <span className="flex items-center gap-1.5 ml-2">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="text-xs text-green-600 font-semibold">LIVE</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1">{userData.sessions.length}</td>
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
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => setUserToDelete({ id: userId, name: userData.name || `User ${truncateId(userId)}` })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
                              <th scope="col" className="px-1 py-1">EVENTS</th>
                              <th scope="col" className="px-1 py-2">STEPS TTL/PRCSD</th>
                              <th scope="col" className="px-1 py-1">ANNOTATION<br/>LLM/HUMAN</th>
                              <th scope="col" className="px-1 py-1">WORKFLOW (DISTINCT)</th>
                              <th scope="col" className="px-1 py-1">Duration</th>
                              <th scope="col" className="px-1 py-1">Status</th>
                              <th scope="col" className="px-1 py-1">Last Active</th>
                              <th scope="col" className="px-1 py-1 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                          {userData.sessions
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map((session) => (
                              <tr key={session.id} className="bg-white border-b hover:bg-gray-50">
                                <td className="px-1 py-1 font-mono text-xs">{truncateId(session.id)}</td>
                                <td className="px-1 py-1 font-semibold">{session.type}</td>
                                <td className="px-1 py-1">{session.eventCount || 0}</td>
                                <td className="px-1 py-1">{session.processed_event_count || 0} / {session.total_ui_steps || 0}</td>
                                <td className="px-1 py-1">{session.llm_labeled_steps || 0} / {session.human_annotated_steps || 0}</td>
                                <td className="px-1 py-1">{session.distinct_workflows_created || 0}</td>
                                <td className="px-1 py-1">{formatDuration(session.duration_seconds)}</td>
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
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
} 