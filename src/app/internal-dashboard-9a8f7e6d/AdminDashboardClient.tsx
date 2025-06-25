'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { type UserSessionData } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';

interface AdminDashboardClientProps {
  isAdmin: boolean;
}

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

export default function AdminDashboardClient({ isAdmin }: AdminDashboardClientProps) {
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [userToDelete, setUserToDelete] = useState<{id: string, name: string} | null>(null);

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
        <h1 className="text-xl font-bold mb-3">Example Team</h1>
        <div>Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h1 className="text-xl font-bold">Example Team</h1>
          {isAdmin && (
            <span className="text-sm text-blue-600 font-medium">Admin Access - All Organizations</span>
          )}
          {!isAdmin && (
            <span className="text-sm text-green-600 font-medium">Member Access - Organization Data</span>
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
            {isAdmin && <th scope="col" className="px-1 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {Object.entries(userSessions)
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
              const totalDuration = userData.sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
              const distinctWorkflowsCreated = Math.max(...userData.sessions.map(s => s.distinct_workflows_created || 0), 0);
              const totalLlmLabeledSteps = userData.sessions.reduce((sum, s) => sum + (s.llm_labeled_steps || 0), 0);
              const totalHumanAnnotatedSteps = userData.sessions.reduce((sum, s) => sum + (s.human_annotated_steps || 0), 0);
              const mostRecentSession = userData.sessions.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              )[0];

              const sessionTypes = new Set(userData.sessions.map(s => s.type?.toLowerCase()).filter(Boolean));
              let userType = 'N/A';
              if (sessionTypes.has('low-level')) {
                userType = 'Low-level';
              } else if (sessionTypes.has('web')) {
                userType = 'Web';
              }

              return (
                <React.Fragment key={userId}>
                  <tr className="bg-white border-b hover:bg-gray-50">
                    <td className="px-1 py-2 font-medium text-gray-900 whitespace-nowrap">
                      <div className="flex items-center">
                        <button onClick={() => toggleUserExpansion(userId)} className="mr-2 p-1">
                          {expandedUsers.has(userId) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        {editingUser === userId && isAdmin ? (
                          <Input 
                            type="text" 
                            value={userNameInput}
                            onChange={(e) => setUserNameInput(e.target.value)}
                            onBlur={() => handleSaveName(userId)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveName(userId)}
                            autoFocus
                            className="h-7"
                          />
                        ) : (
                          <span className="font-bold">{userData.name || 'Anonymous'}</span>
                        )}
                        {isAdmin && (
                          <button onClick={() => { setEditingUser(userId); setUserNameInput(userData.name || ''); }} className="ml-2 text-gray-400 hover:text-gray-700">
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-2 text-center">{liveSessions}/{userData.sessions.length}</td>
                    <td className="px-1 py-2">{userType}</td>
                    <td className="px-1 py-2 text-center">{totalEvents}</td>
                    <td className="px-1 py-2 text-center">{totalUiSteps}</td>
                    <td className="px-1 py-2 text-center">{totalLlmLabeledSteps}/{totalHumanAnnotatedSteps}</td>
                    <td className="px-1 py-2 text-center">{distinctWorkflowsCreated}</td>
                    <td className="px-1 py-2">{formatDuration(totalDuration)}</td>
                    <td className="px-1 py-2">{mostRecentSession ? new Date(mostRecentSession.timestamp).toLocaleString() : 'N/A'}</td>
                    {isAdmin && (
                      <td className="px-1 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setUserToDelete({id: userId, name: userData.name || 'Anonymous'})} className="text-red-500 hover:text-red-700">
                          <Trash2 size={16}/>
                        </Button>
                      </td>
                    )}
                  </tr>
                  {expandedUsers.has(userId) && (
                    <tr className="bg-gray-50">
                      <td colSpan={isAdmin ? 10 : 9} className="px-4 py-2">
                        <div className="font-semibold mb-1">Sessions:</div>
                        <ul className="list-disc pl-5">
                          {userData.sessions.map(session => (
                            <li key={session.id}>
                              <Link href={`/sessions/${session.type}/${session.id}`} className="text-blue-600 hover:underline">
                                {session.type?.toUpperCase()}: {truncateId(session.id)} ({new Date(session.timestamp).toLocaleString()})
                              </Link>
                              - {session.status}, {session.eventCount || 0} events, {formatDuration(session.duration_seconds)}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
        </tbody>
      </table>

      {userToDelete && isAdmin && (
        <AlertDialog open onOpenChange={() => setUserToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete all data for user <span className="font-bold">{userToDelete.name}</span> ({truncateId(userToDelete.id)}).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleDeleteUser(userToDelete.id)} className="bg-red-600 hover:bg-red-700">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}