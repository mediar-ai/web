import { Octokit } from '@octokit/rest';
import yaml from 'js-yaml';
import { createClient } from '@supabase/supabase-js';
import { MEDIAR_ORG_IDS } from './constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface GitHubWorkflowResult {
  success: boolean;
  path?: string;
  sha?: string;
  error?: string;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  workflowId?: number;
}

export class GitHubWorkflowManager {
  private octokit: Octokit;
  private owner = 'mediar-ai';
  private repo = 'workflows';
  private baseBranch = 'main';
  private devBranch = 'dev';

  constructor() {
    const token = process.env.GITHUB_WORKFLOW_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      // Only log when actually running, not during static build
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        console.warn('GitHub token not configured for client-side operations');
      }
    }
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'mediar-workflow-manager'
    });
  }

  /**
   * Generate clean folder name from workflow name
   */
  private generateFolderName(workflowName: string): string {
    return workflowName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '')  // Remove non-alphanumeric (keep underscores and hyphens)
      .substring(0, 50);
  }

  /**
   * Save workflow with human-readable folder name mapped to ID
   */
  async saveWorkflow(
    workflowName: string,
    yamlContent: string,
    isDevelopment: boolean = false,
    message?: string,
    createPR: boolean = true,
    workflowId?: number,
    organizationId?: string
  ): Promise<GitHubWorkflowResult> {
    try {
      // Validate YAML
      yaml.load(yamlContent);

      if (!workflowId) {
        throw new Error('workflowId is required');
      }

      // Check if workflow already has a github_folder - if so, preserve it!
      const { data: existingWorkflow } = await supabase
        .from('deployed_workflows')
        .select('github_folder, organization_id')
        .eq('id', workflowId)
        .single();

      let folderName: string;
      if (existingWorkflow?.github_folder) {
        // PRESERVE existing folder name - don't regenerate
        folderName = existingWorkflow.github_folder;
        console.log(`📁 Using existing GitHub folder: ${folderName} (preserving for workflow ${workflowId})`);
      } else {
        // Generate new folder name for workflows without one
        folderName = this.generateFolderName(workflowName);
        console.log(`📁 Creating new GitHub folder: ${folderName} (for workflow ${workflowId})`);
      }

      // Determine org prefix for new workflows
      const effectiveOrgId = organizationId || existingWorkflow?.organization_id;
      const isMediarOrg = effectiveOrgId && MEDIAR_ORG_IDS.includes(effectiveOrgId);
      const orgPrefix = (effectiveOrgId && !isMediarOrg) ? `org-${effectiveOrgId}/` : '';
      const filePath = `${orgPrefix}${folderName}/workflow.yaml`;

      console.log(`📁 File path: ${filePath} (org: ${effectiveOrgId || 'Mediar'})`);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const branchName = `workflow/${folderName}-${timestamp}`;
      const targetBranch = isDevelopment ? this.devBranch : this.baseBranch;

      if (createPR) {
        // Create a new branch from target
        const { data: ref } = await this.octokit.git.getRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${targetBranch}`
        });

        await this.octokit.git.createRef({
          owner: this.owner,
          repo: this.repo,
          ref: `refs/heads/${branchName}`,
          sha: ref.object.sha
        });

        console.log(`Created branch: ${branchName}`);
      }

      // Check if file exists
      let existingSha: string | undefined;
      try {
        const { data: existingFile } = await this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: filePath,
          ref: createPR ? branchName : targetBranch
        });

        if ('sha' in existingFile) {
          existingSha = existingFile.sha;
        }
      } catch (error: any) {
        // File doesn't exist - that's OK
      }

      // Add metadata comment to YAML
      const metadataComment = `# Workflow: ${workflowName}
# ID: ${workflowId}
# Generated: ${new Date().toISOString()}
# Branch: ${targetBranch}
# ---
`;
      const fullContent = metadataComment + yamlContent;

      // Create or update file
      const { data } = await this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        message: message || `Add/Update workflow: ${workflowName}`,
        content: Buffer.from(fullContent).toString('base64'),
        branch: createPR ? branchName : targetBranch,
        ...(existingSha && { sha: existingSha })
      });

      // Update Supabase with folder mapping (folder -> ID)
      await supabase
        .from('deployed_workflows')
        .update({
          github_folder: folderName,
          github_path: filePath,
          github_sha: data.commit.sha,
          github_ref: createPR ? branchName : targetBranch,
          github_sync_status: 'synced',
          github_last_synced_at: new Date().toISOString()
        })
        .eq('id', workflowId);

      // Create PR if requested
      if (createPR) {
        const prBody = `## Workflow: ${workflowName}

### Details
- **Target Branch**: ${targetBranch}
- **Path**: \`${filePath}\`
- **Created**: ${new Date().toISOString()}

### Description
${message || 'Workflow created via Mediar UI'}

---
*Automated PR from Mediar workflow system*`;

        const { data: pr } = await this.octokit.pulls.create({
          owner: this.owner,
          repo: this.repo,
          title: `Add workflow: ${workflowName}`,
          head: branchName,
          base: targetBranch,
          body: prBody
        });

        console.log(`Created PR #${pr.number}: ${pr.html_url}`);

        return {
          success: true,
          path: filePath,
          sha: data.commit.sha,
          prUrl: pr.html_url,
          prNumber: pr.number,
          branch: branchName,
          workflowId
        };
      }

      return {
        success: true,
        path: filePath,
        sha: data.commit.sha,
        workflowId
      };

    } catch (error) {
      console.error('Error saving workflow to GitHub:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save workflow'
      };
    }
  }

  /**
   * Handle Git pushes - map folder to workflow
   */
  async syncFromGitPush(folderName: string, branch: string): Promise<{
    workflowId: number;
    isNew: boolean;
  } | null> {
    // Check if folder already mapped
    const { data: existing } = await supabase
      .from('deployed_workflows')
      .select('id')
      .eq('github_folder', folderName)
      .single();

    if (existing) {
      return { workflowId: existing.id, isNew: false };
    }

    // New workflow pushed via Git - create in Supabase
    const workflowPath = `${folderName}/workflow.yaml`;
    const content = await this.getWorkflow(workflowPath, branch);

    if (!content) return null;

    // Extract name from YAML
    let workflowName = folderName;
    try {
      const parsed = yaml.load(content.yaml) as any;
      if (parsed.name) workflowName = parsed.name;
    } catch (e) {
      // Use folder name as fallback
    }

    // Create new workflow entry
    const { data: newWorkflow, error } = await supabase
      .from('deployed_workflows')
      .insert({
        name: workflowName,
        github_folder: folderName,
        github_path: workflowPath,
        github_sha: content.metadata.sha,
        github_ref: branch,
        github_sync_status: 'synced',
        automation_sequence: yaml.load(content.yaml),
        status: branch === 'main' ? 'deployed' : 'draft',
        version: '1.0.0'
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create workflow from Git push:', error);
      return null;
    }

    return { workflowId: newWorkflow.id, isNew: true };
  }

  async getWorkflow(path: string, ref?: string): Promise<any> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: ref || this.baseBranch
      });

      if ('content' in data && data.type === 'file') {
        return {
          yaml: Buffer.from(data.content, 'base64').toString('utf-8'),
          metadata: {
            path: data.path,
            sha: data.sha,
            lastModified: new Date().toISOString()
          }
        };
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch workflow from GitHub (${this.owner}/${this.repo}/${path}@${ref || this.baseBranch}):`, error);
      return null;
    }
  }
}

// Lazy-load the manager to avoid instantiation during build
let _githubWorkflowManager: GitHubWorkflowManager | null = null;

export const getGitHubWorkflowManager = (): GitHubWorkflowManager => {
  if (!_githubWorkflowManager) {
    _githubWorkflowManager = new GitHubWorkflowManager();
  }
  return _githubWorkflowManager;
};

// For backward compatibility, export a getter that returns the manager
export const githubWorkflowManager = new Proxy({} as GitHubWorkflowManager, {
  get(target, prop, receiver) {
    return Reflect.get(getGitHubWorkflowManager(), prop, receiver);
  },
  set(target, prop, value, receiver) {
    return Reflect.set(getGitHubWorkflowManager(), prop, value, receiver);
  }
});