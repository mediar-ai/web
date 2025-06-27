'use client';

import React, { useState, useCallback, useEffect, use } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil, Clipboard, Check, RefreshCw, ArrowLeft } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePathname, useRouter } from 'next/navigation';
import { UserProvider, useUser } from '@/context/UserContext';
import { Skeleton } from '@/components/ui/skeleton';

const UserLayoutContent = ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { userId: string };
}) => {
  const { userName, setUserName, setUserId } = useUser();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { userId } = params;

  useEffect(() => {
    setUserId(userId);
  }, [userId, setUserId]);

  const fetchUserName = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setUserName(data.name || null);
        setNameInput(data.name || '');
      }
    } catch (err) {
      console.error("Failed to fetch user name", err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, setUserName]);

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

  const handleCopy = () => {
    if (!userId) return;
    navigator.clipboard.writeText(userId).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const activeTab = pathname.split('/').pop();

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-10 bg-background container mx-auto gap-2 py-5 border-b">
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.push('/admin')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center">
                <Button variant="ghost" size="icon" onClick={fetchUserName} disabled={isLoading}>
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              {isLoading ? (
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-10 w-24" />
                </div>
              ) : isEditingName ? (
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
                <div className="flex items-center gap-4">
                  <div
                    className="flex items-center gap-2 cursor-pointer group"
                    onClick={() => {
                      setNameInput(userName || '');
                      setIsEditingName(true);
                    }}
                  >
                    <h1 className="text-2xl font-bold">
                      <span className="border-b border-dotted border-transparent group-hover:border-gray-400">{userName || 'Unnamed User'}</span>
                    </h1>
                    <Pencil className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="flex items-center text-2xl text-gray-500 font-normal">
                    <span>({userId})</span>
                    <Button variant="ghost" size="icon" onClick={handleCopy} className="h-8 w-8 ml-1">
                      {isCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Clipboard className="h-4 w-4 text-gray-500" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          <Tabs value={activeTab} onValueChange={(value) => router.push(`/low-level/${userId}/${value}`)}>
            <TabsList>
              <TabsTrigger value="raw-low-level-events">Raw Events</TabsTrigger>
              <TabsTrigger value="ui-trees">UI Trees</TabsTrigger>
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="labeling">Labeling</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <main className="container mx-auto flex-grow flex flex-col">{children}</main>
    </div>
  );
}

export default function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string }>;
}) {
  const resolvedParams = use(params);
  return (
    <UserProvider>
      <UserLayoutContent params={resolvedParams}>
        {children}
      </UserLayoutContent>
    </UserProvider>
  )
} 