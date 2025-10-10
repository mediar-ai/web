'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrganization, useUser, useClerk } from '@clerk/nextjs';
import { useState, Suspense, useEffect } from 'react';
import {
  LayoutGrid,
  Settings,
  ChevronRight,
  ChevronLeft,
  Building2,
  Shield,
  LogOut,
  Database,
  Lock,
  Bell
} from 'lucide-react';
import { MediarOrgSwitcher } from '@/components/admin/MediarOrgSwitcher';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  mediarOnly?: boolean;
}

import { MEDIAR_ORG_IDS } from '@/lib/constants';

export function Sidebar() {
  const pathname = usePathname();
  const { organization, membership } = useOrganization();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMediarAdmin, setIsMediarAdmin] = useState(false);

  // Load collapsed state from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const stored = localStorage.getItem('sidebarCollapsed');
    if (stored === 'true') {
      setIsCollapsed(true);
    }
  }, []);

  // Check if user is a Mediar admin
  useEffect(() => {
    if (user) {
      const hasMediarEmail = user.emailAddresses?.some(
        email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
      ) || false;
      setIsMediarAdmin(hasMediarEmail);
    }
  }, [user]);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', newState.toString());
    }
  };

  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const _isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);

  const navigation: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
    { label: 'Alerts', href: '/notifications', icon: Bell },
    { label: 'Settings', href: '/settings', icon: Settings },
    { label: 'Admin', href: '/admin', icon: Shield, mediarOnly: true },
    { label: 'Observability', href: '/observability', icon: Database, mediarOnly: true },
  ];

  const filteredNav = navigation.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.mediarOnly && !isMediarAdmin) return false; // Show Admin for @mediar.ai users
    return true;
  });

  return (
    <div className={`fixed left-0 top-0 h-full ${isCollapsed ? 'w-16' : 'w-64'} bg-white border-r-2 border-black flex flex-col transition-all duration-200`}>
      {/* Toggle Button - Inside sidebar at right edge */}
      <button
        onClick={toggleSidebar}
        className="absolute right-2 top-6 p-1.5 bg-white border border-black hover:bg-black hover:text-white transition-colors z-10"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Logo/Brand */}
      <div className="p-6 border-b-2 border-black">
        <h1 className={`font-mono font-bold text-xl transition-opacity ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
          MEDIAR
        </h1>
      </div>

      {/* Organization Switcher */}
      {!isCollapsed && (
        <div className="px-6 py-4 border-b border-gray-200">
          <Suspense fallback={
            organization ? (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                <span className="font-mono text-sm truncate">{organization.name}</span>
              </div>
            ) : null
          }>
            <MediarOrgSwitcher inSidebar={true} />
          </Suspense>
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
                    flex items-center gap-3 px-3 py-2 font-mono text-sm transition-colors relative
                    ${isActive
                      ? 'bg-black text-white'
                      : 'hover:bg-gray-100 text-black'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  title={isCollapsed ? `${item.label}${item.mediarOnly ? ' (Mediar Admin Only)' : ''}` : undefined}
                >
                  <div className="relative">
                    <Icon className="w-4 h-4" />
                    {isCollapsed && item.mediarOnly && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-black rounded-full" />
                    )}
                  </div>
                  {!isCollapsed && (
                    <>
                      <span className="flex items-center gap-2">
                        {item.label}
                        {item.mediarOnly && (
                          <span
                            className="inline-flex items-center justify-center w-4 h-4 bg-black text-white rounded-sm"
                            title="Mediar Admin Only"
                          >
                            <Lock className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </span>
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
      <div className="p-4 border-t-2 border-black space-y-2">
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

        {/* Logout Button */}
        <button
          onClick={() => signOut()}
          className={`
            w-full flex items-center gap-3 px-3 py-2 font-mono text-sm
            text-black hover:bg-black hover:text-white
            border-2 border-black transition-colors
            ${isCollapsed ? 'justify-center' : ''}
          `}
          title={isCollapsed ? 'Sign Out' : undefined}
        >
          <LogOut className="w-4 h-4" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );
}