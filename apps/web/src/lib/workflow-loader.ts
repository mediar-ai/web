/**
 * Unified workflow loader that fetches from Supabase (source of truth)
 * GitHub sync happens separately via API routes to keep versions in sync
 */

import yaml from 'js-yaml';
import { githubWorkflowManager } from './github-workflow-manager';
import { getSupabaseAdmin } from './supabase-server';

export interface LoadedWorkflow {
  id: number;
  name: string;
  automation_sequence: any;
  preferred_format?: string;
  typescript_metadata?: any;
  metadata: {
    source:
      | 'supabase_latest_version'
      | 'supabase_active_fallback'
      | 'supabase_view_fallback';
    github_path?: string;
    github_sha?: string;
    last_synced?: string;
    version?: string;
    is_active?: boolean;
  };
}

export class WorkflowLoader {
  private supabase;

  constructor() {
    this.supabase = getSupabaseAdmin();
  }

  /**
   * Load workflow from Supabase (latest version)
   * GitHub sync happens separately, so we always use Supabase as source of truth
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

      // Always load from Supabase - it's the source of truth
      // GitHub sync ensures Supabase has the latest version
      console.log(
        `Loading workflow ${workflowId} from Supabase - fetching latest version`
      );

      // Fetch LATEST version from deployed_workflow_versions table
      const { data: latestVersion, error: versionError } = await this.supabase
        .from('deployed_workflow_versions')
        .select(
          'version_number, automation_sequence, automation_sequence_yaml, is_active, created_at'
        )
        .eq('workflow_id', workflowId)
        .order('created_at', { ascending: false }) // Latest first
        .limit(1)
        .single();

      if (!versionError && latestVersion) {
        const versionStatus = latestVersion.is_active
          ? 'active'
          : 'inactive (latest)';
        console.log(
          `Loading workflow ${workflowId} v${latestVersion.version_number} (${versionStatus})`
        );

        // Prefer YAML format, fallback to JSON
        let automationSequence;
        if (latestVersion.automation_sequence_yaml) {
          try {
            automationSequence = yaml.load(
              latestVersion.automation_sequence_yaml
            );
            console.log(`Loaded workflow ${workflowId} from YAML format`);
          } catch (parseError) {
            console.error(
              'Error parsing YAML, falling back to JSON:',
              parseError
            );
            automationSequence = latestVersion.automation_sequence;
          }
        } else if (latestVersion.automation_sequence) {
          automationSequence = latestVersion.automation_sequence;
          console.log(`Loaded workflow ${workflowId} from JSON format`);
        } else {
          console.error(
            `Version ${latestVersion.version_number} has no content`
          );
          // Fall through to fallback below
        }

        if (automationSequence) {
          return {
            id: workflow.id,
            name: workflow.name,
            automation_sequence: automationSequence,
            preferred_format: workflow.preferred_format,
            typescript_metadata: workflow.typescript_metadata,
            metadata: {
              source: 'supabase_latest_version',
              version: latestVersion.version_number,
              is_active: latestVersion.is_active,
            },
          };
        }
      }

      // Fallback to deployed_workflows table (active version) if no versions found
      console.log(
        `No versions found for workflow ${workflowId}, using active version from deployed_workflows table`
      );

      if (workflow.automation_sequence) {
        return {
          id: workflow.id,
          name: workflow.name,
          automation_sequence: workflow.automation_sequence,
          preferred_format: workflow.preferred_format,
          typescript_metadata: workflow.typescript_metadata,
          metadata: {
            source: 'supabase_active_fallback',
          },
        };
      }

      // Final fallback: Try loading from view with sequence
      const { data: workflowWithSeq } = await this.supabase
        .from('deployed_workflows_with_sequence')
        .select('*')
        .eq('id', workflowId)
        .single();

      if (workflowWithSeq && workflowWithSeq.automation_sequence) {
        console.log(
          `Loaded workflow ${workflowId} from deployed_workflows_with_sequence view`
        );
        return {
          id: workflowWithSeq.id,
          name: workflowWithSeq.name,
          automation_sequence: workflowWithSeq.automation_sequence,
          preferred_format: workflow.preferred_format,
          typescript_metadata: workflow.typescript_metadata,
          metadata: {
            source: 'supabase_view_fallback',
          },
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

    const files: Record<string, string> = {};

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
        remoteSha: githubContent.metadata.sha,
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
      // Get workflow metadata to check if it has a GitHub path
      const { data: workflowMeta } = await this.supabase
        .from('deployed_workflows')
        .select('github_path, github_ref')
        .eq('id', workflowId)
        .single();

      if (!workflowMeta || !workflowMeta.github_path) {
        console.log(`Workflow ${workflowId} has no GitHub path`);
        return false;
      }

      // Fetch from GitHub
      const githubContent = await githubWorkflowManager.getWorkflow(
        workflowMeta.github_path,
        workflowMeta.github_ref
      );

      if (!githubContent) {
        console.error(`Failed to fetch workflow ${workflowId} from GitHub`);
        return false;
      }

      // Update sync status in database
      const { error } = await this.supabase
        .from('deployed_workflows')
        .update({
          github_sha: githubContent.metadata.sha,
          github_sync_status: 'synced',
          github_last_synced_at: new Date().toISOString(),
        })
        .eq('id', workflowId);

      if (error) {
        console.error('Error updating sync status:', error);
        return false;
      }

      // Log sync operation
      await this.supabase.from('github_workflow_sync_log').insert({
        workflow_id: workflowId,
        operation: 'pull',
        github_path: workflowMeta.github_path,
        github_sha: githubContent.metadata.sha,
        status: 'success',
      });

      return true;
    } catch (error) {
      console.error('Error syncing from GitHub:', error);

      // Log failed sync
      await this.supabase.from('github_workflow_sync_log').insert({
        workflow_id: workflowId,
        operation: 'pull',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });

      return false;
    }
  }
}

// Lazy-loaded singleton instance
let _workflowLoader: WorkflowLoader | null = null;

export function getWorkflowLoader(): WorkflowLoader {
  if (!_workflowLoader) {
    _workflowLoader = new WorkflowLoader();
  }
  return _workflowLoader;
}

// For backward compatibility, use a Proxy to defer instantiation
export const workflowLoader = new Proxy({} as WorkflowLoader, {
  get(_target, prop, receiver) {
    return Reflect.get(getWorkflowLoader(), prop, receiver);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getWorkflowLoader(), prop, value, receiver);
  }
});
