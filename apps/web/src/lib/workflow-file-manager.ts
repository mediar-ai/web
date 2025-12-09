import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import path from 'path';

export interface WorkflowFile {
  path: string;
  content: Buffer;
  hash?: string;
  size?: number;
}

export interface FileUploadResult {
  success: boolean;
  files?: Array<{
    file_path: string;
    storage_path: string;
    file_hash: string;
    storage_url?: string;
  }>;
  error?: string;
}

export class WorkflowFileManager {
  private supabase;
  private bucketName = 'workflow-files';

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Upload workflow files to Supabase Storage
   */
  async uploadWorkflowFiles(
    workflowId: number,
    version: string,
    files: WorkflowFile[],
    subdirectory?: string
  ): Promise<FileUploadResult> {
    try {
      const fileRecords = [];
      // Fetch clerk_organization_id for the workflow
      const { data: workflowData, error: workflowError } = await this.supabase
        .from('deployed_workflows')
        .select('organization_id')
        .eq('id', workflowId)
        .single();

      if (workflowError || !workflowData?.organization_id) {
        throw new Error(`Failed to get organization for workflow ${workflowId}: ${workflowError?.message || 'No organization_id'}`);  
      }
      // organization_id column stores clerk_organization_id directly (e.g., "org_REDACTED")
      const clerkOrgId = workflowData.organization_id;
      console.log(`[WorkflowFileManager] Using org: ${clerkOrgId} for workflow ${workflowId}`);


      const uploadedFiles = [];

      // Normalize all file paths to use forward slashes
      const normalizedFiles = files.map(f => ({
        ...f,
        path: f.path.replace(/\\/g, '/')
      }));

      // Auto-detect subdirectory if not provided
      let detectedSubdir = subdirectory;
      console.log(`[WorkflowFileManager] Received subdirectory param: ${subdirectory}`);
      console.log(`[WorkflowFileManager] Processing ${normalizedFiles.length} files`);

      if (!detectedSubdir && normalizedFiles.length > 0) {
        // Check if all files share a common subdirectory
        const firstFile = normalizedFiles[0].path;
        const firstSlash = firstFile.indexOf('/');
        console.log(`[WorkflowFileManager] First file: ${firstFile}, slash position: ${firstSlash}`);

        if (firstSlash > 0) {
          const potentialSubdir = firstFile.substring(0, firstSlash);
          console.log(`[WorkflowFileManager] Potential subdir: ${potentialSubdir}`);

          // Check if all files start with this subdirectory
          if (normalizedFiles.every(f => f.path.startsWith(potentialSubdir + '/'))) {
            detectedSubdir = potentialSubdir;
            console.log(`[WorkflowFileManager] Auto-detected subdirectory: ${detectedSubdir}`);
          }
        }
      }
      console.log(`[WorkflowFileManager] Final subdirectory: ${detectedSubdir || 'none'}`);

      for (const file of normalizedFiles) {
        // Generate hash for tracking (but not for file naming)
        const hash = file.hash || this.generateHash(file.content);

        // Always use workflow-specific path (no deduplication across workflows)
        // This ensures each workflow has its own files in its directory
        const storagePath = this.generateStoragePath(workflowId, version, file.path, hash, clerkOrgId);

          const { error: uploadError } = await this.supabase.storage
            .from(this.bucketName)
            .upload(storagePath, file.content, {
              contentType: this.getContentType(file.path),
              upsert: true, // Allow overwriting for same workflow
              cacheControl: '3600' // Cache for 1 hour
            });

          if (uploadError) {
            throw new Error(`Failed to upload ${file.path}: ${uploadError.message}`);
          }

        // Record file metadata
        const fileRecord = {
          workflow_id: workflowId,
          version_number: version,
          file_path: file.path,
          storage_path: storagePath,
          file_hash: hash,
          file_size: file.content.length,
          content_type: this.getContentType(file.path),
          metadata: {
            original_name: path.basename(file.path),
            uploaded_at: new Date().toISOString()
          }
        };

        fileRecords.push(fileRecord);
        uploadedFiles.push({
          file_path: file.path,
          storage_path: storagePath,
          file_hash: hash
        });
      }

      // Batch insert file records
      if (fileRecords.length > 0) {
        const { error: insertError } = await this.supabase
          .from('workflow_files')
          .insert(fileRecords);

        if (insertError) {
          console.error('[WorkflowFileManager] Database insert error:', insertError);
          // Continue without throwing - files are uploaded to storage successfully
          console.warn('[WorkflowFileManager] Files uploaded to storage but database records failed');
        }
      }

      // Update workflow to indicate it has external files
      // Note: Webhook handles the deployed_workflows update separately
      // This prevents conflict when called from webhook context
      console.log(`[WorkflowFileManager] Successfully uploaded ${files.length} files for workflow ${workflowId}`);

      return {
        success: true,
        files: uploadedFiles
      };
    } catch (error) {
      console.error('Error uploading workflow files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload files'
      };
    }
  }

