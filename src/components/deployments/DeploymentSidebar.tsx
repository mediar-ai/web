'use client';

import React from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  // SidebarMenuSub,
  // SidebarMenuSubButton,
  // SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  // FolderOpen,
  // Clock,
  Activity,
  Settings,
  Plus,
  PlayCircle,
  PauseCircle,
  AlertCircle,
  CheckCircle,
  Zap,
  Calendar,
  BarChart,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DeploymentSidebarProps {
  stats?: {
    total: number;
    running: number;
    paused: number;
    failed: number;
    automated: number;
  };
  selectedFilter?: string;
  onFilterChange?: (filter: string) => void;
  onCreateWorkflow?: () => void;
}

export function DeploymentSidebar({
  stats = {
    total: 0,
    running: 0,
    paused: 0,
    failed: 0,
    automated: 0,
  },
  selectedFilter = 'all',
  onFilterChange,
  onCreateWorkflow,
}: DeploymentSidebarProps) {
  const menuItems = [
    {
      label: 'Overview',
      items: [
        {
          icon: LayoutDashboard,
          label: 'All Workflows',
          value: 'all',
          count: stats.total,
        },
        {
          icon: Activity,
          label: 'Running',
          value: 'running',
          count: stats.running,
          color: 'text-blue-500',
        },
        {
          icon: Calendar,
          label: 'Automated',
          value: 'automated',
          count: stats.automated,
          color: 'text-purple-500',
        },
      ],
    },
    {
      label: 'Status',
      items: [
        {
          icon: PlayCircle,
          label: 'Active',
          value: 'active',
          color: 'text-green-500',
        },
        {
          icon: PauseCircle,
          label: 'Paused',
          value: 'paused',
          count: stats.paused,
          color: 'text-yellow-500',
        },
        {
          icon: AlertCircle,
          label: 'Failed',
          value: 'failed',
          count: stats.failed,
          color: 'text-red-500',
        },
        {
          icon: CheckCircle,
          label: 'Completed',
          value: 'completed',
          color: 'text-gray-500',
        },
      ],
    },
    {
      label: 'Analytics',
      items: [
        {
          icon: BarChart,
          label: 'Performance',
          value: 'performance',
        },
        {
          icon: Zap,
          label: 'Executions',
          value: 'executions',
        },
        {
          icon: Archive,
          label: 'History',
          value: 'history',
        },
      ],
    },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="text-lg font-semibold">Deployments</h2>
          <SidebarTrigger />
        </div>
        <div className="px-4 pb-2">
          <Button
            className="w-full"
            size="sm"
            onClick={onCreateWorkflow}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Workflow
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {menuItems.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.value}>
                    <SidebarMenuButton
                      isActive={selectedFilter === item.value}
                      onClick={() => onFilterChange?.(item.value)}
                      className="w-full"
                    >
                      <item.icon
                        className={cn(
                          'mr-2 h-4 w-4',
                          'color' in item ? item.color : undefined,
                          selectedFilter === item.value && 'text-primary'
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                      {'count' in item && item.count !== undefined && (
                        <Badge
                          variant={selectedFilter === item.value ? 'default' : 'secondary'}
                          className="ml-auto"
                        >
                          {item.count}
                        </Badge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => onFilterChange?.('settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}