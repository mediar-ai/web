'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrganization, useUser, useClerk } from '@clerk/nextjs';
import { useState, Suspense, useEffect, useMemo } from 'react';
import {
  LayoutGrid,
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Building2,
  Shield,
  LogOut,
  Lock,
  Bell,
  Users,
  User,
  Key,
  Monitor,
  DollarSign,
  FileText,
  Zap,
  BarChart3,
} from 'lucide-react';
import { MediarOrgSwitcher } from '@/components/admin/MediarOrgSwitcher';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlaygroundAccess } from '@/hooks/usePlaygroundAccess';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  mediarOnly?: boolean;
  playgroundAccess?: boolean; // Special flag for playground - checks PostHog feature flag
  children?: NavItem[];
}

import { MEDIAR_ORG_IDS } from '@/lib/constants';

export function Sidebar() {
  const pathname = usePathname();
  const { organization, membership, isLoaded: orgLoaded } = useOrganization();
  const { user, isLoaded: userLoaded } = useUser();
  const { signOut } = useClerk();
  const { hasAccess: hasPlaygroundAccess } = usePlaygroundAccess();
  // Initialize with correct state from localStorage to prevent flicker
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    }
    return false;
  });
  const [isMediarAdmin, setIsMediarAdmin] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const isLoading = !orgLoaded || !userLoaded;

  // Check if user is a Mediar admin
  useEffect(() => {
    if (user) {
      const hasMediarEmail =
        user.emailAddresses?.some(email =>
          email.emailAddress.toLowerCase().endsWith('@mediar.ai')
        ) || false;
      setIsMediarAdmin(hasMediarEmail);
    }
  }, [user]);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', newState.toString());
      // Dispatch custom event for same-tab updates
      window.dispatchEvent(new Event('sidebarToggle'));
    }
  };

  const isAdmin =
    membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const _isMediarOrg =
    organization?.id && MEDIAR_ORG_IDS.includes(organization.id);

  const navigation: NavItem[] = useMemo(
    () => [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
      { label: 'Sandboxes', href: '/my-machines', icon: Monitor },
      { label: 'Alerts', href: '/notifications', icon: Bell },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        children: [
          { label: 'Account', href: '/settings/account', icon: User },
          { label: 'Secrets', href: '/settings/secrets', icon: Key },
          {
            label: 'Team',
            href: '/settings/team',
            icon: Users,
            adminOnly: true,
          },
        ],
      },
      { label: 'Playground', href: '/playground', icon: Zap, playgroundAccess: true },
      {
        label: 'Admin',
        href: '/admin',
        icon: Shield,
        mediarOnly: true,
        children: [
          { label: 'Overview', href: '/admin', icon: LayoutGrid, mediarOnly: true },
          { label: 'Machines', href: '/admin/machines', icon: Monitor, mediarOnly: true },
          { label: 'User Management', href: '/admin/user-management', icon: Shield, mediarOnly: true },
          { label: 'Billing', href: '/admin/billing', icon: DollarSign, mediarOnly: true },
          { label: 'Customer Billing', href: '/admin/customer-billing', icon: FileText, mediarOnly: true },
        ],
      },
    ],
    []
  );

  const filteredNav = useMemo(() => {
    return navigation
      .map(item => {
        // Filter children if they exist
        if (item.children) {
          const filteredChildren = item.children.filter(child => {
            if (child.adminOnly && !isAdmin) return false;
            if (child.mediarOnly && !isMediarAdmin) return false;
            if (child.playgroundAccess && !hasPlaygroundAccess) return false;
            return true;
          });
          return { ...item, children: filteredChildren };
        }
        return item;
      })
      .filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.mediarOnly && !isMediarAdmin) return false;
        if (item.playgroundAccess && !hasPlaygroundAccess) return false;
        return true;
      });
  }, [navigation, isAdmin, isMediarAdmin, hasPlaygroundAccess]);

  const toggleExpanded = (label: string) => {
    setExpandedItems(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  // Auto-expand parent items when on a child page
  useEffect(() => {
    filteredNav.forEach(item => {
      if (item.children && item.children.length > 0) {
        // Check if any child is active
        const hasActiveChild = item.children.some(
          child =>
            pathname === child.href ||
            (child.href !== '/' && pathname.startsWith(child.href + '/'))
        );

        if (hasActiveChild) {
          setExpandedItems(prev => {
            // Only add if not already in the list
            if (!prev.includes(item.label)) {
              return [...prev, item.label];
            }
            return prev;
          });
        }
      }
    });
  }, [pathname, filteredNav]);

  return (
    <div
      className={`fixed left-0 top-0 h-full ${isCollapsed ? 'w-16' : 'w-64'} bg-white border-r-2 border-black flex flex-col transition-all duration-200 z-50`}
    >
      {/* Toggle Button - Inside sidebar at right edge */}
      <button
        onClick={toggleSidebar}
        className="absolute right-2 top-6 p-1.5 bg-white border border-black hover:bg-black hover:text-white transition-colors z-10"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>

      {/* Logo/Brand */}
      <div className="p-6 border-b-2 border-black">
        <Link
          href="/"
          className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${isCollapsed ? 'justify-center' : ''}`}
          title="Go to homepage"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="w-8 h-8 flex-shrink-0"
          >
            <rect width="24" height="24" rx="10" fill="#000" />
            <g transform="translate(12 12) scale(0.65) translate(-12 -12)">
              <rect
                x="3"
                y="3"
                width="8"
                height="8"
                rx="2"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M7 11v4a2 2 0 0 0 2 2h4"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x="13"
                y="13"
                width="8"
                height="8"
                rx="2"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>
          <h1
            className={`font-mono font-bold text-xl transition-opacity ${isCollapsed ? 'hidden' : 'block'}`}
          >
            MEDIAR
          </h1>
        </Link>
      </div>

      {/* Organization Switcher */}
      <div
        className={`${isCollapsed ? 'px-2' : 'px-6'} py-4 border-b border-gray-200`}
      >
        {isLoading ? (
          isCollapsed ? (
            <div className="flex items-center justify-center">
              <Skeleton className="w-4 h-4" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Skeleton className="w-4 h-4" />
              <Skeleton className="w-24 h-4" />
            </div>
          )
        ) : (
          <Suspense
            fallback={
              organization && !isCollapsed ? (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span className="font-mono text-sm truncate">
                    {organization.name}
                  </span>
                </div>
              ) : isCollapsed && organization ? (
                <div className="flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
              ) : null
            }
          >
            <MediarOrgSwitcher inSidebar={true} isCollapsed={isCollapsed} />
          </Suspense>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {isLoading ? (
            // Navigation skeleton
            <>
              {[1, 2, 3, 4].map(i => (
                <li key={i} className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-4 h-4" />
                    {!isCollapsed && <Skeleton className="w-20 h-4" />}
                  </div>
                </li>
              ))}
            </>
          ) : (
            filteredNav.map(item => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href + '/'));
              const hasChildren = item.children && item.children.length > 0;
              const isExpanded = expandedItems.includes(item.label);

              return (
                <li key={item.href}>
                  {/* Parent item */}
                  {hasChildren ? (
                    <div>
                      <div
                        className={`
                        flex items-center gap-3 px-3 py-2 font-mono text-sm transition-colors relative
                        ${
                          isActive
                            ? 'bg-gray-100 text-black border-l-4 border-black'
                            : 'hover:bg-gray-50 text-black'
                        }
                        ${isCollapsed ? 'justify-center' : ''}
                      `}
                      >
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 flex-1"
                          title={
                            isCollapsed
                              ? `${item.label}${item.mediarOnly ? ' (Mediar Admin Only)' : ''}`
                              : undefined
                          }
                        >
                          <div className="relative">
                            <Icon className="w-4 h-4" />
                            {isCollapsed && item.mediarOnly && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-black rounded-full" />
                            )}
                          </div>
                          {!isCollapsed && (
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
                          )}
                        </Link>
                        {!isCollapsed && (
                          <button
                            onClick={() => toggleExpanded(item.label)}
                            className="p-1 hover:opacity-70 transition-opacity"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
                          >
                            <ChevronDown
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        )}
                      </div>

                      {/* Children items */}
                      {!isCollapsed && isExpanded && (
                        <ul className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200">
                          {item.children?.map(child => {
                            const ChildIcon = child.icon;
                            // For items with same href as parent (like Overview), use exact match only
                            const isChildActive =
                              pathname === child.href ||
                              (child.href !== '/' &&
                                child.href !== item.href &&
                                pathname.startsWith(child.href + '/'));

                            return (
                              <li key={child.href}>
                                <Link
                                  href={child.href}
                                  className={`
                                  flex items-center gap-3 px-3 py-2 font-mono text-sm transition-colors relative
                                  ${
                                    isChildActive
                                      ? 'bg-gray-100 text-black border-l-4 border-black'
                                      : 'hover:bg-gray-50 text-black'
                                  }
                                `}
                                >
                                  <ChildIcon className="w-4 h-4" />
                                  <span className="flex-1">{child.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={item.href}
                      className={`
                      flex items-center gap-3 px-3 py-2 font-mono text-sm transition-colors relative
                      ${
                        isActive
                          ? 'bg-gray-100 text-black border-l-4 border-black'
                          : 'hover:bg-gray-50 text-black'
                      }
                      ${isCollapsed ? 'justify-center' : ''}
                    `}
                      title={
                        isCollapsed
                          ? `${item.label}${item.mediarOnly ? ' (Mediar Admin Only)' : ''}${item.playgroundAccess ? ' (Beta)' : ''}`
                          : undefined
                      }
                    >
                      <div className="relative">
                        <Icon className="w-4 h-4" />
                        {isCollapsed && item.mediarOnly && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-black rounded-full" />
                        )}
                        {isCollapsed && item.playgroundAccess && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-gray-400 rounded-full" />
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
                            {item.playgroundAccess && (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[9px] font-bold"
                                title="Beta Access"
                              >
                                BETA
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </Link>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </nav>

      {/* User Section */}
      <div className="p-4 border-t-2 border-black space-y-2">
        {isLoading ? (
          <>
            {/* Skeleton */}
            <div
              className={`flex items-center gap-3 py-2 ${isCollapsed ? 'justify-center' : 'px-3'}`}
            >
              <Skeleton className="w-8 h-8 flex-shrink-0" />
              {!isCollapsed && (
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="w-20 h-4" />
                  <Skeleton className="w-16 h-3" />
                </div>
              )}
            </div>
            <Skeleton className={`w-full h-10 ${isCollapsed ? '' : 'px-3'}`} />
          </>
        ) : (
          <>
            <div
              className={`flex items-center gap-3 py-2 ${isCollapsed ? 'justify-center' : 'px-3'}`}
            >
              <div
                className="w-8 h-8 bg-black text-white flex items-center justify-center font-mono text-xs flex-shrink-0"
                suppressHydrationWarning
              >
                {user?.firstName?.[0] || user?.username?.[0] || 'U'}
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p
                    className="font-mono text-sm truncate"
                    suppressHydrationWarning
                  >
                    {user?.firstName || user?.username || 'User'}
                  </p>
                  <p
                    className="font-mono text-xs text-gray-500 truncate"
                    suppressHydrationWarning
                  >
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
              <LogOut className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && <span>Sign Out</span>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
