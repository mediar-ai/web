import { supabase } from '@/lib/supabase';
import { clerkClient } from '@clerk/nextjs/server';

export interface NotificationConfig {
  id: number;
  name: string;
  enabled: boolean;
  email_enabled: boolean;
  email_recipients: string[];
  condition_type: 'error' | 'exception' | 'failure_rate' | 'execution_time' | 'cron_auto_pause' | 'custom';
  condition_value: any;
  cooldown_minutes: number;
  max_alerts_per_hour: number;
  organization_id?: string | null; // Clerk organization ID. NULL = global alert for all orgs
}

export interface NotificationAlert {
  id?: number;
  config_id: number;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  details?: any;
  workflow_id?: number;
  execution_id?: number;
  error_message?: string;
}

export class NotificationService {
  private static instance: NotificationService;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async getConfigs(): Promise<NotificationConfig[]> {
    const { data, error } = await supabase
      .from('notification_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async getConfigsByOrg(orgId: string): Promise<NotificationConfig[]> {
    const { data, error } = await supabase
      .from('notification_configs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async getConfig(id: number): Promise<NotificationConfig | null> {
    const { data, error } = await supabase
      .from('notification_configs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async createConfig(config: Omit<NotificationConfig, 'id'>): Promise<NotificationConfig> {
    const { data, error } = await supabase
      .from('notification_configs')
      .insert(config)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateConfig(id: number, updates: Partial<NotificationConfig>): Promise<NotificationConfig> {
    const { data, error } = await supabase
      .from('notification_configs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteConfig(id: number): Promise<void> {
    const { error } = await supabase
      .from('notification_configs')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  async createAlert(alert: Omit<NotificationAlert, 'id'>): Promise<NotificationAlert> {
    const { data, error } = await supabase
      .from('notification_alerts')
      .insert(alert)
      .select()
      .single();

    if (error) throw error;

    // Check if we should send email notification
    const config = await this.getConfig(alert.config_id);
    if (config?.enabled && config?.email_enabled && config?.email_recipients?.length > 0) {
      // Check cooldown and rate limiting
      const rateLimit = await this.checkRateLimits(alert.config_id, config);
      if (rateLimit.shouldSend) {
        // Send immediately
        await this.sendEmailNotification(data, config);
      } else if (rateLimit.waitUntil) {
        // Queue for later delivery
        console.log(`Queueing email for alert ${data.id} until ${rateLimit.waitUntil.toISOString()}`);
        await supabase
          .from('notification_alerts')
          .update({ scheduled_for: rateLimit.waitUntil.toISOString() })
          .eq('id', data.id);
      }
    }

    return data;
  }

  private async checkRateLimits(configId: number, config: NotificationConfig): Promise<{ shouldSend: boolean; waitUntil?: Date }> {

    // Check cooldown period
    const cooldownTime = new Date();
    cooldownTime.setMinutes(cooldownTime.getMinutes() - config.cooldown_minutes);

    const { data: recentAlerts } = await supabase
      .from('notification_alerts')
      .select('created_at, email_sent_at')
      .eq('config_id', configId)
      .eq('email_sent', true)
      .gte('created_at', cooldownTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentAlerts && recentAlerts.length > 0) {
      // Calculate when cooldown expires
      const lastEmailTime = new Date(recentAlerts[0].email_sent_at || recentAlerts[0].created_at);
      const waitUntil = new Date(lastEmailTime.getTime() + (config.cooldown_minutes * 60 * 1000));
      console.log(`Cooldown active for config ${configId}, scheduling for ${waitUntil.toISOString()}`);
      return { shouldSend: false, waitUntil };
    }

    // Check hourly rate limit
    const hourAgo = new Date();
    hourAgo.setHours(hourAgo.getHours() - 1);

    const { data: alertsInWindow, count } = await supabase
      .from('notification_alerts')
      .select('email_sent_at, created_at')
      .eq('config_id', configId)
      .eq('email_sent', true)
      .gte('created_at', hourAgo.toISOString())
      .order('created_at', { ascending: true });

    if (count && count >= config.max_alerts_per_hour) {
      // Calculate when the oldest alert will fall outside the 1-hour window
      // This is when we can send the next alert
      const oldestAlert = alertsInWindow![0];
      const oldestTime = new Date(oldestAlert.email_sent_at || oldestAlert.created_at);
      const waitUntil = new Date(oldestTime.getTime() + (60 * 60 * 1000) + (60 * 1000)); // 1 hour + 1 minute buffer

      console.log(`Rate limit reached for config ${configId} (${count}/${config.max_alerts_per_hour}), scheduling for ${waitUntil.toISOString()}`);
      return { shouldSend: false, waitUntil };
    }

    return { shouldSend: true };
  }

  private async sendEmailNotification(alert: NotificationAlert, config: NotificationConfig): Promise<void> {
    try {
      // Use absolute URL for server-side fetch
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://app.mediar.ai');

      // Start with configured recipients as baseline (never lose these)
      const recipients = [...(config.email_recipients || [])];

      // Determine which organization's members to fetch
      let targetOrgId = config.organization_id; // For org-specific configs

      // For global configs (organization_id is null), use the workflow's organization
      if (!targetOrgId && alert.workflow_id) {
        try {
          const { data: workflow } = await supabase
            .from('deployed_workflows')
            .select('organization_id')
            .eq('id', alert.workflow_id)
            .single();

          targetOrgId = workflow?.organization_id;
          console.log(`Global rule - using workflow's organization: ${targetOrgId || 'none'}`);

          // If workflow has no owner (NULL organization_id), it's a shared workflow
          // Fetch members from ALL organizations with access
          if (!targetOrgId) {
            console.log(`Workflow ${alert.workflow_id} has no owner - checking for shared organizations`);
            try {
              const { data: sharedOrgs } = await supabase
                .from('workflow_organization_access')
                .select('organization_id')
                .eq('workflow_id', alert.workflow_id);

              if (sharedOrgs && sharedOrgs.length > 0) {
                console.log(`Found ${sharedOrgs.length} organizations with access to workflow ${alert.workflow_id}`);

                // Fetch members from each organization using Clerk SDK directly
                for (const org of sharedOrgs) {
                  const orgEmails = await this.getOrganizationMembers(org.organization_id);
                  recipients.push(...orgEmails);
                }

                // Deduplicate emails (important for shared workflows)
                const uniqueRecipients = [...new Set(recipients)];
                console.log(`Total unique recipients after deduplication: ${uniqueRecipients.length}`);
                recipients.length = 0;
                recipients.push(...uniqueRecipients);
              }
            } catch (err) {
              console.error('Error fetching shared organizations:', err);
            }
          }
        } catch (err) {
          console.error('Error fetching workflow organization:', err);
        }
      }

      // Fetch organization members if we have a single target organization
      if (targetOrgId) {
        try {
          console.log(`Fetching organization members for ${targetOrgId}`);
          const orgEmails = await this.getOrganizationMembers(targetOrgId);

          // Combine configured recipients with org members (remove duplicates)
          const uniqueRecipients = [...new Set([...recipients, ...orgEmails])];
          recipients.length = 0;
          recipients.push(...uniqueRecipients);
        } catch (err) {
          console.error('Error fetching organization members:', err);
          // Fall back to configured recipients only
        }
      }

      if (recipients.length === 0) {
        console.warn('No email recipients found for alert, skipping email');
        // Mark as skipped in database so we know it was processed
        await supabase
          .from('notification_alerts')
          .update({
            email_sent: false,
            scheduled_for: null,
          })
          .eq('id', alert.id);
        return;
      }

      console.log(`Sending email notification to ${baseUrl}/api/internal/send-notification-email`);
      console.log(`Recipients: ${recipients.join(', ')}`);

      const response = await fetch(`${baseUrl}/api/internal/send-notification-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: recipients,
          alert,
          config,
        }),
      });

      if (response.ok) {
        console.log('Email sent successfully');
        await supabase
          .from('notification_alerts')
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          })
          .eq('id', alert.id);
      } else {
        const errorText = await response.text();
        console.error(`Failed to send email: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send email notification:', error);
    }
  }

  async getAlerts(filters?: {
    configId?: number;
    workflowId?: number;
    severity?: string;
    limit?: number;
  }): Promise<NotificationAlert[]> {
    let query = supabase
      .from('notification_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.configId) {
      query = query.eq('config_id', filters.configId);
    }
    if (filters?.workflowId) {
      query = query.eq('workflow_id', filters.workflowId);
    }
    if (filters?.severity) {
      query = query.eq('severity', filters.severity);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async acknowledgeAlert(alertId: number, userId: string): Promise<void> {
    const { error } = await supabase
      .from('notification_alerts')
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userId,
      })
      .eq('id', alertId);

    if (error) throw error;
  }

  // Fetch organization members using Clerk SDK directly
  private async getOrganizationMembers(orgId: string): Promise<string[]> {
    try {
      // Handle legacy ExampleClient org
      if (orgId === 'org_REDACTED') {
        return ['louis@mediar.ai', 'matt@mediar.ai'];
      }

      const clerk = await clerkClient();

      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100,
      });

      const emails = memberships?.data?.map(membership =>
        membership.publicUserData?.identifier
      ).filter(Boolean) as string[] || [];

      console.log(`Fetched ${emails.length} members from org ${orgId}: ${emails.join(', ')}`);
      return emails;
    } catch (error: any) {
      console.error(`Error fetching members for org ${orgId}:`, error);
      if (error?.status === 404) {
        console.warn(`Organization ${orgId} not found in Clerk`);
        return [];
      }
      // Return empty array on error to continue with other orgs
      return [];
    }
  }

  // Check conditions and trigger alerts if needed
  async checkExecutionForAlerts(execution: any, organizationId?: string): Promise<void> {
    // Get the workflow's organization_id
    const { data: workflow } = await supabase
      .from('deployed_workflows')
      .select('organization_id')
      .eq('id', execution.workflow_id)
      .single();

    const workflowOrgId = organizationId || workflow?.organization_id;

    const configs = await this.getConfigs();
    // Filter for enabled configs that match the workflow's organization OR are global (null organization_id)
    const enabledConfigs = configs.filter(c =>
      c.enabled &&
      (c.organization_id === workflowOrgId || c.organization_id === null)
    );

    for (const config of enabledConfigs) {
      let shouldAlert = false;
      let alertDetails: Partial<NotificationAlert> = {
        config_id: config.id,
        workflow_id: execution.workflow_id,
        execution_id: execution.id,
      };

      switch (config.condition_type) {
        case 'error':
          if (execution.status === 'error' || execution.status === 'failed') {
            shouldAlert = true;
            alertDetails = {
              ...alertDetails,
              alert_type: 'execution_error',
              severity: 'high',
              title: `Workflow Execution Failed: ${execution.workflow_name || execution.workflow_id || 'Unknown'}`,
              message: `Execution ${execution.id} failed with status: ${execution.status}`,
              error_message: execution.error_message || execution.error || execution.message,
              details: {
                // Execution details
                workflow_id: execution.workflow_id,
                workflow_name: execution.workflow_name,
                execution_id: execution.id,
                execution_status: execution.status,
                started_at: execution.started_at,
                ended_at: execution.ended_at,
                duration: execution.execution_time_seconds ? `${execution.execution_time_seconds}s` : undefined,

                // Error details
                error_message: execution.error_message,
                error: execution.error,
                failed_step: execution.failed_step || execution.last_step,
                stack_trace: execution.stack_trace,

                // Formatted output (for detailed message extraction)
                formatted_output: execution.formatted_output,

                // Request context (for debugging)
                request_info: {
                  ip: execution.request_ip || execution.ip_address,
                  user_agent: execution.user_agent,
                  trigger_source: execution.trigger_source || execution.triggered_by || 'manual',
                  session_id: execution.session_id,
                },

                // Workflow parameters
                parameters: execution.parameters || execution.inputs,

                // Additional debug info
                logs_available: execution.has_logs || false,
                retry_count: execution.retry_count || 0,
                parent_execution_id: execution.parent_execution_id,
              },
            };
          }
          break;

        case 'exception':
          // Parse formatted_output to check for exception flag (same logic as ExecutionsDataTable)
          let formattedResult = null;
          if (execution.formatted_output) {
            try {
              formattedResult = typeof execution.formatted_output === 'string'
                ? JSON.parse(execution.formatted_output)
                : execution.formatted_output;
            } catch (e) {
              formattedResult = null;
            }
          }

          // Check if exception flag is true
          if (formattedResult?.exception === true) {
            shouldAlert = true;
            alertDetails = {
              ...alertDetails,
              alert_type: 'execution_exception',
              severity: 'critical',
              title: `Workflow Exception: ${execution.workflow_name || execution.workflow_id || 'Unknown'}`,
              message: `Execution ${execution.id} completed with exception: ${formattedResult.message || 'Unknown'}`,
              error_message: formattedResult.message || execution.error_message,
              details: {
                // Execution details
                workflow_id: execution.workflow_id,
                workflow_name: execution.workflow_name,
                execution_id: execution.id,
                execution_status: execution.status,
                started_at: execution.started_at,
                ended_at: execution.ended_at,
                duration: execution.execution_time_seconds ? `${execution.execution_time_seconds}s` : undefined,

                // Exception-specific details from formatted_output
                exception_message: formattedResult.message,
                exception_data: formattedResult.data,
                validation_results: formattedResult.validation_results,

                // Formatted output (for detailed message extraction)
                formatted_output: execution.formatted_output,

                // Standard error context
                error_message: execution.error_message,
                error: execution.error,
                failed_step: execution.failed_step || execution.last_step,
                stack_trace: execution.stack_trace,

                // Request context (for debugging)
                request_info: {
                  ip: execution.request_ip || execution.ip_address,
                  user_agent: execution.user_agent,
                  trigger_source: execution.trigger_source || execution.triggered_by || 'manual',
                  session_id: execution.session_id,
                },

                // Workflow parameters
                parameters: execution.parameters || execution.inputs,

                // Additional debug info
                logs_available: execution.has_logs || false,
                retry_count: execution.retry_count || 0,
                parent_execution_id: execution.parent_execution_id,
              },
            };
          }
          break;

        case 'execution_time':
          const maxTime = config.condition_value?.max_seconds || 300;
          const executionTime = execution.execution_time_seconds;
          if (executionTime && executionTime > maxTime) {
            shouldAlert = true;
            alertDetails = {
              ...alertDetails,
              alert_type: 'slow_execution',
              severity: 'medium',
              title: `Slow Workflow Execution: ${execution.workflow_name || 'Unknown'}`,
              message: `Execution took ${executionTime}s, exceeding threshold of ${maxTime}s`,
              details: {
                execution_time: executionTime,
                threshold: maxTime,
              },
            };
          }
          break;

        case 'failure_rate':
          // This would need to calculate failure rate over a time window
          // Implementation depends on your specific requirements
          break;

        case 'cron_auto_pause':
          // Check if this workflow was just auto-paused
          const { data: workflowData } = await supabase
            .from('deployed_workflows')
            .select('cron_auto_paused, auto_paused_at, auto_pause_reason, consecutive_failures, last_failure_message')
            .eq('id', execution.workflow_id)
            .single();

          if (workflowData?.cron_auto_paused && workflowData.auto_paused_at) {
            // Check if auto-pause happened recently (within last minute)
            const autoPausedTime = new Date(workflowData.auto_paused_at).getTime();
            const now = new Date().getTime();
            const timeDiff = now - autoPausedTime;

            if (timeDiff < 60000) { // Within last minute
              shouldAlert = true;
              alertDetails = {
                ...alertDetails,
                alert_type: 'cron_auto_paused',
                severity: 'high',
                title: `Workflow Auto-Paused: ${execution.workflow_name || 'Unknown'}`,
                message: `Workflow automatically paused after ${workflowData.consecutive_failures} consecutive failures with same error`,
                error_message: workflowData.last_failure_message || 'Unknown error',
                details: {
                  workflow_id: execution.workflow_id,
                  workflow_name: execution.workflow_name,
                  consecutive_failures: workflowData.consecutive_failures,
                  failure_message: workflowData.last_failure_message,
                  auto_paused_at: workflowData.auto_paused_at,
                  auto_pause_reason: workflowData.auto_pause_reason,
                  resolution_steps: [
                    'Review the failure message and execution logs',
                    'Fix the underlying issue causing the failures',
                    'Manually re-enable the cron schedule from the workflow settings',
                    'Monitor the next few executions to ensure the issue is resolved'
                  ]
                },
              };
            }
          }
          break;
      }

      if (shouldAlert) {
        await this.createAlert(alertDetails as Omit<NotificationAlert, 'id'>);
      }
    }
  }
}