  /**
   * Get signed URLs for workflow files
   */
  async getSignedUrls(
    workflowId: number,
    version: string,
    expiresIn: number = 3600
  ): Promise<Record<string, string>> {
    // Get all files for this workflow version
    const { data: files, error } = await this.supabase
      .from('workflow_files')
      .select('file_path, storage_path')
      .eq('workflow_id', workflowId)
      .eq('version_number', version);

    if (error || !files) {
      throw new Error(`Failed to get workflow files: ${error?.message}`);
    }

    const urls: Record<string, string> = {};

    for (const file of files) {
      const { data } = await this.supabase.storage
        .from(this.bucketName)
        .createSignedUrl(file.storage_path, expiresIn);

      if (data?.signedUrl) {
        urls[file.file_path] = data.signedUrl;
      }
    }

    return urls;
  }

  /**
   * Update YAML content with file URLs
   */
  updateYamlWithFileUrls(
    yamlContent: string,
    fileUrls: Record<string, string>
  ): string {
    let updatedYaml = yamlContent;

    // Replace require() statements
    for (const [filePath, url] of Object.entries(fileUrls)) {
      // Handle various require patterns
      const patterns = [
        `require('./${filePath}')`,
        `require("${filePath}")`,
        `require('${filePath}')`,
        `require("./${filePath}")`
      ];

      for (const pattern of patterns) {
        updatedYaml = updatedYaml.replace(
          new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          `require('${url}')`
        );
      }

      // Also handle script_path references
      updatedYaml = updatedYaml.replace(
        new RegExp(`script_path:\\s*['"]?${filePath}['"]?`, 'g'),
        `script_path: "${url}"`
      );
    }

    // Add file reference metadata as comment
    const filesList = Object.keys(fileUrls).join(', ');
    if (filesList) {
      updatedYaml = `# External files: ${filesList}\n${updatedYaml}`;
    }

    return updatedYaml;
  }

