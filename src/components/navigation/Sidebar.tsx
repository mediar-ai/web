'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrganization, useUser } from '@clerk/nextjs';
import { useState } from 'react';
import {
  LayoutGrid,
  Users,
  Settings,
  Mail,
  Activity,
  ChevronRight,
  ChevronLeft,
  Building2,
  Home,
  Bell,
  Shield
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  mediarOnly?: boolean;
}

const MEDIAR_ORG_IDS = [
  'org_REDACTED',
  'org_REDACTED',
];

export function Sidebar() {
  const pathname = usePathname();
  const { organization, membership } = useOrganization();
  const { user } = useUser();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    }
    return false;
  });

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', newState.toString());
    }
  };

  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);

  const navigation: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
    { label: 'Deployments', href: '/deployments', icon: Activity },
    { label: 'Settings', href: '/settings', icon: Settings },
    { label: 'Admin', href: '/admin', icon: Shield, mediarOnly: true },
  ];

  const filteredNav = navigation.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.mediarOnly && !isMediarOrg) return false;
    return true;
  });

  return (
    <div className={`fixed left-0 top-0 h-full ${isCollapsed ? 'w-16' : 'w-64'} bg-white border-r-2 border-black flex flex-col transition-all duration-200`}>
      {/* Logo/Brand with Collapse Button */}
      <div className="p-6 border-b-2 border-black flex items-center justify-between">
        <h1 className={`font-mono font-bold text-xl transition-opacity ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
          MEDIAR
        </h1>
        <button
          onClick={toggleSidebar}
          className="p-1 hover:bg-gray-100 transition-colors"
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Organization Switcher */}
      {organization && !isCollapsed && (
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            <span className="font-mono text-sm truncate">{organization.name}</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {filteredNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href ||
                           (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2 font-mono text-sm transition-colors
                    ${isActive
                      ? 'bg-black text-white'
                      : 'hover:bg-gray-100 text-black'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon className="w-4 h-4" />
                  {!isCollapsed && (
                    <>
                      <span>{item.label}</span>
                      {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Section */}
      <div className="p-4 border-t-2 border-black">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : 'px-3'} py-2`}>
          <div className="w-8 h-8 bg-black text-white flex items-center justify-center font-mono text-xs flex-shrink-0">
            {user?.firstName?.[0] || user?.username?.[0] || 'U'}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm truncate">
                {user?.firstName || user?.username || 'User'}
              </p>
              <p className="font-mono text-xs text-gray-500 truncate">
                {membership?.role?.replace('org:', '')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}