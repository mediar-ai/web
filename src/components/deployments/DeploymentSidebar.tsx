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
  SidebarTrigger,
  // SidebarMenuSub,
  // SidebarMenuSubButton,
  // SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Activity,
  Settings,
  Plus,
  Calendar,
  Bell,
  FileText,
  BookOpen,
  ExternalLink,
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
  canViewAlerts?: boolean;
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
  canViewAlerts = false,
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
          label: 'Manual (API)',
          value: 'manual',
          count: stats.total - stats.automated,
        },
        {
          icon: Calendar,
          label: 'Scheduled (Cron)',
          value: 'automated',
          count: stats.automated,
        },
      ],
    },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-4 py-2 flex items-center justify-between group">
          <h2 className="text-sm font-semibold font-mono uppercase">Deployments</h2>
          <SidebarTrigger className="transition-opacity opacity-0 group-hover:opacity-100 data-[state=collapsed]:opacity-100" />
        </div>
        <div className="px-4 pb-2">
          <Button
            className="w-full bg-black text-white hover:bg-gray-800"
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
            <SidebarGroupLabel className="text-xs">{group.label}</SidebarGroupLabel>
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
                          selectedFilter === item.value ? 'text-black' : 'text-gray-600'
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
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs">Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {canViewAlerts && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => window.location.href = '/internal/notifications'}
                    className="hover:bg-black hover:text-white"
                  >
                    <Bell className="mr-2 h-4 w-4" />
                    <span className="flex-1">Alerts</span>
                    <ExternalLink className="h-3 w-3 ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => window.open('/docs/api/remote-workflows', '_blank')}
                  className="hover:bg-black hover:text-white"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span className="flex-1">API Docs</span>
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => window.open('/docs/api/mcp', '_blank')}
                  className="hover:bg-black hover:text-white"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  <span className="flex-1">MCP Docs</span>
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => onFilterChange?.('settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  );
}