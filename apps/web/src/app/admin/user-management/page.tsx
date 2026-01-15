'use client';

import { useCallback, useState } from 'react';
import { Users, Search, Shield, ShieldOff, ShieldAlert } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';
import { fetchJson } from '@/lib/fetch-utils';
import { toast } from 'sonner';

interface UserData {
  user_id: string;
  email: string | null;
  status: string | null;
  status_reason: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
  created_at: string;
}

interface UsersResponse {
  users: UserData[];
  timestamp: string;
}

type UserStatus = 'active' | 'trial_expired' | 'suspended';

const STATUS_CONFIG: Record<UserStatus, { label: string; icon: typeof Shield; className: string }> = {
  active: {
    label: 'ACTIVE',
    icon: Shield,
    className: 'bg-white text-black border-2 border-black',
  },
  trial_expired: {
    label: 'TRIAL EXPIRED',
    icon: ShieldOff,
    className: 'bg-black text-white border-2 border-black',
  },
  suspended: {
    label: 'SUSPENDED',
    icon: ShieldAlert,
    className: 'bg-gray-200 text-gray-800 border-2 border-gray-400',
  },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function UserManagementPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<UsersResponse> => {
    console.log('[user-management] Fetching data...');
    return fetchJson<UsersResponse>('/api/admin/user-status');
  }, []);

  const {
    data,
    loading,
    isRefreshing,
    autoRefreshEnabled,
    toggleAutoRefresh,
    refresh,
    lastUpdatedAgo,
    error,
  } = useAutoRefresh(fetchData, {
    interval: REFRESH_INTERVAL,
    storageKey: 'admin-user-management-auto-refresh',
  });

  // Filter users by search query
  const filteredUsers = data?.users.filter(user => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.email?.toLowerCase().includes(query) ||
      user.user_id.toLowerCase().includes(query)
    );
  }) || [];

  // Update user status
  const updateUserStatus = async (
    userId: string,
    email: string | null,
    newStatus: UserStatus,
    reason?: string
  ) => {
    setUpdatingUser(userId);
    try {
      const response = await fetch('/api/admin/user-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email,
          status: newStatus,
          reason,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update status');
      }

      toast.success(`User status updated to ${newStatus}`);
      refresh(); // Refresh the list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingUser(null);
    }
  };

  // Quick action to expire trial
  const handleExpireTrial = async (user: UserData) => {
    const reason = 'Your trial has ended. Please upgrade to continue using Mediar.';
    if (confirm(`Set "${user.email}" status to TRIAL EXPIRED?`)) {
      await updateUserStatus(user.user_id, user.email, 'trial_expired', reason);
    }
  };

  // Quick action to reactivate
  const handleReactivate = async (user: UserData) => {
    if (confirm(`Reactivate "${user.email}"?`)) {
      await updateUserStatus(user.user_id, user.email, 'active');
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="border-2 border-black p-6">
          <p className="font-mono text-red-600">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Users className="w-6 h-6" />
            USER MANAGEMENT
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Manage user access and trial status
          </p>
        </div>
        <AutoRefreshControls
          loading={loading}
          isRefreshing={isRefreshing}
          autoRefreshEnabled={autoRefreshEnabled}
          lastUpdatedAgo={lastUpdatedAgo}
          intervalSeconds={REFRESH_INTERVAL / 1000}
          onRefresh={refresh}
          onToggleAutoRefresh={toggleAutoRefresh}
        />
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by email or user ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
      </div>

      {/* User List */}
      {loading && !data ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">Loading users...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">
            {searchQuery ? 'No users match your search.' : 'No users found.'}
          </p>
        </div>
      ) : (
        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b-2 border-black bg-black text-white">
                <th className="text-left p-3 font-mono text-sm font-bold">Email</th>
                <th className="text-left p-3 font-mono text-sm font-bold">Status</th>
                <th className="text-left p-3 font-mono text-sm font-bold">Reason</th>
                <th className="text-left p-3 font-mono text-sm font-bold">Updated</th>
                <th className="text-left p-3 font-mono text-sm font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, index) => {
                const status = (user.status || 'active') as UserStatus;
                const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.active;
                const StatusIcon = statusConfig.icon;
                const isUpdating = updatingUser === user.user_id;

                return (
                  <tr
                    key={user.user_id}
                    className={`border-b border-gray-200 hover:bg-gray-50 ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    <td className="p-3 font-mono text-sm">
                      <div className="flex flex-col">
                        <span>{user.email || '-'}</span>
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">
                          {user.user_id}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 font-mono text-xs font-bold ${statusConfig.className}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-gray-600 max-w-[200px] truncate">
                      {user.status_reason || '-'}
                    </td>
                    <td className="p-3 font-mono text-xs text-gray-600">
                      <div className="flex flex-col">
                        <span>{formatDate(user.status_updated_at)}</span>
                        {user.status_updated_by && (
                          <span className="text-gray-400">by {user.status_updated_by}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        {status === 'active' ? (
                          <button
                            onClick={() => handleExpireTrial(user)}
                            disabled={isUpdating}
                            className="px-3 py-1 font-mono text-xs font-bold border-2 border-black bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? '...' : 'EXPIRE TRIAL'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(user)}
                            disabled={isUpdating}
                            className="px-3 py-1 font-mono text-xs font-bold border-2 border-black bg-white text-black hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? '...' : 'REACTIVATE'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats */}
      {data && (
        <div className="mt-4 flex gap-4 font-mono text-sm text-gray-600">
          <span>Total: {data.users.length}</span>
          <span>|</span>
          <span>Active: {data.users.filter(u => !u.status || u.status === 'active').length}</span>
          <span>|</span>
          <span>Trial Expired: {data.users.filter(u => u.status === 'trial_expired').length}</span>
          <span>|</span>
          <span>Suspended: {data.users.filter(u => u.status === 'suspended').length}</span>
        </div>
      )}
    </div>
  );
}
