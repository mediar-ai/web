'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Mail, X, Zap, Bell, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth, useUser, useOrganizationList } from '@clerk/nextjs';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { AlertsDataTable } from '@/components/notifications/AlertsDataTable';

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

interface NotificationAlertAPI {
  id: number;
  config_id: number;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  workflow_id?: number;
  workflow_name?: string;
  workflow_organization_id?: string;
  execution_id?: number;
  execution_status?: string;
  email_sent: boolean;
  email_sent_at?: string;
  scheduled_for?: string;
  created_at: string;
  recipients?: string[]; // Added by API
}

// Flattened alert for table display (one row per recipient)
interface AlertTableRow {
  id: number;
  alert_id: number;
  config_id: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  workflow_id?: number;
  workflow_name?: string;
  execution_id?: number;
  execution_status?: string;
  recipient_email: string;
  email_sent: boolean;
  email_sent_at?: string;
  scheduled_for?: string;
  created_at: string;
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
  const { userId, orgId } = useAuth();
  const { user } = useUser();
  const { userMemberships, setActive, isLoaded: orgListLoaded } = useOrganizationList();
  const [configs, setConfigs] = useState<NotificationConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<NotificationConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [emailError, setEmailError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [alertTableRows, setAlertTableRows] = useState<AlertTableRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [orgMembers, setOrgMembers] = useState<string[]>([]);
  const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<NotificationConfig | null>(null);
  const [showOrgAlerts, setShowOrgAlerts] = useState(false);

  // Check if user is Mediar admin
  const isMediarAdmin = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;

  // Auto-set the first organization if user has no active org
  useEffect(() => {
    if (orgListLoaded && !orgId && userMemberships?.data && userMemberships.data.length > 0) {
      const firstOrg = userMemberships.data[0];
      console.log(`[Notifications] Auto-setting first organization: ${firstOrg.organization.name} (${firstOrg.organization.id})`);
      setActive?.({ organization: firstOrg.organization.id });
    }
  }, [orgListLoaded, orgId, userMemberships, setActive]);

  useEffect(() => {
    if (userId && orgId) {
      fetchConfigs();
      fetchAlerts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, orgId]); // Intentionally omit fetchConfigs/fetchAlerts to prevent infinite loop

  // Refetch alerts when showOrgAlerts toggle changes
  useEffect(() => {
    if (userId && orgId) {
      fetchAlerts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrgAlerts]); // Intentionally omit fetchAlerts/userId/orgId - only trigger on toggle change

  // Fetch org members when selected config changes
  useEffect(() => {
    if (selectedConfig) {
      fetchOrgMembersForConfig(selectedConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfig?.id, selectedConfig?.organization_id]);

  const fetchOrgMembersForConfig = async (config: NotificationConfig) => {
    if (!orgId) return;
    setLoadingOrgMembers(true);
    try {
      let url = '';

      // Determine which endpoint to use based on config and user
      if (config.organization_id === null) {
        // Global rule
        if (isMediarAdmin) {
          // Mediar admin viewing global rule: fetch from ALL orgs
          url = '/api/organization-members?allOrgs=true';
          console.log('[UI] Fetching members from ALL organizations for global rule (Mediar admin)');
        } else {
          // Regular user viewing global rule: fetch from their org only
          url = `/api/organization-members?orgId=${orgId}`;
          console.log('[UI] Fetching members from current org for global rule (regular user)');
        }
      } else {
        // Org-specific rule: fetch from that org
        url = `/api/organization-members?orgId=${config.organization_id}`;
        console.log(`[UI] Fetching members from specific org: ${config.organization_id}`);
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.success && data.members) {
        // Extract just the emails for display
        const emails = data.members.map((m: any) => m.email).filter(Boolean);
        setOrgMembers(emails);
        console.log(`[UI] Loaded ${emails.length} organization members`);
      }
    } catch (error) {
      console.error('Failed to fetch org members:', error);
    } finally {
      setLoadingOrgMembers(false);
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
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    setAlertsLoading(true);
    try {
      const response = await fetch('/api/internal/notifications/alerts?limit=100');
      const data = await response.json();
      if (data.success) {
        // Get current user's email
        const userEmail = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase();

        // Flatten alerts into table rows (one row per recipient)
        const flattened: AlertTableRow[] = [];
        let rowId = 0;

        data.alerts.forEach((alert: NotificationAlertAPI) => {
          const recipients = alert.recipients || [];

          if (recipients.length === 0) {
            // No recipients - create one row with empty email
            flattened.push({
              id: rowId++,
              alert_id: alert.id,
              config_id: alert.config_id,
              severity: alert.severity,
              title: alert.title,
              workflow_id: alert.workflow_id,
              workflow_name: alert.workflow_name,
              execution_id: alert.execution_id,
              execution_status: alert.execution_status,
              recipient_email: '-',
              email_sent: alert.email_sent,
              email_sent_at: alert.email_sent_at,
              scheduled_for: alert.scheduled_for,
              created_at: alert.created_at,
            });
          } else {
            // Filter recipients based on showOrgAlerts toggle
            const filteredRecipients = showOrgAlerts
              ? recipients
              : recipients.filter(email => email.toLowerCase() === userEmail);

            // Create one row per recipient
            filteredRecipients.forEach((email) => {
              flattened.push({
                id: rowId++,
                alert_id: alert.id,
                config_id: alert.config_id,
                severity: alert.severity,
                title: alert.title,
                workflow_id: alert.workflow_id,
                workflow_name: alert.workflow_name,
                execution_id: alert.execution_id,
                execution_status: alert.execution_status,
                recipient_email: email,
                email_sent: alert.email_sent,
                email_sent_at: alert.email_sent_at,
                scheduled_for: alert.scheduled_for,
                created_at: alert.created_at,
              });
            });
          }
        });

        setAlertTableRows(flattened);
      }
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setAlertsLoading(false);
    }
  };

  const handleCreateConfig = () => {
    const newConfig: NotificationConfig = {
      name: 'Workflow Error Alerts',
      enabled: true,
      email_enabled: true,
      email_recipients: [],
      condition_type: 'error',
      condition_value: {},
      cooldown_minutes: 1,
      max_alerts_per_hour: 60,
    };
    setSelectedConfig(newConfig);
    setOriginalConfig(JSON.parse(JSON.stringify(newConfig)));
    setIsCreating(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedConfig) return;

    setIsSaving(true);
    try {
      const url = isCreating
        ? '/api/internal/notifications/configs'
        : `/api/internal/notifications/configs/${selectedConfig.id}`;

      const configToSave = {
        ...selectedConfig,
        condition_type: 'error',
        email_enabled: true,
        cooldown_minutes: 1,
        max_alerts_per_hour: 60,
      };

      const response = await fetch(url, {
        method: isCreating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave),
      });

      if (response.ok) {
        setToast({ message: 'Alert rule saved successfully!', type: 'success' });
        fetchConfigs();
        // Don't close the card immediately - let user test it
        if (isCreating) {
          const data = await response.json();
          setSelectedConfig(data.config);
          setOriginalConfig(JSON.parse(JSON.stringify(data.config)));
          setIsCreating(false);
        } else {
          // Update original config after successful save
          setOriginalConfig(JSON.parse(JSON.stringify(selectedConfig)));
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
      // First save the config if it's new or modified
      if (isCreating || !selectedConfig.id) {
        await handleSaveConfig();
      }

      // Send a test email - use fallback to test email
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
        // Check for domain verification issue
        if (data.error?.includes('domain is not verified')) {
          // Try with the configured verified fallback email
          const verifiedFallbackEmail =
            process.env.NEXT_PUBLIC_VERIFIED_FALLBACK_EMAIL ?? '';
          const fallbackResponse = await fetch('/api/internal/test-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: verifiedFallbackEmail,
              subject: `Test Alert - ${selectedConfig.name}`,
            }),
          });

          if (fallbackResponse.ok) {
            setToast({
              message: `Test sent to ${verifiedFallbackEmail} (domain verification pending)`,
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

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Card className="max-w-md border-2 border-black">
          <CardHeader>
            <CardTitle className="font-mono">Please sign in to access alerts</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // If user is authenticated but no orgId, show loading while we try to set it
  if (!orgId) {
    // Check if user has organizations
    if (orgListLoaded && userMemberships?.data && userMemberships.data.length === 0) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-white">
          <Card className="max-w-md border-2 border-black">
            <CardHeader>
              <CardTitle className="font-mono">No Organization Found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                You need to be part of an organization to access alerts.
                Contact your administrator to get added to an organization.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Still loading or trying to set active org
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Card className="max-w-md border-2 border-black">
          <CardHeader>
            <CardTitle className="font-mono">Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <div className="max-w-7xl mx-auto">
            {/* Header Skeleton */}
            <div className="mb-10">
              <Skeleton className="h-12 w-72 mb-3" />
              <Skeleton className="h-6 w-96" />
            </div>

            {/* Config Cards Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4">
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
            <h1 className="font-mono font-bold text-3xl mb-2 flex items-center gap-2">
              <Bell className="w-8 h-8" />
              Error Alerts
            </h1>
            <p className="font-mono text-gray-600">Get notified when workflows fail</p>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Configurations List */}
            <div>
            <Card className="border-2 border-black">
              <CardHeader className="border-b-2 border-black bg-gray-50 py-5 px-6">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-2xl font-mono uppercase tracking-wider">Rules</CardTitle>
                  <Button
                    onClick={handleCreateConfig}
                    className="bg-black text-white hover:bg-gray-800 font-mono px-4 py-2"
                    size="default"
                  >
                    + NEW
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {configs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center px-8 py-12">
                    <AlertCircle className="w-20 h-20 mb-6 text-gray-300" />
                    <p className="font-mono font-bold text-xl text-black mb-3 uppercase tracking-wide">No Rules</p>
                    <p className="text-base text-gray-500 max-w-xs">Create one to get started</p>
                  </div>
                ) : (
                  <div>
                    {configs.map((config) => (
                      <div
                        key={config.id}
                        className={`p-4 border-b cursor-pointer transition-all ${
                          selectedConfig?.id === config.id
                            ? 'bg-black text-white'
                            : 'hover:bg-gray-50'
                        }`}
                        onClick={() => {
                          setSelectedConfig(config);
                          setOriginalConfig(JSON.parse(JSON.stringify(config)));
                          setIsCreating(false);
                          setEmailError('');
                        }}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <h3 className="font-mono font-bold">{config.name}</h3>
                            <p className={`text-sm font-mono ${
                              selectedConfig?.id === config.id ? 'text-gray-300' : 'text-gray-600'
                            }`}>
                              {config.email_recipients.length} EMAIL{config.email_recipients.length !== 1 ? 'S' : ''}
                              {config.enabled ? ' • ON' : ' • OFF'}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConfig(config.id!);
                            }}
                            className={selectedConfig?.id === config.id ? 'hover:bg-gray-800 text-white' : ''}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Configuration Editor */}
          {selectedConfig && (
            <Card className="border-2 border-black">
              <CardHeader className="border-b-2 border-black bg-gray-50 py-5 px-6">
                <CardTitle className="text-2xl font-mono uppercase tracking-wider">
                  {isCreating ? 'Create Rule' : 'Edit Rule'}
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

                {/* Trigger Info */}
                <div className="p-3 bg-black text-white">
                  <div className="flex items-center gap-2 text-sm font-mono">
                    <Zap className="w-4 h-4" />
                    <span>TRIGGERS ON: WORKFLOW ERRORS</span>
                  </div>
                </div>

                {/* Email Recipients */}
                <div>
                  <Label className="text-black font-mono font-bold flex items-center gap-1">
                    <Mail className="w-4 h-4" />
                    EMAIL RECIPIENTS
                  </Label>

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

                  {/* Error message */}
                  {emailError && (
                    <p className="text-red-500 text-sm mt-1 font-mono">{emailError}</p>
                  )}

                  {/* Configured Email List */}
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-600 font-mono uppercase mb-2">Configured Recipients</p>
                    {selectedConfig.email_recipients.length === 0 ? (
                      <p className="text-sm text-gray-500 py-3 font-mono">NO EMAILS ADDED</p>
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

                  {/* Organization Members (auto-included) */}
                  {(orgMembers.length > 0 || loadingOrgMembers) && (
                    <div className="mt-4 p-3 bg-gray-50 border-2 border-gray-200">
                      <p className="text-xs text-gray-600 font-mono uppercase mb-2">
                        + Organization Members (Auto-included)
                        {selectedConfig.organization_id === null && isMediarAdmin && (
                          <span className="ml-2 text-xs font-normal normal-case text-gray-500">
                            • From all organizations
                          </span>
                        )}
                      </p>
                      {loadingOrgMembers ? (
                        <p className="text-sm text-gray-500 font-mono">Loading...</p>
                      ) : orgMembers.length === 0 ? (
                        <p className="text-sm text-gray-500 font-mono">No organization members found</p>
                      ) : (
                        <div className="space-y-1">
                          {orgMembers.map((email, index) => (
                            <div key={index} className="flex items-center gap-2 p-1">
                              <span className="font-mono text-xs text-gray-700">{email}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {orgMembers.length > 0 && (
                        <p className="text-xs text-gray-500 font-mono mt-2">
                          Total recipients: {selectedConfig.email_recipients.length + orgMembers.length}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4 border-t-2 border-gray-300">
                  <Button
                    onClick={handleSaveConfig}
                    className="flex-1 bg-black text-white hover:bg-gray-800 font-mono"
                    disabled={
                      isSaving ||
                      (!isCreating && !!originalConfig &&
                        JSON.stringify(selectedConfig.email_recipients.sort()) ===
                        JSON.stringify(originalConfig.email_recipients.sort()))
                    }
                  >
                    {isSaving ? 'SAVING...' : 'SAVE'}
                  </Button>

                  <Button
                    onClick={sendTestEmail}
                    variant="outline"
                    className="border-2 border-black hover:bg-gray-100 font-mono"
                    disabled={(selectedConfig.email_recipients.length === 0 && orgMembers.length === 0) || testLoading}
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
          )}
          </div>

          {/* Alert History Section */}
          <div className="mt-8">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-mono font-bold text-2xl mb-2 flex items-center gap-2">
                  Alert History
                </h2>
                <p className="font-mono text-gray-600 text-sm">View all notification alerts and email delivery status</p>
              </div>
              <div className="flex items-center gap-2 p-3 border-2 border-gray-300 bg-gray-50">
                <input
                  type="checkbox"
                  id="showOrgAlerts"
                  checked={showOrgAlerts}
                  onChange={(e) => setShowOrgAlerts(e.target.checked)}
                  className="w-4 h-4 border-2 border-black focus:ring-2 focus:ring-black cursor-pointer"
                />
                <label htmlFor="showOrgAlerts" className="font-mono text-sm cursor-pointer select-none">
                  Show alerts for all org members
                </label>
              </div>
            </div>
            <AlertsDataTable
              alerts={alertTableRows}
              loading={alertsLoading}
              onRefresh={fetchAlerts}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}