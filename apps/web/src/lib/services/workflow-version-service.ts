/**
 * Shared service for creating workflow versions with GitHub sync
 * Used by both API routes and server-side tools to avoid duplication
 */

import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';

export interface CreateVersionParams {
  workflowId: number;
  yamlContent?: string | null;
  jsonContent?: any | null;
  changeNotes?: string;
  setAsActive?: boolean;
  userId: string;
  orgId?: string | null;
  userEmail?: string | null;
  cronConfig?: {
    expression: string;
    timezone?: string;
    enabled?: boolean;
    maxConcurrent?: number;
    retryOnFailure?: boolean;
    retryCount?: number;
  };
}

export interface WorkflowVersionResult {
  success: boolean;
  version?: {
    id: number;
    version_number: string;
    workflow_id: number;
    is_active: boolean;
    change_notes: string;
    created_at: string;
  };
  workflow?: {
    id: number;
    name: string;
    total_versions: number;
    current_version: string;
  };
  github_sync?: {
    success: boolean;
    path?: string;
    sha?: string;
    error?: string;
  };
  error?: string;
}

/**
 * Service class for managing workflow versions
 */
export class WorkflowVersionService {
  private supabase;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!url || !key) {
      throw new Error('Missing Supabase environment variables');
    }

    this.supabase = createClient(url, key);
  }

  /**
   * Create a new workflow version with optional GitHub sync
   * This is the single source of truth for version creation
   */
  async createVersion(params: CreateVersionParams): Promise<WorkflowVersionResult> {
    const {
      workflowId,
      yamlContent,
      jsonContent,
      changeNotes,
      setAsActive = false,
      userId,
      orgId,
      userEmail,
      cronConfig
    } = params;

    try {
      // 1. Fetch workflow metadata
      const { data: workflow, error: workflowError } = await this.supabase
        .from('deployed_workflows')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (workflowError || !workflow) {
        return {
          success: false,
          error: `Workflow ${workflowId} not found`
        };
      }

      // 2. Determine content format and prepare data
      let sequenceFormat: 'yaml' | 'jsonb';
      let jsonbContent: any = null;

      if (yamlContent) {
        sequenceFormat = 'yaml';
        // Parse YAML to get JSON representation for queries
        try {
          jsonbContent = yaml.load(yamlContent);
        } catch (e) {
          console.warn('Could not parse YAML for JSONB storage:', e);
        }
      } else if (jsonContent) {
        sequenceFormat = 'jsonb';
        jsonbContent = jsonContent;
      } else {
        return {
          success: false,
          error: 'No content provided (yaml_content or json_content required)'
        };
      }

      // 3. Get next version number
      const newVersionNumber = await this.getNextVersionNumber(workflowId);

      // 4. Check if version already exists
      const { data: existingVersion } = await this.supabase
        .from('deployed_workflow_versions')
        .select('id')
        .eq('workflow_id', workflowId)
        .eq('version_number', newVersionNumber)
        .single();

      if (existingVersion) {
        return {
          success: false,
          error: `Version ${newVersionNumber} already exists`
        };
      }

      // 5. Create new version
      const versionData = {
        workflow_id: workflowId,
        version_number: newVersionNumber,
        automation_sequence_yaml: yamlContent,
        automation_sequence: jsonbContent,
        preferred_format: sequenceFormat,
        is_active: false, // Don't activate immediately
        change_notes: changeNotes || `Version ${newVersionNumber} created via API (${sequenceFormat} format)`
      };

      const { data: newVersion, error: versionError } = await this.supabase
        .from('deployed_workflow_versions')
        .insert(versionData)
        .select()
        .single();

      if (versionError) {
        throw new Error(`Failed to create version: ${versionError.message}`);
      }

      // 6. Update parent workflow metadata
      const workflowUpdateData: any = {
        total_versions: workflow.total_versions + 1,
        updated_at: new Date().toISOString()
      };

      if (cronConfig) {
        workflowUpdateData.cron_expression = cronConfig.expression;
        workflowUpdateData.cron_timezone = cronConfig.timezone || 'UTC';
        workflowUpdateData.cron_enabled = cronConfig.enabled !== false;
        workflowUpdateData.cron_max_concurrent = cronConfig.maxConcurrent || 1;
        workflowUpdateData.cron_retry_on_failure = cronConfig.retryOnFailure !== false;
        workflowUpdateData.cron_retry_count = cronConfig.retryCount || 3;
        console.log(`📅 Updating workflow cron settings: ${cronConfig.expression}`);
      }

      const { error: updateError } = await this.supabase
        .from('deployed_workflows')
        .update(workflowUpdateData)
        .eq('id', workflowId);

      if (updateError) {
        throw new Error(`Failed to update workflow metadata: ${updateError.message}`);
      }

      // 7. Activate new version if requested
      if (setAsActive) {
        const { error: activateError } = await this.supabase
          .rpc('activate_workflow_version', {
            p_workflow_id: workflowId,
            p_version_number: newVersionNumber
          });

        if (activateError) {
          throw new Error(`Failed to activate version: ${activateError.message}`);
        }
      }

      // 8. Push to GitHub if YAML format
      let githubSyncResult: {
        success: boolean;
        path?: string;
        sha?: string;
        error?: string;
      } | undefined = undefined;

      if (yamlContent) {
        githubSyncResult = await this.syncToGitHub({
          workflowId,
          workflowName: workflow.name,
          yamlContent,
          versionNumber: newVersionNumber,
          userId,
          orgId,
          userEmail
        });
      }

      // 9. Return success response
      return {
        success: true,
        version: {
          id: newVersion.id,
          version_number: newVersionNumber,
          workflow_id: workflowId,
          is_active: setAsActive,
          change_notes: newVersion.change_notes,
          created_at: newVersion.created_at
        },
        workflow: {
          id: workflowId,
          name: workflow.name,
          total_versions: workflow.total_versions + 1,
          current_version: setAsActive ? newVersionNumber : workflow.version
        },
        github_sync: githubSyncResult
      };

    } catch (error) {
      console.error('[WorkflowVersionService] Error creating version:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the latest version content for a workflow
   */
  async getLatestVersion(workflowId: number): Promise<{
    yamlContent: string | null;
    jsonContent: any | null;
    versionNumber: string;
    preferredFormat: 'yaml' | 'jsonb' | 'typescript' | null;
  }> {
    const { data: currentVersion, error } = await this.supabase
      .from('deployed_workflow_versions')
      .select('automation_sequence_yaml, automation_sequence, version_number, preferred_format')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !currentVersion) {
      throw new Error(`Workflow ${workflowId} not found or no versions`);
    }

    return {
      yamlContent: currentVersion.automation_sequence_yaml,
      jsonContent: currentVersion.automation_sequence,
      versionNumber: currentVersion.version_number,
      preferredFormat: currentVersion.preferred_format,
    };
  }

  /**
   * Private: Get next version number for a workflow
   */
  private async getNextVersionNumber(workflowId: number): Promise<string> {
    // Get the latest version
    const { data: latestVersion } = await this.supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let newVersionNumber: string;

    if (latestVersion?.version_number) {
      // Increment from existing version
      const { data: incremented, error: incrementError } = await this.supabase
        .rpc('increment_version', { version_text: latestVersion.version_number });

      if (incrementError || !incremented) {
        throw new Error(`Failed to increment version: ${incrementError?.message}`);
      }
      newVersionNumber = incremented;
    } else {
      // First version
      newVersionNumber = '1.0.0';
    }

    console.log(`[VERSION] Generated ${newVersionNumber}`);
    return newVersionNumber;
  }

  /**
   * Private: Sync workflow to GitHub
   */
  private async syncToGitHub(params: {
    workflowId: number;
    workflowName: string;
    yamlContent: string;
    versionNumber: string;
    userId: string;
    orgId?: string | null;
    userEmail?: string | null;
  }): Promise<{
    success: boolean;
    path?: string;
    sha?: string;
    error?: string;
  }> {
    try {
      const { githubWorkflowManager } = await import('@/lib/github-workflow-manager');

      console.log(`📤 Pushing version ${params.versionNumber} to GitHub...`);

      const githubSyncResult = await githubWorkflowManager.saveWorkflow(
        params.workflowName,
        params.yamlContent,
        false, // Not development
        `Update workflow: ${params.workflowName} (v${params.versionNumber})`,
        false, // Don't create PR - push directly
        params.workflowId,
        params.orgId || undefined,
        { email: params.userEmail || undefined }
      );

      if (githubSyncResult.success) {
        console.log(`✅ Pushed to GitHub: ${githubSyncResult.path}`);

        // Log sync operation
        await this.supabase
          .from('github_workflow_sync_log')
          .insert({
            workflow_id: params.workflowId,
            operation: 'push',
            github_path: githubSyncResult.path,
            github_sha: githubSyncResult.sha,
            status: 'success'
          });

        return {
          success: true,
          path: githubSyncResult.path,
          sha: githubSyncResult.sha
        };
      } else {
        console.warn(`⚠️ GitHub push failed: ${githubSyncResult.error}`);
        return {
          success: false,
          error: githubSyncResult.error
        };
      }
    } catch (githubError) {
      console.error('GitHub sync error:', githubError);
      // Don't fail version creation if GitHub sync fails
      return {
        success: false,
        error: githubError instanceof Error ? githubError.message : 'GitHub sync failed'
      };
    }
  }
}

// Export singleton instance
export const workflowVersionService = new WorkflowVersionService();