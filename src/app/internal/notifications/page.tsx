'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Mail, X, Zap, Bell, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth, useUser } from '@clerk/nextjs';
import { DeploymentSidebar } from '@/components/deployments/DeploymentSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

interface NotificationConfig {
  id?: number;
  name: string;
  enabled: boolean;
  email_enabled: boolean;
  email_recipients: string[];
  condition_type: 'error' | 'failure_rate' | 'execution_time' | 'custom';
  condition_value: any;
  cooldown_minutes: number;
  max_alerts_per_hour: number;
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
  const { userId, has } = useAuth();
  const { user } = useUser();
  const [configs, setConfigs] = useState<NotificationConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<NotificationConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [emailError, setEmailError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Check if user is authorized
  const userEmail = user?.emailAddresses?.[0]?.emailAddress ||
                   user?.primaryEmailAddress?.emailAddress || '';
  const allowedUserIds = ['user_REDACTED'];
  const isAuthorized =
    ['louis@mediar.ai', 'matt@mediar.ai'].includes(userEmail.toLowerCase()) ||
    allowedUserIds.includes(userId || '') ||
    has?.({ role: 'org:admin' });

  useEffect(() => {
    if (isAuthorized) {
      fetchConfigs();
    }
  }, [isAuthorized]);

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

  const handleCreateConfig = () => {
    setSelectedConfig({
      name: 'Workflow Error Alerts',
      enabled: true,
      email_enabled: true,
      email_recipients: [],
      condition_type: 'error',
      condition_value: {},
      cooldown_minutes: 5,
      max_alerts_per_hour: 20,
    });
    setIsCreating(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedConfig) return;

    if (selectedConfig.email_recipients.length === 0) {
      setEmailError('Add at least one email address');
      return;
    }

    setIsSaving(true);
    try {
      const url = isCreating
        ? '/api/internal/notifications/configs'
        : `/api/internal/notifications/configs/${selectedConfig.id}`;

      const configToSave = {
        ...selectedConfig,
        condition_type: 'error',
        email_enabled: true,
        cooldown_minutes: 5,
        max_alerts_per_hour: 20,
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
          // Try with your verified email
          const fallbackResponse = await fetch('/api/internal/test-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: 'louis.beaumont@gmail.com', // Your verified email
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
    return <div className="flex items-center justify-center min-h-screen bg-white">Loading...</div>;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <DeploymentSidebar
          canViewAlerts={true}
          currentPage="alerts"
        />
        <div className="flex-1 bg-white p-8">
      <div className="max-w-4xl mx-auto">
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
          <h1 className="text-3xl font-bold text-black flex items-center gap-2">
            <Bell className="w-8 h-8" />
            Error Alerts
          </h1>
          <p className="text-gray-600 mt-2">Get notified when workflows fail</p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Configurations List */}
          <div>
            <Card className="border-2 border-black">
              <CardHeader className="border-b-2 border-black bg-gray-50">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-xl font-mono">RULES</CardTitle>
                  <Button
                    onClick={handleCreateConfig}
                    className="bg-black text-white hover:bg-gray-800 font-mono"
                    size="sm"
                  >
                    + NEW
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {configs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-2" />
                    <p className="font-mono">NO RULES</p>
                    <p className="text-sm mt-1">Create one to get started</p>
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
              <CardHeader className="border-b-2 border-black bg-gray-50">
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

                  {/* Email List */}
                  <div className="mt-3 space-y-2">
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
          )}
        </div>
      </div>
        </div>
      </div>
    </SidebarProvider>
  );
}