'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserButton } from '@clerk/nextjs';
import {
    Archive,
    BarChart3,
    Building2,
    Database,
    Play,
    Settings,
    Users,
    Workflow
} from 'lucide-react';
import Link from 'next/link';

interface UserStatus {
  inDatabase: boolean;
  hasOrganization: boolean;
  organizationId?: string;
  organizationName?: string;
  userRole?: string;
}

interface DashboardOverviewProps {
  userStatus: UserStatus;
  userId: string;
  isAdmin?: boolean;
  isOwner?: boolean;
}

export default function DashboardOverview({ userStatus, userId, isAdmin, isOwner }: DashboardOverviewProps) {
  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case 'org:owner':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'org:admin':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'org:member':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
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
    <div className="min-h-screen bg-gray-50">
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
              {userStatus.organizationName && (
                <div className="flex items-center space-x-2 px-3 py-1 bg-gray-100 rounded-full">
                  <Building2 className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">
                    {userStatus.organizationName}
                  </span>
                  <Badge 
                    variant="outline" 
                    className={getRoleBadgeColor(userStatus.userRole)}
                  >
                    {getRoleDisplayName(userStatus.userRole)}
                  </Badge>
                </div>
              )}
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
          <p className="text-gray-600 mb-6">
            Access your workflow tools and organization dashboard below.
          </p>

          {/* Role-based Navigation Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            {/* Web Page - Available to all */}
            <Link href="/web">
              <Button className="bg-black text-white hover:bg-gray-800">
                <Play className="w-4 h-4 mr-2" />
                Web Workflows
              </Button>
            </Link>

            {/* Raw Events - Available to all */}
            <Link href={`/low-level/${userId}/raw-low-level-events`}>
              <Button variant="outline" className="border-black text-black hover:bg-black hover:text-white">
                <Database className="w-4 h-4 mr-2" />
                Raw Events
              </Button>
            </Link>

            {/* Admin Dashboard - Only for Admins/Owners */}
            {(isAdmin || isOwner) && (
              <Link href="/admin">
                <Button variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-50">
                  <Users className="w-4 h-4 mr-2" />
                  Admin Dashboard
                </Button>
              </Link>
            )}

            {/* Deployments - Only for Admins/Owners */}
            {(isAdmin || isOwner) && (
              <Link href="/deployments">
                <Button variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50">
                  <Settings className="w-4 h-4 mr-2" />
                  Deployments
                </Button>
              </Link>
            )}
          </div>

          {/* Account Information */}
          <Card className="border-gray-200 bg-gray-50">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div>
                    <h4 className="font-medium text-black">Signed in</h4>
                    <p className="text-sm text-gray-600">
                      {userStatus.organizationName ? (
                        <>
                          {getRoleDisplayName(userStatus.userRole)} in {userStatus.organizationName}
                        </>
                      ) : (
                        'Manage your account settings'
                      )}
                    </p>
                  </div>
                  {userStatus.userRole && (
                    <Badge 
                      variant="outline" 
                      className={getRoleBadgeColor(userStatus.userRole)}
                    >
                      {getRoleDisplayName(userStatus.userRole)}
                    </Badge>
                  )}
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
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity & Stats */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Quick Stats */}
          <Card className="border-black-outline">
            <CardHeader>
              <CardTitle className="text-black flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Active Workflows</span>
                <span className="font-semibold text-black">12</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">This Month</span>
                <span className="font-semibold text-black">48 captures</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Success Rate</span>
                <span className="font-semibold text-green-600">94%</span>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="border-black-outline lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-black flex items-center gap-2">
                <Archive className="w-5 h-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-black">Login Workflow Captured</p>
                    <p className="text-sm text-gray-600">2 hours ago</p>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Completed
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-black">Form Automation Deployed</p>
                    <p className="text-sm text-gray-600">5 hours ago</p>
                  </div>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    Running
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-black">Team Member Added</p>
                    <p className="text-sm text-gray-600">1 day ago</p>
                  </div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                    Admin
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}