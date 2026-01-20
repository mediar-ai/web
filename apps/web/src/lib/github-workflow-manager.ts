import { Octokit } from '@octokit/rest';
import yaml from 'js-yaml';
import { createClerkClient } from '@clerk/backend';
import { getAuthenticatedOctokit } from './github-app-auth';
import { getSupabaseAdmin } from './supabase-server';

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

export interface UserContext {
  name?: string;
  organizationName?: string;
  email?: string;
}

export class GitHubWorkflowManager {
  private octokit: Octokit | null = null;
  private owner = 'mediar-ai';
  private repo = 'workflows';
  private baseBranch = 'main';
  private devBranch = 'dev';

  constructor() {
    // Octokit will be lazily initialized via ensureOctokit()
    // This allows for async GitHub App authentication
  }

  /**
   * Ensure Octokit is initialized (supports async GitHub App auth)
   */
  private async ensureOctokit(): Promise<Octokit> {
    if (!this.octokit) {
      this.octokit = await getAuthenticatedOctokit();
    }
    return this.octokit;
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
   * Update package.json for a workflow (name/description sync from UI)
   * This is used when users edit workflow metadata in the dashboard
   */
  async updatePackageJson(
    workflowId: number,
    updates: { name?: string; description?: string },
    userContext?: UserContext
  ): Promise<GitHubWorkflowResult> {
    const supabase = getSupabaseAdmin();
    try {
      // Get workflow's github_path from Supabase
      const { data: workflow, error: fetchError } = await supabase
        .from('deployed_workflows')
        .select('github_path, github_folder, name')
        .eq('id', workflowId)
        .single();

      if (fetchError || !workflow?.github_folder) {
        return {
          success: false,
          error: `Workflow ${workflowId} not found or has no github_folder (legacy workflow)`
        };
      }

      // Use github_folder for package.json path (not github_path which points to src/terminator.ts)
      const packageJsonPath = `${workflow.github_folder}/package.json`;

      // Fetch existing package.json from GitHub
      const octokit = await this.ensureOctokit();
      let existingContent: any = {};
      let existingSha: string | undefined;

      try {
        const { data: existingFile } = await octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: packageJsonPath,
          ref: this.baseBranch
        });

        if ('content' in existingFile && existingFile.type === 'file') {
          existingContent = JSON.parse(
            Buffer.from(existingFile.content, 'base64').toString('utf-8')
          );
          existingSha = existingFile.sha;
        }
      } catch (error: any) {
        if (error.status === 404) {
          return {
            success: false,
            error: `No package.json found for workflow ${workflowId} (legacy workflow without TypeScript)`
          };
        }
        throw error;
      }

      // Update fields
      if (updates.name !== undefined) {
        existingContent.name = updates.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 214);
      }
      if (updates.description !== undefined) {
        existingContent.description = updates.description;
      }

      // Build commit message
      let commitMessage = `Update workflow metadata: ${workflow.name || workflowId}`;
      if (userContext?.email) {
        commitMessage = `${commitMessage}\n\nBy: ${userContext.email}`;
      }

