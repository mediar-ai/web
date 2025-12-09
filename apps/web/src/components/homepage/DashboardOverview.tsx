'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserButton } from '@clerk/nextjs';
import {
    Building2,
    Settings,
    Users,
    Workflow
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface DashboardOverviewProps {
  organizationName: string;
  userRole: string;
  userId: string;
  isAdmin?: boolean;
  isOwner?: boolean;
}

export default function DashboardOverview({ organizationName, userRole, userId, isAdmin, isOwner }: DashboardOverviewProps) {
  const [_hasRawEvents, setHasRawEvents] = useState(false);

  // Check if user has raw events
  useEffect(() => {
    const checkUserEvents = async () => {
      try {
        const response = await fetch(`/api/users/${userId}/has-events`);
        if (response.ok) {
          const data = await response.json();
          setHasRawEvents(data.hasEvents);
          console.log(`[DashboardOverview] User ${userId} has events: ${data.hasEvents} (${data.totalEventCount} total)`);
        } else {
          console.error('[DashboardOverview] Failed to check user events:', response.status);
          // Default to showing the button if we can't check
          setHasRawEvents(true);
        }
      } catch (error) {
        console.error('[DashboardOverview] Error checking user events:', error);
        // Default to showing the button if we can't check
        setHasRawEvents(true);
      }
    };

    if (userId) {
      checkUserEvents();
    }
  }, [userId]);

  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case 'org:owner':
        return 'bg-black text-white border-black';
      case 'org:admin':
        return 'bg-white text-black border-black';
      case 'org:member':
        return 'bg-white text-black border-black';
      default:
        return 'bg-white text-black border-black';
    }
  };

  const getRoleDisplayName = (role?: string) => {
    switch (role) {
      case 'org:owner':
        return 'Owner';
      case 'org:admin':
        return 'Admin';
      case 'org:member':
        return 'Member';
      default:
        return 'User';
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                  <Workflow className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-black">Mediar</h1>
              </div>
              
              {/* Organization Info */}
              <div className="flex items-center space-x-2 px-3 py-1 bg-white border border-black rounded-lg">
                <Building2 className="w-4 h-4 text-black" />
                <span className="text-sm font-medium text-black">
                  {organizationName}
                </span>
                <Badge 
                  variant="outline" 
                  className={getRoleBadgeColor(userRole)}
                >
                  {getRoleDisplayName(userRole)}
                </Badge>
              </div>
            </div>

            <UserButton 
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-10 h-10"
                }
              }}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-black mb-2">
            Welcome back!
          </h2>
          <p className="text-black mb-6">
            Access your workflow tools and organization dashboard below.
          </p>

          {/* Role-based Navigation Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            {/* Admin Dashboard - Only for Admins/Owners */}
            {(isAdmin || isOwner) && (
              <Link href="/admin">
                <Button className="bg-black text-white hover:bg-gray-800 border border-black">
                  <Users className="w-4 h-4 mr-2" />
                  Admin Dashboard
                </Button>
              </Link>
            )}

            {/* Dashboard - Available to all */}
            <Link href="/dashboard">
              <Button variant="outline" className="border-black text-black hover:bg-black hover:text-white">
                <Settings className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </Link>
          </div>

        </div>


      </main>
    </div>
  );
}