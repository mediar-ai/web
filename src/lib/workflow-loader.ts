/**
 * Unified workflow loader that fetches from GitHub with Supabase fallback
 */

import { createClient } from '@supabase/supabase-js';
import { githubWorkflowManager } from './github-workflow-manager';
import yaml from 'js-yaml';

export interface LoadedWorkflow {
  id: number;
  name: string;
  automation_sequence: any;
  metadata: {
    source: 'github' | 'supabase';
    github_path?: string;
    github_sha?: string;
    last_synced?: string;
  };
}

export class WorkflowLoader {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
    );
  }

  /**
   * Load workflow with GitHub priority, fallback to Supabase
   */
  async loadWorkflow(workflowId: number): Promise<LoadedWorkflow | null> {
    try {
      // First, fetch workflow metadata from Supabase
      const { data: workflow, error } = await this.supabase
        .from('deployed_workflows')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (error || !workflow) {
        console.error(`Workflow ${workflowId} not found in database`);
        return null;
      }

      // Try to load from GitHub if path exists
      if (workflow.github_path) {
        console.log(`Loading workflow ${workflowId} from GitHub: ${workflow.github_path}`);

        const githubContent = await githubWorkflowManager.getWorkflow(
          workflow.github_path,
          workflow.github_ref
        );

        if (githubContent) {
          try {
            // Parse YAML to JSON
            const automationSequence = yaml.load(githubContent.yaml);

            return {
              id: workflow.id,
              name: workflow.name,
              automation_sequence: automationSequence,
              metadata: {
                source: 'github',
                github_path: workflow.github_path,
                github_sha: githubContent.metadata.sha,
                last_synced: workflow.github_last_synced_at
              }
            };
          } catch (parseError) {
            console.error('Error parsing YAML from GitHub:', parseError);
            // Fall through to Supabase fallback
          }
        }
      }

      // Fallback to Supabase
      console.log(`Loading workflow ${workflowId} from Supabase (fallback)`);

      // For workflows stored directly with automation_sequence
      if (workflow.automation_sequence) {
        return {
          id: workflow.id,
          name: workflow.name,
          automation_sequence: workflow.automation_sequence,
          metadata: {
            source: 'supabase'
          }
        };
      }

      // Try loading from view with sequence
      const { data: workflowWithSeq } = await this.supabase
        .from('deployed_workflows_with_sequence')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (workflowWithSeq && workflowWithSeq.automation_sequence) {
        return {
          id: workflowWithSeq.id,
          name: workflowWithSeq.name,
          automation_sequence: workflowWithSeq.automation_sequence,
          metadata: {
            source: 'supabase'
          }
        };
      }

      console.error(`No automation_sequence found for workflow ${workflowId}`);
      return null;

    } catch (error) {
      console.error('Error loading workflow:', error);
      return null;
    }
  }

  /**
   * Load workflow with associated files
   */
  async loadWorkflowWithFiles(workflowId: number): Promise<{
    workflow: LoadedWorkflow | null;
    files: Record<string, string>;
  }> {
    const workflow = await this.loadWorkflow(workflowId);

    if (!workflow) {
      return { workflow: null, files: {} };
    }

    let files: Record<string, string> = {};

    // If loaded from GitHub, also fetch associated files
    if (workflow.metadata.source === 'github' && workflow.metadata.github_path) {
      const result = await githubWorkflowManager.getWorkflowWithFiles(
        workflow.metadata.github_path
      );
      files = result.files;
    } else {
      // Try to load files from Supabase storage if they exist
      try {
        const { data: fileRecords } = await this.supabase
          .from('workflow_files')
          .select('file_path, storage_path')
          .eq('workflow_id', workflowId);

        if (fileRecords && fileRecords.length > 0) {
          // Would need to fetch from storage, but keeping simple for now
          console.log(`Found ${fileRecords.length} files in Supabase storage`);
        }
      } catch (error) {
        console.error('Error loading workflow files:', error);
      }
    }

    return { workflow, files };
  }

  /**
   * Check if workflow needs sync from GitHub
   */
  async checkSyncStatus(workflowId: number): Promise<{
    needsSync: boolean;
    localSha?: string;
    remoteSha?: string;
  }> {
    try {
      const { data: workflow } = await this.supabase
        .from('deployed_workflows')
        .select('github_path, github_sha, github_ref')
        .eq('id', workflowId)
        .single();

      if (!workflow || !workflow.github_path) {
        return { needsSync: false };
      }

      const githubContent = await githubWorkflowManager.getWorkflow(
        workflow.github_path,
        workflow.github_ref
      );

      if (!githubContent) {
        return { needsSync: false };
      }

      return {
        needsSync: workflow.github_sha !== githubContent.metadata.sha,
        localSha: workflow.github_sha,
        remoteSha: githubContent.metadata.sha
      };
    } catch (error) {
      console.error('Error checking sync status:', error);
      return { needsSync: false };
    }
  }

  /**
   * Sync workflow from GitHub to Supabase metadata
   */
  async syncFromGitHub(workflowId: number): Promise<boolean> {
    try {
      const workflow = await this.loadWorkflow(workflowId);

      if (!workflow || workflow.metadata.source !== 'github') {
        return false;
      }

      // Update sync status in database
      const { error } = await this.supabase
        .from('deployed_workflows')
        .update({
          github_sha: workflow.metadata.github_sha,
          github_sync_status: 'synced',
          github_last_synced_at: new Date().toISOString()
        })
        .eq('id', workflowId);

      if (error) {
        console.error('Error updating sync status:', error);
        return false;
      }

      // Log sync operation
      await this.supabase
        .from('github_workflow_sync_log')
        .insert({
          workflow_id: workflowId,
          operation: 'pull',
          github_path: workflow.metadata.github_path,
          github_sha: workflow.metadata.github_sha,
          status: 'success'
        });

      return true;
    } catch (error) {
      console.error('Error syncing from GitHub:', error);

      // Log failed sync
      await this.supabase
        .from('github_workflow_sync_log')
        .insert({
          workflow_id: workflowId,
          operation: 'pull',
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });

      return false;
    }
  }
}

// Export singleton instance
export const workflowLoader = new WorkflowLoader();