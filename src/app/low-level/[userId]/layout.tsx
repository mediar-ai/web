'use client';

import React, { useState, useCallback, useEffect, use } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePathname, useRouter } from 'next/navigation';

export default function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const [userName, setUserName] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const fetchUserName = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/users/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setUserName(data.name || null);
        setNameInput(data.name || '');
      }
    } catch (err) {
      console.error("Failed to fetch user name", err);
    }
  }, [userId]);

  useEffect(() => {
    fetchUserName();
  }, [fetchUserName]);

  const handleSaveName = async () => {
    if (!userId) return;
    try {
      await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput }),
      });
      setUserName(nameInput);
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to save user name", err);
    }
  };

  const activeTab = pathname.split('/').pop();

  return (
    <div className="container mx-auto font-mono">
      <div className="sticky top-0 z-10 bg-background py-2 border-b mb-2">
        <div className="container mx-auto flex flex-col gap-2">
            <div className="flex items-center">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="text-2xl font-bold h-10"
                    placeholder="Enter user name"
                  />
                  <Button onClick={handleSaveName} size="sm">Save</Button>
                  <Button variant="outline" onClick={() => setIsEditingName(false)} size="sm">Cancel</Button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() => {
                    setNameInput(userName || '');
                    setIsEditingName(true);
                  }}
                >
                  <h1 className="text-2xl font-bold">
                    <span className="border-b border-dotted border-transparent group-hover:border-gray-400">{userName || 'Unnamed User'}</span>
                    <span className="text-gray-500 font-normal ml-2">({userId})</span>
                  </h1>
                  <Pencil className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>
          <Tabs value={activeTab} onValueChange={(value) => router.push(`/low-level/${userId}/${value}`)}>
            <TabsList>
              <TabsTrigger value="raw-low-level-events">Raw Low-Level Events</TabsTrigger>
              {/* Add other tabs here as needed */}
            </TabsList>
          </Tabs>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
} 