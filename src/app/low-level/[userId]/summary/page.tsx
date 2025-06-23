'use client';

import React, { useEffect, useState, useCallback, use, useMemo } from 'react';
import { type UserSessionData } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useDebouncedCallback } from 'use-debounce';
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw } from 'lucide-react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnimatePresence, motion } from 'framer-motion';

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

export default function UserSummaryPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const [userData, setUserData] = useState<UserSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<boolean>(false);
  const [isEventSummaryOpen, setIsEventSummaryOpen] = useState(false);
  const [rawEvents, setRawEvents] = useState<LowLevelEvent[]>([]);
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [rawEventsLoading, setRawEventsLoading] = useState(true);

  const eventStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const event of rawEvents) {
      const body = event.payload as Record<string, unknown>;
      const eventType = (body.payload as Record<string, unknown>)?.type as string || 'unknown';
      stats.set(eventType, (stats.get(eventType) || 0) + 1);
    }
    return Array.from(stats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rawEvents]);

  const seenWindows = useMemo(() => {
    const windows = new Set<string>();
    for (const event of rawEvents) {
      try {
        const body = event.payload as Record<string, unknown>;
        const uiTreeStr = ((body.payload as Record<string, unknown>)?.event as Record<string, unknown>)?.screen as { ui_tree?: string } | undefined;
        if (uiTreeStr?.ui_tree) {
          const uiTree = JSON.parse(uiTreeStr.ui_tree);
          if (uiTree.attributes?.name) {
            windows.add(uiTree.attributes.name);
          }
        }
      } catch {}
    }
    return Array.from(windows).sort();
  }, [rawEvents]);


  const toggleSessionsExpansion = () => {
    setExpandedSessions(prev => !prev);
  };

  const toggleEventSummary = () => {
    setIsEventSummaryOpen(prev => !prev);
  };

  const fetchUserData = useCallback(async () => {
    const response = await fetch(`/api/sessions?v=${Date.now()}`);
    const sessionData = await response.json();
    setUserData(sessionData[userId] || null);
  }, [userId]);

  // Debounce for 2 seconds to handle the firehose of events and refresh efficiently.
  const debouncedFetchUserData = useDebouncedCallback(fetchUserData, 2000);

  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      await fetchUserData();
      setLoading(false);
    }
    initialFetch();

    const channel = supabase
      .channel('public:session_metadata')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_metadata' }, 
        () => {
          debouncedFetchUserData();
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error('[Realtime] Subscription error:', err as Error);
        }
      });

    const fetchRawEvents = async () => {
      if (!userId) return;
      setRawEventsLoading(true);
      try {
        const response = await fetch(`/api/low-level/${userId}`);
        if (response.ok) {
          const data = await response.json();
          setRawEvents(data.events || []);
          setSessionCount(data.sessionCount || 0);
        }
      } finally {
        setRawEventsLoading(false);
      }
    };

    fetchRawEvents();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchUserData, debouncedFetchUserData, userId]);

  if (loading) {
    return (
      <div className="container mx-auto py-4">
        <h2 className="text-xl font-bold mb-3">Summary</h2>
        <div>Loading user data...</div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="container mx-auto py-4">
        <h2 className="text-xl font-bold mb-3">Summary</h2>
        <div>No data found for this user.</div>
      </div>
    );
  }

  const liveSessions = userData.sessions.filter(s => s.status === 'live').length;
  const totalUiSteps = userData.sessions.reduce((sum, s) => sum + (s.total_ui_steps || 0), 0);
  const totalProcessedEvents = userData.sessions.reduce((sum, s) => sum + (s.processed_event_count || 0), 0);
  const totalDuration = userData.sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
  const totalWorkflowAnalyses = userData.sessions.reduce((sum, s) => sum + (s.total_workflow_analyses || 0), 0);
  const distinctWorkflowsCreated = userData.sessions.reduce((sum, s) => sum + (s.distinct_workflows_created || 0), 0);
  const humanLabeledSteps = userData.sessions.reduce((sum, s) => sum + (s.human_labeled_steps || 0), 0);
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
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-bold">Summary</h2>
        <Button 
          variant="outline" 
          onClick={fetchUserData}
          size="sm"
        >
          Refresh
        </Button>
      </div>
      
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" className="px-1 py-2 w-[30%]">User</th>
            <th scope="col" className="px-1 py-2">Sessions</th>
            <th scope="col" className="px-1 py-2">Type</th>
            <th scope="col" className="px-1 py-2">STEPS (PROCESSED)</th>
            <th scope="col" className="px-1 py-2">HUMAN ANNOTATION</th>
            <th scope="col" className="px-1 py-2">WORKFLOW (DISTINCT)</th>
            <th scope="col" className="px-1 py-2">Duration</th>
            <th scope="col" className="px-1 py-2" style={{ minWidth: '180px' }}>Last Active</th>
          </tr>
        </thead>
        <tbody>
          <React.Fragment>
            <tr className="bg-white border-b hover:bg-gray-50">
              <td className="px-1 py-1 font-medium text-gray-900 whitespace-nowrap">
                <div className="flex items-center">
                  <button
                    onClick={toggleSessionsExpansion}
                    className="mr-1 p-1 hover:bg-gray-200 rounded"
                  >
                    {expandedSessions ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="mr-2 border-b border-dotted border-gray-400">
                      {userData.name || `User ${truncateId(userId)}`}
                    </span>
                  </div>
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
              <td className="px-1 py-1">
                {totalProcessedEvents} / {totalUiSteps}
              </td>
              <td className="px-1 py-1">{humanLabeledSteps}</td>
              <td className="px-1 py-1">{totalWorkflowAnalyses} ({distinctWorkflowsCreated})</td>
              <td className="px-1 py-1">{formatDuration(totalDuration)}</td>
              <td className="px-1 py-1">{mostRecentSession ? new Date(mostRecentSession.timestamp).toLocaleString() : 'Never'}</td>
            </tr>
            {expandedSessions && (
              <tr>
                <td colSpan={8} className="px-4 py-2 bg-gray-50">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                      <tr>
                        <th scope="col" className="px-1 py-1">Session ID</th>
                        <th scope="col" className="px-1 py-1">Type</th>
                        <th scope="col" className="px-1 py-1">STEPS (PROCESSED)</th>
                        <th scope="col" className="px-1 py-1">HUMAN ANNOTATION</th>
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
                          <td className="px-1 py-1">{session.processed_event_count || 0} / {session.total_ui_steps || 0}</td>
                          <td className="px-1 py-1">{session.human_labeled_steps || 0}</td>
                          <td className="px-1 py-1">{session.total_workflow_analyses || 0} ({session.distinct_workflows_created || 0})</td>
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
                            ) : session.type.toLowerCase() === 'web' ? (
                              <Link href={`/sessions/web/${session.id}`}>
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
        </tbody>
      </table>

      <Card className="mt-4">
          <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={toggleEventSummary}>
              <CardTitle className="text-sm">Raw Event Summary</CardTitle>
              <div className="flex items-center gap-2">
                {isEventSummaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
          </CardHeader>
          <AnimatePresence>
              {isEventSummaryOpen && (
                  <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                  >
                    <CardContent className="p-2 space-y-2">
                      {rawEventsLoading ? (
                        <div className="flex justify-center items-center p-8">
                          <RefreshCw className="h-16 w-16 animate-spin text-muted-foreground" />
                        </div>
                      ) : rawEvents.length > 0 ? (
                        <>
                          <div>
                              <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline">Sessions: {sessionCount}</Badge>
                              </div>
                              {eventStats.length > 0 && (
                                  <div className="mt-2">
                                      <h4 className="text-xs font-semibold mb-1">Event Types:</h4>
                                      <div className="flex flex-wrap gap-1">
                                          {eventStats.map(([type, count]: [string, number]) => (
                                              <Badge 
                                                  key={type} 
                                                  variant={"secondary"}
                                              >
                                                  {type}: {count}
                                              </Badge>
                                          ))}
                                      </div>
                                  </div>
                              )}
                          </div>
                          {seenWindows.length > 0 && (
                              <div>
                                  <h4 className="text-xs font-semibold mb-1 mt-2">Windows Used:</h4>
                                  <div className="flex flex-col space-y-1 mt-1 items-start">
                                      {seenWindows.map((windowName: string) => (
                                          <Badge
                                              key={windowName}
                                              variant={'outline'}
                                              className="text-xs"
                                          >
                                              {windowName}
                                          </Badge>
                                      ))}
                                  </div>
                              </div>
                          )}
                        </>
                      ) : (
                        <p className="p-2 text-sm text-muted-foreground">No raw events found for this user.</p>
                      )}
                    </CardContent>
                  </motion.div>
              )}
          </AnimatePresence>
      </Card>
    </div>
  );
} 