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
  Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePathname, useRouter } from 'next/navigation';

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
  currentPage?: 'deployments' | 'alerts' | 'settings';
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
  currentPage,
}: DeploymentSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Determine current page from pathname if not explicitly provided
  const activePage = currentPage || (
    pathname?.includes('/notifications') ? 'alerts' :
    pathname?.includes('/settings') ? 'settings' :
    'deployments'
  );

  const menuItems = [
    {
      label: 'Navigation',
      items: [
        {
          icon: Rocket,
          label: 'Deployments',
          value: 'page-deployments',
          href: '/deployments',
          isActive: activePage === 'deployments',
        },
        ...(canViewAlerts ? [{
          icon: Bell,
          label: 'Alerts',
          value: 'page-alerts',
          href: '/internal/notifications',
          isActive: activePage === 'alerts',
        }] : []),
      ],
    },
    {
      label: 'Workflows',
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
                {group.items.map((item) => {
                  // Check if this is a navigation item or a filter item
                  const isNavigationItem = 'href' in item;
                  const isActive = isNavigationItem ? item.isActive : selectedFilter === item.value;

                  return (
                    <SidebarMenuItem key={item.value}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => {
                          if (isNavigationItem) {
                            router.push(item.href);
                          } else {
                            onFilterChange?.(item.value);
                          }
                        }}
                        className={cn(
                          "w-full",
                          isNavigationItem && isActive && "bg-black text-white hover:bg-gray-800"
                        )}
                      >
                        <item.icon
                          className={cn(
                            'mr-2 h-4 w-4',
                            isActive ? (isNavigationItem ? 'text-white' : 'text-black') : 'text-gray-600'
                          )}
                        />
                        <span className="flex-1">{item.label}</span>
                        {'count' in item && item.count !== undefined && (
                          <Badge
                            variant={isActive ? 'default' : 'secondary'}
                            className="ml-auto"
                          >
                            {item.count}
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
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