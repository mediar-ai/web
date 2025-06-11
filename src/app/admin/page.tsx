'use client';

import { useEffect, useState, useMemo } from 'react';
import { getSessions, type UserSessionData, type Session } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

type EnhancedSession = Session & { userName: string | null };
type SortableKeys = keyof EnhancedSession | 'userName';

const truncateId = (id: string) => `...${id.slice(-4)}`;

export default function AdminPage() {
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' } | null>(null);

  const fetchSessions = async () => {
    setLoading(true);
    const sessionData = await getSessions();
    setUserSessions(sessionData);
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();
  }, []);

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
      fetchSessions(); // Refresh data
    } catch (error) {
      console.error('Failed to save user name:', error);
    }
  };

  const allSessions = useMemo(() => {
    const sessions: EnhancedSession[] = [];
    for (const userId in userSessions) {
      const userData = userSessions[userId];
      for (const session of userData.sessions) {
        sessions.push({
          ...session,
          userName: userData.name,
        });
      }
    }
    return sessions;
  }, [userSessions]);

  const sortedSessions = useMemo(() => {
    const sortableItems = [...allSessions];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = sortConfig.key === 'userName' ? a.userName || a.userId : a[sortConfig.key];
        const bValue = sortConfig.key === 'userName' ? b.userName || b.userId : b[sortConfig.key];
        
        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [allSessions, sortConfig]);

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key: SortableKeys) => {
    if (!sortConfig || sortConfig.key !== key) return '';
    return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
  };

  if (loading) {
    return (
      <div className="container mx-auto py-4">
        <h1 className="text-xl font-bold mb-3">Admin - All Sessions</h1>
        <div>Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">Admin - All Sessions</h1>
        <ThemeSwitcher />
      </div>
      
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('userName')}>
              User{getSortIndicator('userName')}
            </th>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('id')}>
              Session ID{getSortIndicator('id')}
            </th>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('type')}>
              Type{getSortIndicator('type')}
            </th>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('eventCount')}>
              Events{getSortIndicator('eventCount')}
            </th>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('status')}>
              Status{getSortIndicator('status')}
            </th>
            <th scope="col" className="px-2 py-2 cursor-pointer" onClick={() => requestSort('timestamp')}>
              Timestamp{getSortIndicator('timestamp')}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedSessions.map((session) => (
            <tr key={session.id} className="bg-white border-b">
              <td className="px-2 py-1 font-medium text-gray-900 whitespace-nowrap">
                {editingUser === session.userId ? (
                  <div className="flex items-center">
                    <Input
                      type="text"
                      value={userNameInput}
                      onChange={(e) => setUserNameInput(e.target.value)}
                      placeholder="Enter user name"
                      className="mr-2 h-8"
                    />
                    <Button onClick={() => handleSaveName(session.userId)} className="mr-2 h-8">Save</Button>
                    <Button variant="outline" onClick={() => setEditingUser(null)} className="h-8">Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span className="mr-2">{session.userName || `User ${truncateId(session.userId)}`}</span>
                    <Button variant="outline" size="sm" onClick={() => {
                      setEditingUser(session.userId);
                      setUserNameInput(session.userName || '');
                    }}>
                      Edit
                    </Button>
                  </div>
                )}
              </td>
              <td className="px-2 py-1 truncate" style={{maxWidth: '100px'}}>
                {truncateId(session.id)}
              </td>
              <td className="px-2 py-1">
                {session.type === 'lowLevel' ? 'Low-Level' : 'Web'}
              </td>
              <td className="px-2 py-1">{session.eventCount}</td>
              <td className="px-2 py-1">
                <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                  session.status === 'live' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {session.status}
                </span>
              </td>
              <td className="px-2 py-1">{new Date(session.timestamp).toLocaleString()}</td>
              <td className="px-2 py-1 text-right">
                <Link href={`/sessions/${session.type}/${session.id}`}>
                  <Button size="sm">View</Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
} 