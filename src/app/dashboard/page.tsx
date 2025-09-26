'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useOrganization } from '@clerk/nextjs';
import { Activity, Workflow, TrendingUp, Clock, CheckCircle, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const { organization } = useOrganization();
  const [stats, setStats] = useState([
    { label: 'Active Workflows', value: '0', icon: Workflow, change: '' },
    { label: 'Total Executions', value: '0', icon: Activity, change: '' },
    { label: 'Avg Speed', value: '0s', icon: Zap, change: '' },
    { label: 'Success Rate', value: '0%', icon: TrendingUp, change: '' },
  ]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!organization?.id) return;

      try {
        // Fetch workflows
        const workflowsResponse = await fetch('/api/remote-workflows/list');
        const workflowsData = await workflowsResponse.json();

        // Fetch recent executions
        const executionsResponse = await fetch('/api/remote-workflows/executions?limit=10');
        const executionsData = await executionsResponse.json();

        if (workflowsData.success) {
          const workflows = workflowsData.workflows || [];
          const activeWorkflows = workflows.filter((w: any) => w.status === 'active').length;

          // Calculate total executions and success rate
          let totalExecutions = 0;
          let successfulExecutions = 0;
          let totalDuration = 0;
          let durationCount = 0;

          workflows.forEach((w: any) => {
            totalExecutions += w.total_executions || 0;
            successfulExecutions += w.successful_runs || 0;
            if (w.current_version_stats?.average_duration_seconds) {
              totalDuration += w.current_version_stats.average_duration_seconds;
              durationCount++;
            }
          });

          const successRate = totalExecutions > 0
            ? Math.round((successfulExecutions / totalExecutions) * 100)
            : 0;

          const avgDuration = durationCount > 0
            ? Math.round(totalDuration / durationCount)
            : 0;

          setStats([
            { label: 'Active Workflows', value: activeWorkflows.toString(), icon: Workflow, change: '' },
            { label: 'Total Executions', value: totalExecutions.toString(), icon: Activity, change: '' },
            { label: 'Avg Speed', value: `${avgDuration}s`, icon: Zap, change: '' },
            { label: 'Success Rate', value: `${successRate}%`, icon: TrendingUp, change: '' },
          ]);
        }

        if (executionsData.success) {
          const executions = executionsData.executions || [];
          const activities = executions.slice(0, 4).map((exec: any) => ({
            action: exec.status === 'completed' ? 'Workflow executed' :
                    exec.status === 'failed' ? 'Execution failed' :
                    exec.status === 'running' ? 'Workflow running' : 'Workflow queued',
            item: exec.workflow_name || 'Unknown Workflow',
            time: new Date(exec.created_at).toLocaleString(),
            status: exec.status === 'completed' ? 'success' :
                   exec.status === 'failed' ? 'error' : 'pending',
          }));
          setRecentActivity(activities);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [organization?.id]);

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

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
              <p className="text-gray-600 font-mono">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <Link href="/deployments" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
            <h3 className="font-mono font-bold mb-2">VIEW DEPLOYMENTS</h3>
            <p className="font-mono text-sm text-gray-600">Monitor active deployments</p>
          </Link>
          <Link href="/settings" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
            <h3 className="font-mono font-bold mb-2">SETTINGS</h3>
            <p className="font-mono text-sm text-gray-600">Manage your account</p>
          </Link>
        </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}