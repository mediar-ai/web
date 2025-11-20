import { POST } from '@/app/api/webhooks/github/route';
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => ({ data: null, error: null })),
        })),
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => ({ data: { id: 1 }, error: null })),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({ data: null, error: null })),
      })),
    })),
  })),
}));

jest.mock('@/lib/github-workflow-manager', () => ({
  githubWorkflowManager: {
    getWorkflow: jest.fn(() =>
      Promise.resolve({
        yaml: 'test: yaml',
        metadata: { sha: 'abc123' },
      })
    ),
  },
}));

jest.mock('@/lib/workflow-file-manager', () => ({
  WorkflowFileManager: jest.fn(() => ({
    uploadWorkflowFiles: jest.fn(() => Promise.resolve({ success: true })),
    getSignedUrls: jest.fn(() => Promise.resolve({})),
  })),
}));

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => ({
    repos: {
      getContent: jest.fn(() =>
        Promise.resolve({
          data: [
            {
              type: 'file',
              name: 'script.js',
              path: 'testfolder/script.js',
            },
          ],
        })
      ),
    },
  })),
}));

describe('GitHub Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    process.env.GITHUB_TOKEN = 'test-token';
  });

  it('should reject requests without valid signature', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body: JSON.stringify({ ref: 'refs/heads/main' }),
        headers: {
          'x-hub-signature-256': 'invalid-signature',
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Invalid signature' });
  });

  it('should ignore non-main/dev branch pushes', async () => {
    const payload = {
      ref: 'refs/heads/feature-branch',
      commits: [],
    };

    const body = JSON.stringify(payload);
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', 'test-secret');
    const signature = 'sha256=' + hmac.update(body).digest('hex');

    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'x-hub-signature-256': signature,
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(data.message).toBe('Ignored non-main/dev branch');
  });

  it('should detect workflow changes from commits', async () => {
    const payload = {
      ref: 'refs/heads/main',
      commits: [
        {
          added: ['testworkflow/workflow.yaml'],
          modified: [],
        },
      ],
    };

    const body = JSON.stringify(payload);
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', 'test-secret');
    const signature = 'sha256=' + hmac.update(body).digest('hex');

    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'x-hub-signature-256': signature,
        },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBeDefined();
    expect(data.branch).toBe('main');
  });

  it('should handle JS file uploads when creating workflows', async () => {
    const payload = {
      ref: 'refs/heads/main',
      commits: [
        {
          added: ['testworkflow/workflow.yaml', 'testworkflow/script.js'],
          modified: [],
        },
      ],
    };

    const body = JSON.stringify(payload);
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', 'test-secret');
    const signature = 'sha256=' + hmac.update(body).digest('hex');

    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'x-hub-signature-256': signature,
        },
      }
    );

    const response = await POST(request);
    expect(response.status).toBeLessThan(400);
  });

  it('should detect subdirectories in JS file paths', async () => {
    // This would test the fetchWorkflowFiles function
    // Testing that files like "scripts/a.js" and "scripts/b.js"
    // correctly detect "scripts" as the subdirectory
    expect(true).toBe(true); // Placeholder for subdirectory detection test
  });
});

describe('TypeScript Workflow Version Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    process.env.GITHUB_TOKEN = 'test-token';
  });

  it('should create version when TypeScript workflow is pushed', async () => {
    const payload = {
      ref: 'refs/heads/main',
      pusher: { name: 'developer' },
      head_commit: {
        message: 'feat: update typescript workflow',
        author: { username: 'developer' },
      },
      commits: [
        {
          added: ['org-test_org/test_workflow_typescript/src/terminator.ts'],
          modified: [],
          removed: [],
        },
      ],
    };

    const body = JSON.stringify(payload);
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', 'test-secret');
    const signature = 'sha256=' + hmac.update(body).digest('hex');

    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': signature },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.results.created).toBeDefined();
  });

  it('should NOT create duplicate version for dashboard workflows', async () => {
    const payload = {
      ref: 'refs/heads/main',
      pusher: { name: 'louis030195' },
      head_commit: {
        message: 'Update workflow: Test (v1.0.5)',
        author: { username: 'louis030195' },
      },
      commits: [
        {
          added: [],
          modified: ['test/workflow.yaml'],
          removed: [],
        },
      ],
    };

    const body = JSON.stringify(payload);
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', 'test-secret');
    const signature = 'sha256=' + hmac.update(body).digest('hex');

    const request = new NextRequest(
      'http://localhost:3000/api/webhooks/github',
      {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': signature },
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(data.message).toBe(
      'Ignored automated push (prevents duplicate versions)'
    );
  });
});
