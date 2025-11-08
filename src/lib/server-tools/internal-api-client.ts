/**
 * Internal API client for server-to-server calls within the same Next.js app
 * Used by server-side tools to call API routes directly without HTTP overhead
 */

import { NextRequest } from 'next/server';

/**
 * Creates a mock NextRequest for internal API calls
 */
function createInternalRequest(
  url: string,
  method: string,
  body?: any,
  headers?: Record<string, string>
): NextRequest {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const fullUrl = `${baseUrl}${url}`;

  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  });

  const options: any = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  return new NextRequest(fullUrl, options);
}

/**
 * Internal API client that calls API routes directly
 * This ensures all workflow modifications go through the same code path
 * and GitHub sync happens automatically
 */
export class InternalAPIClient {
  private authToken?: string;
  private userId?: string;
  private orgId?: string | null;

  constructor(userContext?: { userId: string; orgId: string | null; authToken?: string }) {
    if (userContext) {
      this.userId = userContext.userId;
      this.orgId = userContext.orgId;
      this.authToken = userContext.authToken;
    }
  }

  /**
   * Create a new workflow version through the API route
   * This ensures GitHub sync happens automatically
   */
  async createWorkflowVersion(
    workflowId: number,
    yamlContent: string,
    changeNotes: string,
    setAsActive: boolean = false
  ): Promise<any> {
    try {
      // Import the route handler directly
      const { POST } = await import('@/app/api/remote-workflows/[workflowId]/versions/route');

      // Create request with authentication headers
      const headers: Record<string, string> = {};

      // Use service role for internal calls
      if (!this.authToken && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        headers['Authorization'] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
        headers['X-Internal-Call'] = 'true';
      } else if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      if (this.userId) {
        headers['X-User-Id'] = this.userId;
      }
      if (this.orgId) {
        headers['X-Org-Id'] = this.orgId;
      }

      const request = createInternalRequest(
        `/api/remote-workflows/${workflowId}/versions`,
        'POST',
        {
          yaml_content: yamlContent,
          change_notes: changeNotes,
          set_as_active: setAsActive,
        },
        headers
      );

      // Call the route handler directly
      const response = await POST(
        request,
        { params: Promise.resolve({ workflowId: workflowId.toString() }) }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create workflow version: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[InternalAPIClient] Error creating workflow version:', error);
      throw error;
    }
  }

  /**
   * Get the latest workflow version content
   */
  async getLatestWorkflowVersion(workflowId: number): Promise<{
    yamlContent: string | null;
    jsonContent: any | null;
    versionNumber: string;
  }> {
    // Use Supabase client directly for reads (no need for API route)
    const { createClient } = await import('@supabase/supabase-js');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: currentVersion, error } = await supabase
      .from('deployed_workflow_versions')
      .select('automation_sequence_yaml, automation_sequence, version_number')
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
    };
  }
}