      // Commit updated package.json directly to main
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: packageJsonPath,
        message: commitMessage,
        content: Buffer.from(JSON.stringify(existingContent, null, 2) + '\n').toString('base64'),
        branch: this.baseBranch,
        ...(existingSha && { sha: existingSha })
      });

      console.log(`Updated package.json for workflow ${workflowId}: ${packageJsonPath}`);

      return {
        success: true,
        path: packageJsonPath,
        sha: data.commit.sha,
        workflowId
      };
    } catch (error) {
      console.error('Error updating package.json:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update package.json'
      };
    }
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
    organizationId?: string,
    userContext?: UserContext
  ): Promise<GitHubWorkflowResult> {
    const supabase = getSupabaseAdmin();
    try {
      // Validate YAML
      yaml.load(yamlContent);

      if (!workflowId) {
        throw new Error('workflowId is required');
      }

      // Get authenticated Octokit instance (supports GitHub App auth)
      const octokit = await this.ensureOctokit();

      // Check if workflow already has a github_path - preserve exact existing structure!
      const { data: existingWorkflow } = await supabase
        .from('deployed_workflows')
        .select('github_folder, github_path, organization_id')
        .eq('id', workflowId)
        .single();

      let filePath: string;
      let folderName: string;

      // BACKWARD COMPATIBILITY: If workflow already has github_path, use it exactly
      if (existingWorkflow?.github_path) {
        filePath = existingWorkflow.github_path;
        folderName = existingWorkflow.github_folder || this.generateFolderName(workflowName);
        console.log(`📁 PRESERVING existing path: ${filePath} (workflow ${workflowId})`);
      } else {
        // New workflow or legacy without github_path
        if (existingWorkflow?.github_folder) {
          // PRESERVE existing folder name - don't regenerate
          folderName = existingWorkflow.github_folder;
          console.log(`📁 Using existing GitHub folder: ${folderName} (preserving for workflow ${workflowId})`);
        } else {
          // Generate new folder name for workflows without one
          // Pattern: {id}_{sanitized-name} - ID first for sorting and clarity
          folderName = `${workflowId}_${this.generateFolderName(workflowName)}`;
          console.log(`📁 Creating new GitHub folder: ${folderName} (for workflow ${workflowId})`);
        }

        // Determine org prefix - ONLY for new workflows
        const effectiveOrgId = organizationId || existingWorkflow?.organization_id;
        // ALL orgs (including Mediar) should have org prefix: org-{orgid}/workflowname
        const orgPrefix = effectiveOrgId ? `org-${effectiveOrgId}/` : '';
        filePath = `${orgPrefix}${folderName}/workflow.yaml`;

        console.log(`📁 New workflow path: ${filePath} (org: ${effectiveOrgId || 'no-org'})`);
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const branchName = `workflow/${folderName}-${timestamp}`;
      const targetBranch = isDevelopment ? this.devBranch : this.baseBranch;

      if (createPR) {
        // Create a new branch from target
        const { data: ref } = await octokit.git.getRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${targetBranch}`
        });

        await octokit.git.createRef({
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
        const { data: existingFile } = await octokit.repos.getContent({
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
# Folder: ${folderName}
# Generated: ${new Date().toISOString()}
# Branch: ${targetBranch}
# ---
`;
      const fullContent = metadataComment + yamlContent;

      // Build commit message with user context (email only - no Clerk API calls)
      let commitMessage = message || `Add/Update workflow: ${workflowName}`;
      if (userContext?.email) {
        commitMessage = `${commitMessage}\n\nBy: ${userContext.email}`;
      }

      // Create or update file
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        message: commitMessage,
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

        const { data: pr } = await octokit.pulls.create({
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
    const supabase = getSupabaseAdmin();
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
      const octokit = await this.ensureOctokit();
      const { data } = await octokit.repos.getContent({
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

/**
 * Fetch user context from Clerk for enhanced commit messages
 * Handles both regular Clerk user IDs and desktop token scenarios
 */
export async function getUserContext(userId: string | null | undefined, orgId?: string | null): Promise<UserContext> {
  try {
    if (!process.env.CLERK_SECRET_KEY) {
      console.warn('CLERK_SECRET_KEY not configured, skipping user context fetch');
      return {};
    }

    // Skip Clerk API call if userId is invalid or a placeholder
    // Valid Clerk user IDs start with 'user_'
    if (!userId || !userId.startsWith('user_')) {
      console.log(`[getUserContext] Skipping Clerk API call for invalid userId: ${userId}`);
      
      // Still fetch organization name if orgId is provided
      if (orgId) {
        try {
          const clerkClient = createClerkClient({
            secretKey: process.env.CLERK_SECRET_KEY,
          });
          const org = await clerkClient.organizations.getOrganization({ organizationId: orgId });
          return { organizationName: org.name };
        } catch (orgError) {
          console.warn(`Failed to fetch organization ${orgId}:`, orgError);
        }
      }
      
      return {};
    }

    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    // Fetch user details (gracefully handle if user doesn't exist in Clerk)
    let userName: string | undefined;
    try {
      const user = await clerkClient.users.getUser(userId);
      userName = user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : user.firstName || user.lastName || undefined;
    } catch (_userError) {
      // User might not exist in Clerk (e.g., desktop auth, service accounts)
      console.log(`[getUserContext] User ${userId} not found in Clerk, continuing without user details`);
      // Don't throw - we can still proceed without the user name
    }

    // Fetch organization name if orgId is provided
    let organizationName: string | undefined;
    if (orgId) {
      try {
        const org = await clerkClient.organizations.getOrganization({ organizationId: orgId });
        organizationName = org.name;
      } catch (orgError) {
        console.warn(`Failed to fetch organization ${orgId}:`, orgError);
      }
    }

    return {
      name: userName,
      organizationName,
    };
  } catch (error) {
    console.error('Failed to fetch user context from Clerk:', error);
    return {};
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