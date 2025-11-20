import { GET } from '@/app/api/observability/logs/route';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@clickhouse/client';

// Mock dependencies
jest.mock('@clerk/nextjs/server');
jest.mock('@clickhouse/client');

describe('/api/observability/logs', () => {
  const mockAuth = auth as jest.MockedFunction<typeof auth>;
  const mockCreateClient = createClient as jest.MockedFunction<
    typeof createClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLICKHOUSE_HOST = 'test.clickhouse.cloud';
    process.env.CLICKHOUSE_USER = 'test_user';
    process.env.CLICKHOUSE_PASSWORD = 'test_password';
    process.env.CLICKHOUSE_DATABASE = 'test_db';
  });

  it('should return 401 if user is not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('should fetch logs with default parameters', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockLogs = [
      {
        Timestamp: '2025-01-08T10:00:00Z',
        ScopeName: 'workflow.execute',
        Body: 'Workflow started',
        SeverityText: 'INFO',
        ServiceName: 'mediar-orchestrator',
        TraceId: 'trace123',
        SpanId: 'span123',
      },
    ];

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify(mockLogs[0])),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].Body).toBe('Workflow started');
    expect(data.hours).toBe(24);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'JSONEachRow',
      })
    );
  });

  it('should fetch logs with custom time range', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(''),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs?hours=6'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hours).toBe(6);
    const queryCall = mockQuery.mock.calls[0][0];
    expect(queryCall.query).toContain('INTERVAL 6 HOUR');
  });

  it('should fetch logs with scope filter', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(''),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs?scope=workflow'
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const queryCall = mockQuery.mock.calls[0][0];
    expect(queryCall.query).toContain("ScopeName LIKE '%workflow%'");
  });

  it('should fetch logs with service filter (checking host.name and ServiceName)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(''),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs?service=my-service'
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const queryCall = mockQuery.mock.calls[0][0];
    // Check for the complex OR condition
    expect(queryCall.query).toContain(
      "((mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] = 'my-service') OR ServiceName = 'my-service')"
    );
  });

  it('should return available filters including merged hosts and services', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockFilters = {
      hosts: ['host-1', 'host-2'],
      services: ['service-1', 'host-1'], // 'host-1' overlaps
      scopes: ['scope-1'],
      severities: ['INFO'],
    };

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify(mockFilters)),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs?getFilters=true'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.filters.hosts).toEqual(
      expect.arrayContaining(['host-1', 'host-2', 'service-1'])
    );
    // verify deduplication
    expect(data.filters.hosts.length).toBe(3);
    expect(data.filters.scopes).toEqual(['scope-1']);
  });

  it('should handle ClickHouse errors gracefully', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockQuery = jest
      .fn()
      .mockRejectedValue(new Error('ClickHouse connection failed'));

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch logs');
    expect(data.details).toBe('ClickHouse connection failed');
  });

  it('should parse multi-line JSON response correctly', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_123' } as any);

    const mockLogs = [
      {
        Timestamp: '2025-01-08T10:00:00Z',
        ScopeName: 'test1',
        Body: 'Log 1',
        SeverityText: 'INFO',
        ServiceName: 'service1',
        TraceId: 'trace1',
        SpanId: 'span1',
      },
      {
        Timestamp: '2025-01-08T10:01:00Z',
        ScopeName: 'test2',
        Body: 'Log 2',
        SeverityText: 'ERROR',
        ServiceName: 'service2',
        TraceId: 'trace2',
        SpanId: 'span2',
      },
    ];

    const mockTextResponse = mockLogs
      .map(log => JSON.stringify(log))
      .join('\n');

    const mockQuery = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(mockTextResponse),
    });

    mockCreateClient.mockReturnValue({
      query: mockQuery,
    } as any);

    const request = new NextRequest(
      'http://localhost:3000/api/observability/logs'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.logs).toHaveLength(2);
    expect(data.logs[0].Body).toBe('Log 1');
    expect(data.logs[1].Body).toBe('Log 2');
    expect(data.count).toBe(2);
  });
});