  /**
   * Clean up old files
   */
  async cleanupOldFiles(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Find old files
    const { data: oldFiles, error } = await this.supabase
      .from('workflow_files')
      .select('id, storage_path, file_hash')
      .lt('last_accessed_at', cutoffDate.toISOString());

    if (error || !oldFiles) {
      console.error('Error finding old files:', error);
      return 0;
    }

    let deletedCount = 0;

    for (const file of oldFiles) {
      // Check if file is still referenced by other workflows
      const { count } = await this.supabase
        .from('workflow_files')
        .select('id', { count: 'exact', head: true })
        .eq('file_hash', file.file_hash)
        .neq('id', file.id);

      if (count === 0) {
        // No other references, safe to delete from storage
        const { error: deleteError } = await this.supabase.storage
          .from(this.bucketName)
          .remove([file.storage_path]);

        if (!deleteError) {
          deletedCount++;
        }
      }

      // Remove database record
      await this.supabase
        .from('workflow_files')
        .delete()
        .eq('id', file.id);
    }

    // Update cleanup policy last run
    await this.supabase
      .from('file_cleanup_policy')
      .update({ last_run_at: new Date().toISOString() })
      .eq('policy_name', 'storage_cleanup');

    return deletedCount;
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<any> {
    const { data } = await this.supabase
      .from('machine_cache_stats')
      .select('*');

    return data || [];
  }

  // Helper methods
  private generateHash(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private generateStoragePath(
    workflowId: number,
    version: string,
    filePath: string,
    _hash: string,
    clerkOrgId: string
  ): string {
    // Preserve original file structure without hash prefix
    // Format: workflows/{id}/{filepath}
    // This allows rclone mount to preserve the file structure
    // NEW: Use org-based path structure
    // Format: org-{clerk_org_id}/workflows/{id}/{filepath}
    // This matches the rclone mount structure on VMs
    return `org-${clerkOrgId}/workflows/${workflowId}/${filePath}`;
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.yaml': 'application/x-yaml',
      '.yml': 'application/x-yaml',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.ts': 'application/typescript'
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  /**
   * Download all files for a workflow from storage
   */
  async downloadWorkflowFiles(
    workflowId: number
  ): Promise<{ success: boolean; files?: Array<{ path: string; content: string }>; error?: string }> {
    try {
      // Get organization for this workflow
      const { data: workflowData, error: workflowError } = await this.supabase
        .from('deployed_workflows')
        .select('organization_id')
        .eq('id', workflowId)
        .single();

      if (workflowError || !workflowData?.organization_id) {
        return { success: false, error: `Workflow not found: ${workflowError?.message}` };
      }

      const clerkOrgId = workflowData.organization_id;
      const prefix = `org-${clerkOrgId}/workflows/${workflowId}/`;

      // List all files in the workflow directory
      const { data: fileList, error: listError } = await this.supabase.storage
        .from(this.bucketName)
        .list(prefix.slice(0, -1), { limit: 1000 }); // Remove trailing slash for list

      if (listError) {
        return { success: false, error: `Failed to list files: ${listError.message}` };
      }

      if (!fileList || fileList.length === 0) {
        return { success: true, files: [] };
      }

      // Download each file
      const files: Array<{ path: string; content: string }> = [];

      for (const file of fileList) {
        if (file.name === '.emptyFolderPlaceholder') continue;

        const filePath = `${prefix}${file.name}`;
        const { data, error: downloadError } = await this.supabase.storage
          .from(this.bucketName)
          .download(filePath);

        if (downloadError) {
          console.error(`Failed to download ${filePath}:`, downloadError);
          continue;
        }

        const content = await data.text();
        files.push({
          path: file.name, // Relative path within workflow
          content,
        });
      }

      // Also check for subdirectories (src/, src/steps/, etc.)
      const subdirs = ['src', 'src/steps'];
      for (const subdir of subdirs) {
        const subdirPrefix = `${prefix}${subdir}`;
        const { data: subdirFiles } = await this.supabase.storage
          .from(this.bucketName)
          .list(subdirPrefix, { limit: 1000 });

        if (subdirFiles) {
          for (const file of subdirFiles) {
            if (file.name === '.emptyFolderPlaceholder') continue;

            const filePath = `${subdirPrefix}/${file.name}`;
            const { data, error: downloadError } = await this.supabase.storage
              .from(this.bucketName)
              .download(filePath);

            if (downloadError) {
              console.error(`Failed to download ${filePath}:`, downloadError);
              continue;
            }

            const content = await data.text();
            files.push({
              path: `${subdir}/${file.name}`,
              content,
            });
          }
        }
      }

      console.log(`[WorkflowFileManager] Downloaded ${files.length} files for workflow ${workflowId}`);
      return { success: true, files };

    } catch (error) {
      console.error('[WorkflowFileManager] Download error:', error);
      return { success: false, error: String(error) };
    }
  }
}

// Export singleton instance
export const workflowFileManager = new WorkflowFileManager();