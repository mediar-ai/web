'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useOrganization } from '@clerk/nextjs';
import { Activity, Workflow, Users, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { organization } = useOrganization();

  const stats = [
    { label: 'Active Workflows', value: '12', icon: Workflow, change: '+2' },
    { label: 'Deployments', value: '28', icon: Activity, change: '+5' },
    { label: 'Team Members', value: '4', icon: Users, change: '0' },
    { label: 'Success Rate', value: '98%', icon: TrendingUp, change: '+3%' },
  ];

  const recentActivity = [
    { action: 'Workflow deployed', item: 'Customer Onboarding', time: '2 minutes ago', status: 'success' },
    { action: 'Workflow updated', item: 'Data Processing', time: '1 hour ago', status: 'success' },
    { action: 'Team member invited', item: 'john@example.com', time: '3 hours ago', status: 'pending' },
    { action: 'Deployment failed', item: 'Legacy Migration', time: '5 hours ago', status: 'error' },
  ];

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-mono font-bold text-3xl mb-2">Dashboard</h1>
          <p className="font-mono text-gray-600">
            Welcome back to {organization?.name || 'your workspace'}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="border-2 border-black p-4">
                <div className="flex items-start justify-between mb-2">
                  <Icon className="w-5 h-5" />
                  <span className="font-mono text-xs text-gray-600">{stat.change}</span>
                </div>
                <p className="font-mono text-2xl font-bold mb-1">{stat.value}</p>
                <p className="font-mono text-xs text-gray-600">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {/* Recent Activity */}
        <div className="border-2 border-black">
          <div className="p-4 bg-black text-white">
            <h2 className="font-mono font-bold">RECENT ACTIVITY</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {recentActivity.map((activity, index) => (
              <div key={index} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {activity.status === 'success' && <CheckCircle className="w-4 h-4" />}
                  {activity.status === 'pending' && <Clock className="w-4 h-4" />}
                  {activity.status === 'error' && <div className="w-4 h-4 bg-black" />}
                  <div>
                    <p className="font-mono text-sm">
                      <span className="font-bold">{activity.action}</span>
                      {' - '}
                      <span>{activity.item}</span>
                    </p>
                    <p className="font-mono text-xs text-gray-600">{activity.time}</p>
                  </div>
                </div>
                <span className={`font-mono text-xs px-2 py-1 border ${
                  activity.status === 'success' ? 'border-black' :
                  activity.status === 'error' ? 'bg-black text-white' :
                  'border-gray-400'
                }`}>
                  {activity.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <Link href="/workflows/new" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
            <h3 className="font-mono font-bold mb-2">CREATE WORKFLOW</h3>
            <p className="font-mono text-sm text-gray-600">Start a new automation workflow</p>
          </Link>
          <Link href="/deployments" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
            <h3 className="font-mono font-bold mb-2">VIEW DEPLOYMENTS</h3>
            <p className="font-mono text-sm text-gray-600">Monitor active deployments</p>
          </Link>
          <Link href="/settings/team" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
            <h3 className="font-mono font-bold mb-2">INVITE TEAM</h3>
            <p className="font-mono text-sm text-gray-600">Add new team members</p>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}