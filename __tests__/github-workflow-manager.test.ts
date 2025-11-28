/**
 * Unit tests for GitHubWorkflowManager.updatePackageJson
 */

// Mock modules before importing
const mockSupabaseSelect = jest.fn();
const mockSupabaseEq = jest.fn();
const mockSupabaseSingle = jest.fn();
const mockOctokitGetContent = jest.fn();
const mockOctokitCreateOrUpdate = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: mockSupabaseSelect.mockReturnValue({
        eq: mockSupabaseEq.mockReturnValue({
          single: mockSupabaseSingle,
        }),
      }),
    })),
  })),
}));

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: {
      getContent: mockOctokitGetContent,
      createOrUpdateFileContents: mockOctokitCreateOrUpdate,
    },
  })),
}));

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

// Import after mocks
import { GitHubWorkflowManager } from '@/lib/github-workflow-manager';

describe('GitHubWorkflowManager', () => {
  let manager: GitHubWorkflowManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new GitHubWorkflowManager();
  });

  describe('updatePackageJson', () => {
    it('should return error when workflow not found', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await manager.updatePackageJson(123, { name: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when workflow has no github_folder (legacy)', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: null,
          github_path: null,
          name: 'Legacy Workflow',
        },
        error: null,
      });

      const result = await manager.updatePackageJson(123, { name: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('legacy workflow');
    });

    it('should return error when package.json not found (legacy YAML workflow)', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/my-workflow',
          github_path: 'org-123/my-workflow/workflow.yaml',
          name: 'My Workflow',
        },
        error: null,
      });

      mockOctokitGetContent.mockRejectedValue({ status: 404 });

      const result = await manager.updatePackageJson(123, { name: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No package.json found');
    });

    it('should update package.json name and description successfully', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/my-workflow',
          github_path: 'org-123/my-workflow/workflow.yaml',
          name: 'My Workflow',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(
            JSON.stringify({
              name: 'old-name',
              version: '1.0.0',
              description: 'Old description',
            })
          ).toString('base64'),
          sha: 'abc123',
        },
      });

      mockOctokitCreateOrUpdate.mockResolvedValue({
        data: {
          commit: { sha: 'new-sha-456' },
        },
      });

      const result = await manager.updatePackageJson(
        123,
        { name: 'New Workflow Name', description: 'New description' },
        { email: 'test@example.com' }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe('org-123/my-workflow/package.json');
      expect(result.sha).toBe('new-sha-456');
      expect(result.workflowId).toBe(123);

      // Verify the call
      expect(mockOctokitCreateOrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'org-123/my-workflow/package.json',
          sha: 'abc123',
        })
      );

      // Decode and verify the content
      const call = mockOctokitCreateOrUpdate.mock.calls[0][0];
      const updatedContent = JSON.parse(
        Buffer.from(call.content, 'base64').toString('utf-8')
      );
      expect(updatedContent.name).toBe('new-workflow-name'); // sanitized
      expect(updatedContent.description).toBe('New description');
      expect(updatedContent.version).toBe('1.0.0'); // preserved
    });

    it('should sanitize name for npm package naming', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/test',
          github_path: 'org-123/test/workflow.yaml',
          name: 'Test',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(JSON.stringify({ name: 'old' })).toString(
            'base64'
          ),
          sha: 'abc',
        },
      });

      mockOctokitCreateOrUpdate.mockResolvedValue({
        data: { commit: { sha: 'new' } },
      });

      await manager.updatePackageJson(123, {
        name: 'My Cool Workflow! @#$%',
      });

      const call = mockOctokitCreateOrUpdate.mock.calls[0][0];
      const content = JSON.parse(
        Buffer.from(call.content, 'base64').toString('utf-8')
      );

      // Should be lowercase, special chars replaced with hyphens, trimmed
      expect(content.name).toBe('my-cool-workflow');
    });

    it('should only update description when name not provided', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/test',
          github_path: 'org-123/test/workflow.yaml',
          name: 'Test',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(
            JSON.stringify({
              name: 'original-name',
              description: 'Old desc',
            })
          ).toString('base64'),
          sha: 'abc',
        },
      });

      mockOctokitCreateOrUpdate.mockResolvedValue({
        data: { commit: { sha: 'new' } },
      });

      await manager.updatePackageJson(123, {
        description: 'New description only',
      });

      const call = mockOctokitCreateOrUpdate.mock.calls[0][0];
      const content = JSON.parse(
        Buffer.from(call.content, 'base64').toString('utf-8')
      );

      expect(content.name).toBe('original-name'); // unchanged
      expect(content.description).toBe('New description only');
    });

    it('should include user email in commit message', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/test',
          github_path: 'org-123/test/workflow.yaml',
          name: 'Test Workflow',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(JSON.stringify({ name: 'test' })).toString(
            'base64'
          ),
          sha: 'abc',
        },
      });

      mockOctokitCreateOrUpdate.mockResolvedValue({
        data: { commit: { sha: 'new' } },
      });

      await manager.updatePackageJson(
        123,
        { name: 'Updated' },
        { email: 'user@company.com' }
      );

      const call = mockOctokitCreateOrUpdate.mock.calls[0][0];
      expect(call.message).toContain('Test Workflow');
      expect(call.message).toContain('user@company.com');
    });

    it('should handle GitHub API errors gracefully', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-123/test',
          github_path: 'org-123/test/workflow.yaml',
          name: 'Test',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(JSON.stringify({ name: 'test' })).toString(
            'base64'
          ),
          sha: 'abc',
        },
      });

      mockOctokitCreateOrUpdate.mockRejectedValue(
        new Error('GitHub API rate limit')
      );

      const result = await manager.updatePackageJson(123, { name: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub API rate limit');
    });

    it('should derive package.json path correctly from github_folder', async () => {
      mockSupabaseSingle.mockResolvedValue({
        data: {
          github_folder: 'org-abc123/456_my-workflow',
          github_path: 'org-abc123/456_my-workflow/workflow.yaml',
          name: 'Test',
        },
        error: null,
      });

      mockOctokitGetContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(JSON.stringify({ name: 'test' })).toString(
            'base64'
          ),
          sha: 'abc',
        },
      });

      mockOctokitCreateOrUpdate.mockResolvedValue({
        data: { commit: { sha: 'new' } },
      });

      const result = await manager.updatePackageJson(123, { name: 'test' });

      expect(result.path).toBe('org-abc123/456_my-workflow/package.json');
      expect(mockOctokitGetContent).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'org-abc123/456_my-workflow/package.json',
        })
      );
    });
  });
});
