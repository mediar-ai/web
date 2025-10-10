'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Mail, X, Bell, CheckCircle, AlertTriangle, Globe, Building2, Eye, Trash2 } from 'lucide-react';
import { useAuth, useUser } from '@clerk/nextjs';
import { DeploymentSidebar } from '@/components/deployments/DeploymentSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

interface NotificationConfig {
  id?: number;
  name: string;
  enabled: boolean;
  email_enabled: boolean;
  email_recipients: string[];
  condition_type: 'error' | 'exception' | 'failure_rate' | 'execution_time' | 'custom';
  condition_value: any;
  cooldown_minutes: number;
  max_alerts_per_hour: number;
  organization_id?: string | null;
}

interface Organization {
  id: string;
  name: string;
  clerk_organization_id: string;
  member_count: number;
  created_at: string;
  is_active: boolean;
  logo_url?: string;
  slug?: string;
}

interface OrgMember {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

// Simple toast component
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'warning'; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500'
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <X className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />
  };

  return (
    <div className={`fixed bottom-4 right-4 ${colors[type]} text-white p-4 rounded-lg shadow-lg flex items-center gap-3 z-50`}>
      {icons[type]}
      <span>{message}</span>
      <button onClick={onClose} className="ml-4">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default function NotificationsPage() {
  const { } = useAuth();
  const { user } = useUser();
  const [configs, setConfigs] = useState<NotificationConfig[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgMembers, setOrgMembers] = useState<Record<string, OrgMember[]>>({});
  const [selectedConfig, setSelectedConfig] = useState<NotificationConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [emailError, setEmailError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPreviewOrg, setSelectedPreviewOrg] = useState<string>('');

  // Check if user is authorized - only @mediar.ai emails can access
  const hasMediarEmail = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isAuthorized = hasMediarEmail;

  useEffect(() => {
    if (isAuthorized) {
      fetchAllData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchConfigs(),
        fetchOrganizations()
      ]);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfigs = async () => {
    try {
      const response = await fetch('/api/internal/notifications/configs');
      const data = await response.json();
      if (data.success) {
        setConfigs(data.configs);
      }
    } catch (error) {
      console.error('Failed to fetch configs:', error);
    }
  };

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/admin/organizations');
      const data = await response.json();
      if (data.organizations) {
        setOrganizations(data.organizations);
        // Fetch members for each organization
        for (const org of data.organizations) {
          fetchOrgMembers(org.clerk_organization_id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    }
  };

  const fetchOrgMembers = async (orgId: string) => {
    try {
      const response = await fetch(`/api/organization-members?orgId=${orgId}`);
      const data = await response.json();
      if (data.members) {
        setOrgMembers(prev => ({
          ...prev,
          [orgId]: data.members
        }));
      }
    } catch (error) {
      console.error(`Failed to fetch members for org ${orgId}:`, error);
    }
  };

  // Helper function to get organization name
  const getOrgName = (orgId: string | null | undefined): string => {
    if (!orgId) return 'All Organizations';
    const org = organizations.find(o => o.clerk_organization_id === orgId);
    return org?.name || 'Unknown Organization';
  };

  // Helper function to calculate effective recipients
  const getEffectiveRecipients = (config: NotificationConfig): string[] => {
    const recipients = [...config.email_recipients];

    if (config.organization_id) {
      const members = orgMembers[config.organization_id] || [];
      const memberEmails = members.map(m => m.email).filter(Boolean);
      // Combine and deduplicate
      return [...new Set([...recipients, ...memberEmails])];
    }

    return recipients;
  };

  // Helper function to get effective recipients for a specific org (for preview)
  const getEffectiveRecipientsForOrg = (config: NotificationConfig, orgId: string): { email: string; source: 'additional' | 'org' }[] => {
    const result: { email: string; source: 'additional' | 'org' }[] = [];

    // Add additional recipients
    config.email_recipients.forEach(email => {
      result.push({ email, source: 'additional' });
    });

    // Add org members
    const members = orgMembers[orgId] || [];
    members.forEach(member => {
      if (member.email && !result.find(r => r.email === member.email)) {
        result.push({ email: member.email, source: 'org' });
      }
    });

    return result;
  };

  // Filter and search configs
  const filteredConfigs = configs.filter(config => {
    // Filter by organization
    if (filterOrg !== 'all') {
      if (filterOrg === 'global' && config.organization_id !== null) return false;
      if (filterOrg !== 'global' && config.organization_id !== filterOrg) return false;
    }

    // Search by name or org name
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const configName = config.name.toLowerCase();
      const orgName = getOrgName(config.organization_id).toLowerCase();
      if (!configName.includes(query) && !orgName.includes(query)) return false;
    }

    return true;
  });

  const handleCreateConfig = () => {
    setSelectedConfig({
      name: 'Workflow Exception Alerts',
      enabled: true,
      email_enabled: true,
      email_recipients: [],
      condition_type: 'exception',
      condition_value: {},
      cooldown_minutes: 5,
      max_alerts_per_hour: 20,
    });
    setIsCreating(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedConfig) return;

    if (selectedConfig.email_recipients.length === 0) {
      setEmailError('Add at least one additional recipient (org members are auto-included)');
      return;
    }

    setIsSaving(true);
    try {
      const url = isCreating
        ? '/api/internal/notifications/configs'
        : `/api/internal/notifications/configs/${selectedConfig.id}`;

      const configToSave = {
        ...selectedConfig,
        // Keep user-selected values
      };

      const response = await fetch(url, {
        method: isCreating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave),
      });

      if (response.ok) {
        setToast({ message: 'Alert rule saved successfully!', type: 'success' });
        fetchConfigs();
        if (isCreating) {
          const data = await response.json();
          setSelectedConfig(data.config);
          setIsCreating(false);
        }
      } else {
        setToast({ message: 'Failed to save alert rule', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      setToast({ message: 'Failed to save alert rule', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfig = async (id: number) => {
    if (!confirm('Delete this alert configuration?')) return;

    try {
      const response = await fetch(`/api/internal/notifications/configs/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setToast({ message: 'Alert rule deleted', type: 'success' });
        fetchConfigs();
        if (selectedConfig?.id === id) {
          setSelectedConfig(null);
        }
      } else {
        setToast({ message: 'Failed to delete alert rule', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to delete config:', error);
      setToast({ message: 'Failed to delete alert rule', type: 'error' });
    }
  };

  const handleAddEmail = () => {
    if (!emailInput) {
      setEmailError('Enter an email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
      setEmailError('Invalid email format');
      return;
    }

    if (selectedConfig) {
      if (selectedConfig.email_recipients.includes(emailInput)) {
        setEmailError('Email already added');
        return;
      }

      setSelectedConfig({
        ...selectedConfig,
        email_recipients: [...selectedConfig.email_recipients, emailInput],
      });
      setEmailInput('');
      setEmailError('');
    }
  };

  const handleRemoveEmail = (index: number) => {
    if (selectedConfig) {
      const newEmails = [...selectedConfig.email_recipients];
      newEmails.splice(index, 1);
      setSelectedConfig({
        ...selectedConfig,
        email_recipients: newEmails,
      });
    }
  };

  const sendTestEmail = async () => {
    if (!selectedConfig || selectedConfig.email_recipients.length === 0) {
      setEmailError('Add email recipients first');
      return;
    }

    setTestLoading(true);
    try {
      if (isCreating || !selectedConfig.id) {
        await handleSaveConfig();
      }

      const testRecipient = selectedConfig.email_recipients[0];
      const response = await fetch('/api/internal/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testRecipient,
          subject: `Test Alert - ${selectedConfig.name}`,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setToast({
          message: `Test email sent to ${testRecipient}`,
          type: 'success'
        });
      } else {
        if (data.error?.includes('domain is not verified')) {
          const fallbackResponse = await fetch('/api/internal/test-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: 'louis.beaumont@gmail.com',
              subject: `Test Alert - ${selectedConfig.name}`,
            }),
          });

          if (fallbackResponse.ok) {
            setToast({
              message: 'Test sent to louis.beaumont@gmail.com (domain verification pending)',
              type: 'warning'
            });
          } else {
            setToast({ message: 'Failed to send test email', type: 'error' });
          }
        } else {
          setToast({ message: data.error || 'Failed to send test email', type: 'error' });
        }
      }
    } catch (error) {
      console.error('Failed to send test:', error);
      setToast({ message: 'Failed to send test email', type: 'error' });
    } finally {
      setTestLoading(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Card className="max-w-md border-black">
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <SidebarProvider>
        <div className="flex min-h-screen">
          <DeploymentSidebar
            currentPage="alerts"
          />
          <main className="flex-1 bg-white">
            <div className="max-w-7xl mx-auto px-8 py-12">
              <div className="mb-8">
                <Skeleton className="h-10 w-64 mb-2" />
                <Skeleton className="h-6 w-96" />
              </div>
              <div className="space-y-4 mb-8">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            </div>
          </main>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <DeploymentSidebar
          currentPage="alerts"
        />
        <div className="flex-1 bg-white p-8">
          <div className="max-w-7xl mx-auto">
            {/* Toast Notification */}
            {toast && (
              <Toast
                message={toast.message}
                type={toast.type}
                onClose={() => setToast(null)}
              />
            )}

            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-black flex items-center gap-2 font-mono">
                    <Bell className="w-8 h-8" />
                    INTERNAL NOTIFICATIONS ADMIN
                  </h1>
                  <p className="text-gray-600 mt-2 font-mono text-sm">
                    Manage alert rules for all organizations
                  </p>
                </div>
                <Button
                  onClick={handleCreateConfig}
                  className="bg-black text-white hover:bg-gray-800 font-mono font-bold"
                >
                  + NEW RULE
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="mb-6 flex gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search rules or organizations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="border-2 border-black focus:border-black font-mono"
                />
              </div>
              <select
                value={filterOrg}
                onChange={(e) => setFilterOrg(e.target.value)}
                className="px-4 py-2 border-2 border-black font-mono font-bold focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="all">ALL ORGANIZATIONS</option>
                <option value="global">GLOBAL RULES</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.clerk_organization_id}>
                    {org.name.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <Card className="border-2 border-black">
                <CardContent className="p-4">
                  <p className="font-mono text-xs text-gray-600">TOTAL RULES</p>
                  <p className="font-mono text-2xl font-bold">{configs.length}</p>
                </CardContent>
              </Card>
              <Card className="border-2 border-black">
                <CardContent className="p-4">
                  <p className="font-mono text-xs text-gray-600">ORGANIZATIONS</p>
                  <p className="font-mono text-2xl font-bold">{organizations.length}</p>
                </CardContent>
              </Card>
              <Card className="border-2 border-black">
                <CardContent className="p-4">
                  <p className="font-mono text-xs text-gray-600">ACTIVE RULES</p>
                  <p className="font-mono text-2xl font-bold">{configs.filter(c => c.enabled).length}</p>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <div className="border-2 border-black overflow-hidden">
              <div className="bg-gray-50 p-4 border-b-2 border-black">
                <h2 className="font-mono font-bold text-lg">NOTIFICATION RULES</h2>
              </div>
              {filteredConfigs.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4" />
                  <p className="font-mono font-bold">NO RULES FOUND</p>
                  <p className="font-mono text-sm mt-2">
                    {searchQuery || filterOrg !== 'all'
                      ? 'Try adjusting your filters'
                      : 'Create a new rule to get started'}
                  </p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-white border-b-2 border-black">
                    <tr>
                      <th className="px-4 py-3 text-left font-mono text-xs font-bold">ORGANIZATION</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-bold">RULE NAME</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-bold">STATUS</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-bold">RECIPIENTS</th>
                      <th className="px-4 py-3 text-right font-mono text-xs font-bold">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredConfigs.map((config) => {
                      const effectiveRecipients = getEffectiveRecipients(config);
                      const orgName = getOrgName(config.organization_id);
                      const isGlobal = !config.organization_id;

                      return (
                        <tr
                          key={config.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => {
                            setSelectedConfig(config);
                            setIsCreating(false);
                            setEmailError('');
                          }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isGlobal ? (
                                <>
                                  <Globe className="w-4 h-4" />
                                  <span className="font-mono font-bold">{orgName}</span>
                                </>
                              ) : (
                                <>
                                  <Building2 className="w-4 h-4" />
                                  <span className="font-mono">{orgName}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono">{config.name}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 font-mono text-xs font-bold ${
                              config.enabled
                                ? 'bg-black text-white'
                                : 'bg-gray-200 text-gray-800'
                            }`}>
                              {config.enabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono text-sm">
                              <span className="font-bold">{effectiveRecipients.length}</span> recipient{effectiveRecipients.length !== 1 ? 's' : ''}
                              {config.organization_id ? (
                                <span className="text-gray-600 text-xs ml-2">
                                  ({orgMembers[config.organization_id]?.length || 0} org + {config.email_recipients.length} additional)
                                </span>
                              ) : (
                                config.email_recipients.length > 0 && (
                                  <span className="text-gray-600 text-xs ml-2">
                                    ({config.email_recipients.length} additional + org members auto-added)
                                  </span>
                                )
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedConfig(config);
                                  setIsCreating(false);
                                  setEmailError('');
                                }}
                                className="border-2 border-black hover:bg-black hover:text-white font-mono"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteConfig(config.id!);
                                }}
                                className="border-2 border-black hover:bg-red-600 hover:text-white hover:border-red-600 font-mono"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Edit Modal */}
            {selectedConfig && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <Card className="border-2 border-black max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                  <CardHeader className="border-b-2 border-black bg-gray-50 sticky top-0">
                    <CardTitle className="text-xl font-mono">
                      {isCreating ? 'CREATE RULE' : 'EDIT RULE'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-6">
                    {/* Name */}
                    <div>
                      <Label className="text-black font-mono font-bold">NAME</Label>
                      <Input
                        value={selectedConfig.name}
                        onChange={(e) => setSelectedConfig({
                          ...selectedConfig,
                          name: e.target.value,
                        })}
                        className="border-2 border-gray-300 focus:border-black font-mono"
                        placeholder="e.g., Production Errors"
                      />
                    </div>

                    {/* Enabled Toggle */}
                    <div className="flex items-center justify-between">
                      <Label className="text-black font-mono font-bold">ACTIVE</Label>
                      <Switch
                        checked={selectedConfig.enabled}
                        onCheckedChange={(checked) => setSelectedConfig({
                          ...selectedConfig,
                          enabled: checked,
                        })}
                      />
                    </div>

                    {/* Condition Type Selector */}
                    <div>
                      <Label className="text-black font-mono font-bold">TRIGGER CONDITION</Label>
                      <select
                        value={selectedConfig.condition_type}
                        onChange={(e) => setSelectedConfig({
                          ...selectedConfig,
                          condition_type: e.target.value as 'error' | 'exception' | 'execution_time',
                        })}
                        className="w-full px-3 py-2 border-2 border-black font-mono focus:outline-none focus:ring-2 focus:ring-black bg-white"
                      >
                        <option value="error">WORKFLOW ERRORS (FAILED/ERROR STATUS)</option>
                        <option value="exception">WORKFLOW EXCEPTIONS ONLY</option>
                        <option value="execution_time">SLOW EXECUTIONS</option>
                      </select>
                    </div>

                    {/* Show execution time threshold if that's selected */}
                    {selectedConfig.condition_type === 'execution_time' && (
                      <div>
                        <Label className="text-black font-mono font-bold">MAX EXECUTION TIME (SECONDS)</Label>
                        <Input
                          type="number"
                          value={selectedConfig.condition_value?.max_seconds || 300}
                          onChange={(e) => setSelectedConfig({
                            ...selectedConfig,
                            condition_value: { max_seconds: parseInt(e.target.value) }
                          })}
                          className="border-2 border-gray-300 focus:border-black font-mono"
                        />
                      </div>
                    )}

                    {/* Email Recipients */}
                    <div>
                      <Label className="text-black font-mono font-bold flex items-center gap-1">
                        <Mail className="w-4 h-4" />
                        ADDITIONAL RECIPIENTS
                      </Label>
                      <p className="text-xs text-gray-600 font-mono mt-1 mb-2">
                        Organization members are automatically notified. Add extra recipients here (e.g., admins).
                      </p>

                      <div className="flex gap-2 mt-2">
                        <Input
                          value={emailInput}
                          onChange={(e) => {
                            setEmailInput(e.target.value);
                            setEmailError('');
                          }}
                          placeholder="email@example.com"
                          className="border-2 border-gray-300 focus:border-black font-mono"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddEmail();
                            }
                          }}
                        />
                        <Button
                          onClick={handleAddEmail}
                          className="bg-black text-white hover:bg-gray-800 font-mono"
                        >
                          ADD
                        </Button>
                      </div>

                      {emailError && (
                        <p className="text-red-500 text-sm mt-1 font-mono">{emailError}</p>
                      )}

                      <div className="mt-3 space-y-2">
                        {selectedConfig.email_recipients.length === 0 ? (
                          <p className="text-sm text-gray-500 py-3 font-mono">NO ADDITIONAL RECIPIENTS (ORG MEMBERS AUTO-INCLUDED)</p>
                        ) : (
                          selectedConfig.email_recipients.map((email, index) => (
                            <div key={index} className="flex items-center justify-between p-2 border-2 border-gray-300">
                              <span className="font-mono text-sm">{email}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveEmail(index)}
                                className="h-6 w-6 p-0"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Preview Recipients by Organization */}
                    <div className="border-2 border-gray-300 p-4 bg-gray-50">
                      <Label className="text-black font-mono font-bold flex items-center gap-1 mb-3">
                        <Building2 className="w-4 h-4" />
                        PREVIEW RECIPIENTS BY ORGANIZATION
                      </Label>
                      <p className="text-xs text-gray-600 font-mono mb-3">
                        Select an organization to see which members would receive alerts
                      </p>

                      <select
                        value={selectedPreviewOrg}
                        onChange={(e) => setSelectedPreviewOrg(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-mono focus:outline-none focus:ring-2 focus:ring-black bg-white mb-3"
                      >
                        <option value="">SELECT ORGANIZATION...</option>
                        {organizations.map(org => (
                          <option key={org.id} value={org.clerk_organization_id}>
                            {org.name.toUpperCase()}
                          </option>
                        ))}
                      </select>

                      {selectedPreviewOrg && (
                        <div className="mt-3 p-3 bg-white border-2 border-black">
                          <p className="font-mono text-xs font-bold mb-2">
                            EFFECTIVE RECIPIENTS FOR {getOrgName(selectedPreviewOrg).toUpperCase()}:
                          </p>
                          <div className="space-y-2">
                            {getEffectiveRecipientsForOrg(selectedConfig, selectedPreviewOrg).map((recipient, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 border border-gray-300">
                                <span className="font-mono text-sm">{recipient.email}</span>
                                <span className={`text-xs font-mono px-2 py-1 ${
                                  recipient.source === 'additional'
                                    ? 'bg-black text-white'
                                    : 'bg-gray-200 text-gray-800'
                                }`}>
                                  {recipient.source === 'additional' ? 'ADDITIONAL' : 'ORG MEMBER'}
                                </span>
                              </div>
                            ))}
                            {getEffectiveRecipientsForOrg(selectedConfig, selectedPreviewOrg).length === 0 && (
                              <p className="text-sm text-gray-500 font-mono text-center py-2">
                                NO RECIPIENTS (NO ORG MEMBERS FOUND)
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-4 border-t-2 border-gray-300">
                      <Button
                        onClick={handleSaveConfig}
                        className="flex-1 bg-black text-white hover:bg-gray-800 font-mono"
                        disabled={selectedConfig.email_recipients.length === 0 || isSaving}
                      >
                        {isSaving ? 'SAVING...' : 'SAVE'}
                      </Button>

                      <Button
                        onClick={sendTestEmail}
                        variant="outline"
                        className="border-2 border-black hover:bg-gray-100 font-mono"
                        disabled={selectedConfig.email_recipients.length === 0 || testLoading}
                      >
                        {testLoading ? '...' : 'TEST'}
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedConfig(null);
                          setIsCreating(false);
                          setEmailError('');
                        }}
                        className="border-2 border-gray-300 hover:bg-gray-100 font-mono"
                      >
                        CLOSE
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
