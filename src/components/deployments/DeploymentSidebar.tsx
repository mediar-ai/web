'use client';

import React, { useEffect } from 'react';
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
  currentPage?: 'deployments' | 'alerts' | 'settings' | 'dashboard';
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
  currentPage,
}: DeploymentSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Add keyboard shortcut for new workflow
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for just 'N' key (not in input fields)
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        // Don't trigger if user is typing in an input, textarea, or contenteditable
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable) {
          return;
        }
        e.preventDefault();
        onCreateWorkflow?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCreateWorkflow]);

  // Determine current page from pathname if not explicitly provided
  const activePage = currentPage || (
    pathname?.includes('/dashboard') ? 'dashboard' :
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
          label: 'Dashboard',
          value: 'page-dashboard',
          href: '/dashboard',
          isActive: activePage === 'dashboard',
        },
        {
          icon: Bell,
          label: 'Alerts',
          value: 'page-alerts',
          href: '/notifications',
          isActive: activePage === 'alerts',
        },
      ],
    },
    // Only show workflow filters on the deployments page
    ...(activePage === 'deployments' ? [{
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
    }] : []),
  ];

  return (
    <Sidebar className="h-full">
      <SidebarHeader>
        <div className="px-4 py-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold font-mono uppercase">Deployments</h2>
          <SidebarTrigger className="h-6 w-6 hover:bg-gray-200 rounded" />
        </div>
        <div className="px-4 pb-2">
          <Button
            className="w-full bg-black text-white hover:bg-gray-800 group/button"
            size="sm"
            onClick={onCreateWorkflow}
            title="Create new workflow (Press N)"
          >
            <Plus className="mr-2 h-4 w-4" />
            <span className="flex-1 text-left">New Workflow</span>
            <kbd className="ml-2 px-2 py-0.5 text-[10px] bg-gray-700 text-gray-200 rounded font-mono group-hover/button:bg-gray-600">
              N
            </kbd>
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
                          isNavigationItem && isActive && "!bg-black !text-white hover:!bg-gray-800 [&>svg]:!text-white"
                        )}
                      >
                        <item.icon className="mr-2 h-4 w-4" />
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