import { supabase } from '@/lib/supabase';

export interface NotificationConfig {
  id: number;
  name: string;
  enabled: boolean;
  email_enabled: boolean;
  email_recipients: string[];
  condition_type: 'error' | 'failure_rate' | 'execution_time' | 'custom';
  condition_value: any;
  cooldown_minutes: number;
  max_alerts_per_hour: number;
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
      const shouldSend = await this.checkRateLimits(alert.config_id, config);
      if (shouldSend) {
        await this.sendEmailNotification(data, config);
      }
    }

    return data;
  }

  private async checkRateLimits(configId: number, config: NotificationConfig): Promise<boolean> {

    // Check cooldown period
    const cooldownTime = new Date();
    cooldownTime.setMinutes(cooldownTime.getMinutes() - config.cooldown_minutes);

    const { data: recentAlerts } = await supabase
      .from('notification_alerts')
      .select('created_at')
      .eq('config_id', configId)
      .eq('email_sent', true)
      .gte('created_at', cooldownTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentAlerts && recentAlerts.length > 0) {
      console.log(`Cooldown active for config ${configId}, skipping notification`);
      return false;
    }

    // Check hourly rate limit
    const hourAgo = new Date();
    hourAgo.setHours(hourAgo.getHours() - 1);

    const { count } = await supabase
      .from('notification_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('config_id', configId)
      .eq('email_sent', true)
      .gte('created_at', hourAgo.toISOString());

    if (count && count >= config.max_alerts_per_hour) {
      console.log(`Rate limit reached for config ${configId}, skipping notification`);
      return false;
    }

    return true;
  }

  private async sendEmailNotification(alert: NotificationAlert, config: NotificationConfig): Promise<void> {
    try {
      // Use absolute URL for server-side fetch
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://app.mediar.ai';

      const response = await fetch(`${baseUrl}/api/internal/send-notification-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: config.email_recipients,
          subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          alert,
          config,
        }),
      });

      if (response.ok) {
            await supabase
          .from('notification_alerts')
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          })
          .eq('id', alert.id);
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

  // Check conditions and trigger alerts if needed
  async checkExecutionForAlerts(execution: any): Promise<void> {
    const configs = await this.getConfigs();
    const enabledConfigs = configs.filter(c => c.enabled);

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
      }

      if (shouldAlert) {
        await this.createAlert(alertDetails as Omit<NotificationAlert, 'id'>);
      }
    }
  }
}