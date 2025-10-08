import { GET } from '@/app/api/observability/telemetry/route';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@clickhouse/client';
import { isMediarAdmin } from '@/lib/mediarAuth';

// Mock dependencies
jest.mock('@clerk/nextjs/server');
jest.mock('@clickhouse/client');
jest.mock('@/lib/mediarAuth');

describe('/api/observability/telemetry', () => {
  const mockAuth = auth as jest.MockedFunction<typeof auth>;
  const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
  const mockIsMediarAdmin = isMediarAdmin as jest.MockedFunction<typeof isMediarAdmin>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLICKHOUSE_HOST = 'test.clickhouse.cloud';
    process.env.CLICKHOUSE_USER = 'test_user';
    process.env.CLICKHOUSE_PASSWORD = 'test_password';
    process.env.CLICKHOUSE_DATABASE = 'test_db';
  });

  it('should return 401 if user is not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);

    const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=overview');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('should return 403 if user is not Mediar admin', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
    mockIsMediarAdmin.mockResolvedValue(false);

    const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=overview');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Access denied - Mediar admin only');
  });

  describe('metric=overview', () => {
    it('should fetch service health overview', async () => {
      mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
      mockIsMediarAdmin.mockResolvedValue(true);

      const mockData = [
        {
          ServiceName: 'mediar-orchestrator',
          total_spans: 1000,
          errors: 10,
          error_rate: 1.0,
          last_seen: '2025-01-08T10:00:00Z',
          avg_duration_seconds: 2.5
        }
      ];

      const mockQuery = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      });

      mockCreateClient.mockReturnValue({
        query: mockQuery
      } as any);

      const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=overview&hours=24');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.metric).toBe('overview');
      expect(data.hours).toBe(24);
      expect(data.data).toEqual(mockData);

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.query).toContain('FROM otel_traces');
      expect(queryCall.query).toContain('GROUP BY ServiceName');
    });
  });

  describe('metric=executions', () => {
    it('should fetch recent workflow executions', async () => {
      mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
      mockIsMediarAdmin.mockResolvedValue(true);

      const mockData = [
        {
          Timestamp: '2025-01-08T10:00:00Z',
          TraceId: 'trace123',
          ServiceName: 'mediar-orchestrator',
          SpanName: 'execute_sequence',
          duration_seconds: 5.2,
          StatusCode: 'STATUS_CODE_OK',
          StatusMessage: '',
          SpanAttributes: { 'workflow.name': 'TestWorkflow', 'workflow.total_steps': '5' },
          workflow_name: 'TestWorkflow',
          total_steps: '5',
          host_name: 'machine-01'
        }
      ];

      const mockQuery = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      });

      mockCreateClient.mockReturnValue({
        query: mockQuery
      } as any);

      const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=executions&hours=6');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].workflow_name).toBe('TestWorkflow');

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.query).toContain('SpanName = \'execute_sequence\'');
      expect(queryCall.query).toContain('INTERVAL 6 HOUR');
    });
  });

  describe('metric=tools', () => {
    it('should fetch tool usage statistics', async () => {
      mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
      mockIsMediarAdmin.mockResolvedValue(true);

      const mockData = [
        {
          tool: 'computer.screenshot',
          executions: 150,
          avg_seconds: 0.5,
          max_seconds: 2.0,
          failures: 5,
          failure_rate: 3.33
        },
        {
          tool: 'computer.click',
          executions: 300,
          avg_seconds: 0.2,
          max_seconds: 1.0,
          failures: 0,
          failure_rate: 0.0
        }
      ];

      const mockQuery = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      });

      mockCreateClient.mockReturnValue({
        query: mockQuery
      } as any);

      const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=tools&hours=24');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].tool).toBe('computer.screenshot');
      expect(data.data[1].executions).toBe(300);

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.query).toContain('SpanName LIKE \'step.%\'');
      expect(queryCall.query).toContain('GROUP BY tool');
    });
  });

  describe('metric=errors', () => {
    it('should fetch recent errors with context', async () => {
      mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
      mockIsMediarAdmin.mockResolvedValue(true);

      const mockData = [
        {
          Timestamp: '2025-01-08T10:00:00Z',
          TraceId: 'trace123',
          SpanId: 'span456',
          ServiceName: 'mediar-orchestrator',
          operation: 'step.click',
          duration_seconds: 1.5,
          SpanAttributes: {
            'error.message': 'Element not found',
            'error.type': 'element_not_found',
            'workflow.name': 'TestWorkflow',
            'step.number': '3',
            'step.total': '10',
            'tool.name': 'computer.click'
          },
          error_message: 'Element not found',
          error_type: 'element_not_found',
          workflow_name: 'TestWorkflow',
          workflow_step: '3',
          total_steps: '10',
          tool_name: 'computer.click',
          host_name: 'machine-01',
          StatusMessage: 'Error executing step'
        }
      ];

      const mockQuery = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      });

      mockCreateClient.mockReturnValue({
        query: mockQuery
      } as any);

      const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=errors&hours=12');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].error_type).toBe('element_not_found');
      expect(data.data[0].workflow_step).toBe('3');

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.query).toContain('StatusCode = \'STATUS_CODE_ERROR\'');
      expect(queryCall.query).toContain('INTERVAL 12 HOUR');
    });
  });

  describe('metric=timeline', () => {
    it('should fetch performance timeline data', async () => {
      mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
      mockIsMediarAdmin.mockResolvedValue(true);

      const mockData = [
        {
          time: '2025-01-08T10:00:00Z',
          ServiceName: 'mediar-orchestrator',
          span_count: 50,
          avg_duration_seconds: 1.2,
          max_duration_seconds: 5.0,
          errors: 2
        }
      ];

      const mockQuery = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      });

      mockCreateClient.mockReturnValue({
        query: mockQuery
      } as any);

      const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=timeline&hours=48');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].span_count).toBe(50);

      const queryCall = mockQuery.mock.calls[0][0];
      expect(queryCall.query).toContain('toStartOfMinute(Timestamp)');
      expect(queryCall.query).toContain('INTERVAL 48 HOUR');
    });
  });

  it('should return 400 for invalid metric type', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
    mockIsMediarAdmin.mockResolvedValue(true);

    const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=invalid');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid metric type');
  });

  it('should handle ClickHouse query errors', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
    mockIsMediarAdmin.mockResolvedValue(true);

    const mockQuery = jest.fn().mockRejectedValue(new Error('Query execution failed'));

    mockCreateClient.mockReturnValue({
      query: mockQuery
    } as any);

    const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=overview');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch telemetry data');
    expect(data.details).toBe('Query execution failed');
  });

  it('should create ClickHouse client with correct configuration', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
    mockIsMediarAdmin.mockResolvedValue(true);

    const mockQuery = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([])
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery
    } as any);

    const request = new NextRequest('http://localhost:3000/api/observability/telemetry?metric=overview');
    await GET(request);

    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'https://test.clickhouse.cloud:8443',
      username: 'test_user',
      password: 'test_password',
      database: 'test_db'
    });
  });
});
