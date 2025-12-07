'use client';

import { useEffect, useState } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Users,
  Mail,
  Server,
  CreditCard,
  Receipt,
  Activity,
  Clock,
  Building2,
  ArrowRight,
} from 'lucide-react';

interface QuickStats {
  totalOrganizations: number;
  totalMachines: number;
  healthyMachines: number;
  pendingInvitations: number;
}

const quickLinks = [
  {
    title: 'Members',
    href: '/admin/members',
    icon: Users,
    description: 'Manage organization members across all orgs',
  },
  {
    title: 'Invitations',
    href: '/admin/invitations',
    icon: Mail,
    description: 'View and manage pending invitations',
  },
  {
    title: 'Machines',
    href: '/admin/machines',
    icon: Server,
    description: 'VM infrastructure and health monitoring',
  },
  {
    title: 'Billing',
    href: '/admin/billing',
    icon: CreditCard,
    description: 'Azure costs and resource usage',
  },
  {
    title: 'Customer Billing',
    href: '/admin/customer-billing',
    icon: Receipt,
    description: 'Customer usage metrics and invoicing',
  },
  {
    title: 'Observability',
    href: '/admin/observability',
    icon: Activity,
    description: 'Logs, traces, and system metrics',
  },
  {
    title: 'VM Timeline',
    href: '/admin/vm-timeline',
    icon: Clock,
    description: 'VM operations history and audit log',
  },
];

export default function AdminOverviewPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const [stats, setStats] = useState<QuickStats>({
    totalOrganizations: 0,
    totalMachines: 0,
    healthyMachines: 0,
    pendingInvitations: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch organizations
        const orgsRes = await fetch('/api/admin/organizations');
        const orgsData = orgsRes.ok ? await orgsRes.json() : { organizations: [] };

        // Fetch machines
        const machinesRes = await fetch('/api/machines?status=all&show_all=true');
        const machinesData = machinesRes.ok ? await machinesRes.json() : { machines: [] };

        const machines = machinesData.machines || [];
        const healthyCount = machines.filter(
          (m: any) => m.health_status === 'healthy'
        ).length;

        setStats({
          totalOrganizations: orgsData.organizations?.length || 0,
          totalMachines: machines.length,
          healthyMachines: healthyCount,
          pendingInvitations: 0, // Would need separate API
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-mono font-bold text-3xl mb-2">ADMIN DASHBOARD</h1>
        <p className="font-mono text-gray-600">
          Welcome back, {user?.firstName || user?.emailAddresses?.[0]?.emailAddress}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border-2 border-black p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-5 h-5" />
            <span className="font-mono text-xs text-gray-600 uppercase">Organizations</span>
          </div>
          <div className="font-mono font-bold text-2xl">
            {loading ? '-' : stats.totalOrganizations}
          </div>
        </div>
        <div className="border-2 border-black p-4">
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-5 h-5" />
            <span className="font-mono text-xs text-gray-600 uppercase">Machines</span>
          </div>
          <div className="font-mono font-bold text-2xl">
            {loading ? '-' : stats.totalMachines}
          </div>
        </div>
        <div className="border-2 border-black p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5" />
            <span className="font-mono text-xs text-gray-600 uppercase">Healthy</span>
          </div>
          <div className="font-mono font-bold text-2xl">
            {loading ? '-' : `${stats.healthyMachines}/${stats.totalMachines}`}
          </div>
        </div>
        <div className="border-2 border-black p-4">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-5 h-5" />
            <span className="font-mono text-xs text-gray-600 uppercase">Invitations</span>
          </div>
          <div className="font-mono font-bold text-2xl">
            {loading ? '-' : stats.pendingInvitations}
          </div>
        </div>
      </div>

      {/* Quick Links Grid */}
      <h2 className="font-mono font-bold text-lg mb-4 uppercase">Quick Access</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quickLinks.map(link => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group border-2 border-black p-4 hover:bg-black hover:text-white transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-black text-white group-hover:bg-white group-hover:text-black transition-colors">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono font-bold uppercase">{link.title}</h3>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="font-mono text-sm text-gray-600 group-hover:text-gray-300 mt-1">
                    {link.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Current Organization */}
      {organization && (
        <div className="mt-8 border-2 border-black p-4">
          <h2 className="font-mono font-bold text-lg mb-2 uppercase">Current Organization</h2>
          <div className="font-mono text-sm space-y-1">
            <div>
              <span className="text-gray-600">Name:</span> {organization.name}
            </div>
            <div>
              <span className="text-gray-600">ID:</span>{' '}
              <span className="bg-gray-100 px-2 py-0.5 text-xs">{organization.id}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
