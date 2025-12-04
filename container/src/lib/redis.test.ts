import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from './redis.js';

// Mock Redis before importing the module
vi.mock('ioredis', () => {
  const mockData = new Map<string, string>();

  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn((key: string) => Promise.resolve(mockData.get(key) || null)),
      setex: vi.fn((key: string, _ttl: number, value: string) => {
        mockData.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn((key: string) => {
        mockData.delete(key);
        return Promise.resolve(1);
      }),
      on: vi.fn(),
      disconnect: vi.fn(),
      isOpen: false,
    })),
  };
});

describe('Redis Session Management', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Interface', () => {
    it('should have correct session shape', () => {
      const session: Session = {
        id: 'test-session-id',
        userId: 'user-123',
        organizationId: 'org-456',
        workflowId: 789,
        messages: [{ role: 'user', content: 'Hello' }],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:01:00Z',
      };

      expect(session.id).toBe('test-session-id');
      expect(session.userId).toBe('user-123');
      expect(session.organizationId).toBe('org-456');
      expect(session.workflowId).toBe(789);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].role).toBe('user');
    });

    it('should allow optional workflowId', () => {
      const session: Session = {
        id: 'test-session-id',
        userId: 'user-123',
        organizationId: 'org-456',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:01:00Z',
      };

      expect(session.workflowId).toBeUndefined();
    });

    it('should allow empty messages array', () => {
      const session: Session = {
        id: 'test-session-id',
        userId: 'user-123',
        organizationId: 'org-456',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:00:00Z',
      };

      expect(session.messages).toHaveLength(0);
    });
  });

  describe('Session Serialization', () => {
    it('should correctly serialize session to JSON', () => {
      const session: Session = {
        id: 'test-id',
        userId: 'user-1',
        organizationId: 'org-1',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:00:00Z',
      };

      const json = JSON.stringify(session);
      const parsed = JSON.parse(json) as Session;

      expect(parsed.id).toBe(session.id);
      expect(parsed.userId).toBe(session.userId);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].content).toBe('Hello');
      expect(parsed.messages[1].content).toBe('Hi there!');
    });

    it('should handle special characters in content', () => {
      const session: Session = {
        id: 'test-id',
        userId: 'user-1',
        organizationId: 'org-1',
        messages: [
          { role: 'user', content: 'Hello\n"quoted"\ttab' },
          { role: 'user', content: '日本語テスト' },
          { role: 'user', content: '🎉 emoji test' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:00:00Z',
      };

      const json = JSON.stringify(session);
      const parsed = JSON.parse(json) as Session;

      expect(parsed.messages[0].content).toBe('Hello\n"quoted"\ttab');
      expect(parsed.messages[1].content).toBe('日本語テスト');
      expect(parsed.messages[2].content).toBe('🎉 emoji test');
    });

    it('should handle very long messages', () => {
      const longContent = 'a'.repeat(100000);
      const session: Session = {
        id: 'test-id',
        userId: 'user-1',
        organizationId: 'org-1',
        messages: [{ role: 'user', content: longContent }],
        createdAt: '2024-01-01T00:00:00Z',
        lastActiveAt: '2024-01-01T00:00:00Z',
      };

      const json = JSON.stringify(session);
      const parsed = JSON.parse(json) as Session;

      expect(parsed.messages[0].content.length).toBe(100000);
    });
  });
});
