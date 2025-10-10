#!/usr/bin/env node

const { createClient } = require('@clickhouse/client');

// ClickHouse client configuration
const client = createClient({
  url: 'https://h4xqcq6igz.us-west-2.aws.clickhouse.cloud:8443',
  username: 'default',
  password: 'oi~mx3yL8UOgh',
  database: 'default',
});

async function queryLogsWithWorkflow() {
  try {
    console.log('='.repeat(80));
    console.log('LOGS WITH WORKFLOW CORRELATION');
    console.log('='.repeat(80));

    // 1. Get all workflow executions with their TraceIds
    console.log('\n1. WORKFLOW EXECUTIONS (LAST 24 HOURS):');
    console.log('-'.repeat(40));

    const workflowQuery = `
      SELECT
        TraceId,
        toString(min(Timestamp)) as start_time,
        toString(max(Timestamp)) as end_time,
        if(mapContains(any(SpanAttributes), 'workflow.name'),
           any(SpanAttributes)['workflow.name'],
           'unknown') as workflow_name,
        count() as span_count,
        countIf(StatusCode = 'STATUS_CODE_ERROR') as error_spans,
        round(sum(Duration)/1e9, 3) as total_duration_seconds
      FROM otel_traces
      WHERE SpanName = 'execute_sequence'
        AND Timestamp > now() - INTERVAL 24 HOUR
      GROUP BY TraceId
      ORDER BY min(Timestamp) DESC
      LIMIT 20
    `;

    const workflows = await client.query({ query: workflowQuery, format: 'JSONEachRow' });
    const workflowsData = await workflows.json();

    if (workflowsData.length > 0) {
      console.log(`Found ${workflowsData.length} workflow executions\n`);

      // Store TraceIds for log correlation
      const traceIds = workflowsData.map(w => w.TraceId);

      workflowsData.forEach((wf, idx) => {
        console.log(`[${idx + 1}] ${wf.workflow_name}`);
        console.log(`    TraceId: ${wf.TraceId}`);
        console.log(`    Time: ${wf.start_time} to ${wf.end_time}`);
        console.log(`    Spans: ${wf.span_count} (${wf.error_spans} errors)`);
        console.log(`    Duration: ${wf.total_duration_seconds}s`);
        console.log();
      });

      // 2. Get logs for these workflow traces
      console.log('\n2. LOGS CORRELATED WITH WORKFLOWS:');
      console.log('-'.repeat(40));

      const logsQuery = `
        WITH workflow_traces AS (
          SELECT DISTINCT
            TraceId,
            if(mapContains(any(SpanAttributes), 'workflow.name'),
               any(SpanAttributes)['workflow.name'],
               'unknown') as workflow_name
          FROM otel_traces
          WHERE SpanName = 'execute_sequence'
            AND Timestamp > now() - INTERVAL 24 HOUR
          GROUP BY TraceId
        )
        SELECT
          l.TraceId,
          toString(l.Timestamp) as log_time,
          l.SeverityText,
          l.ServiceName,
          l.ScopeName,
          substring(l.Body, 1, 200) as log_message,
          wt.workflow_name,
          if(mapContains(l.LogAttributes, 'code.function'),
             l.LogAttributes['code.function'], '') as function_name,
          if(mapContains(l.LogAttributes, 'code.filepath'),
             l.LogAttributes['code.filepath'], '') as file_path
        FROM otel_logs l
        INNER JOIN workflow_traces wt ON l.TraceId = wt.TraceId
        WHERE l.Timestamp > now() - INTERVAL 24 HOUR
          AND l.TraceId != ''
        ORDER BY l.Timestamp DESC
        LIMIT 50
      `;

      const logs = await client.query({ query: logsQuery, format: 'JSONEachRow' });
      const logsData = await logs.json();

      if (logsData.length > 0) {
        console.log(`Found ${logsData.length} logs associated with workflows\n`);

        // Group logs by workflow
        const logsByWorkflow = {};
        logsData.forEach(log => {
          const key = `${log.workflow_name}|${log.TraceId}`;
          if (!logsByWorkflow[key]) {
            logsByWorkflow[key] = [];
          }
          logsByWorkflow[key].push(log);
        });

        Object.keys(logsByWorkflow).slice(0, 5).forEach(key => {
          const [workflowName, traceId] = key.split('|');
          const logs = logsByWorkflow[key];

          console.log(`\nWorkflow: ${workflowName}`);
          console.log(`TraceId: ${traceId}`);
          console.log(`Log Count: ${logs.length}`);
          console.log('-'.repeat(60));

          logs.slice(0, 5).forEach(log => {
            console.log(`[${log.SeverityText.padEnd(7)}] ${log.log_time}`);
            console.log(`         ${log.ScopeName}`);
            if (log.function_name) console.log(`         Function: ${log.function_name}`);
            if (log.file_path) console.log(`         File: ${log.file_path}`);
            console.log(`         ${log.log_message.replace(/\n/g, ' ')}`);
            console.log();
          });
        });
      } else {
        console.log('No logs found with TraceIds matching workflow executions');
      }

      // 3. Show logs without TraceId for comparison
      console.log('\n3. RECENT LOGS WITHOUT TRACEID (NOT CORRELATED):');
      console.log('-'.repeat(40));

      const orphanLogsQuery = `
        SELECT
          toString(Timestamp) as log_time,
          SeverityText,
          ServiceName,
          ScopeName,
          substring(Body, 1, 150) as log_message,
          if(mapContains(ResourceAttributes, 'host.name'),
             ResourceAttributes['host.name'], '') as host
        FROM otel_logs
        WHERE Timestamp > now() - INTERVAL 1 HOUR
          AND (TraceId = '' OR TraceId IS NULL)
        ORDER BY Timestamp DESC
        LIMIT 10
      `;

      const orphanLogs = await client.query({ query: orphanLogsQuery, format: 'JSONEachRow' });
      const orphanLogsData = await orphanLogs.json();

      if (orphanLogsData.length > 0) {
        console.log(`Found ${orphanLogsData.length} logs without TraceId (sample):\n`);

        orphanLogsData.slice(0, 5).forEach((log, idx) => {
          console.log(`[${idx + 1}] [${log.SeverityText.padEnd(7)}] ${log.log_time}`);
          console.log(`    Scope: ${log.ScopeName}`);
          console.log(`    Host: ${log.host || 'N/A'}`);
          console.log(`    Message: ${log.log_message.replace(/\n/g, ' ')}`);
          console.log();
        });
      }

    } else {
      console.log('No workflow executions found in the last 24 hours');
    }

    // 4. Summary statistics
    console.log('\n4. CORRELATION STATISTICS:');
    console.log('-'.repeat(40));

    const statsQuery = `
      SELECT
        count() as total_logs,
        countIf(TraceId != '') as logs_with_traceid,
        countIf(TraceId = '' OR TraceId IS NULL) as logs_without_traceid,
        round((logs_with_traceid / total_logs) * 100, 2) as traceid_percentage,
        count(DISTINCT TraceId) as unique_traces,
        count(DISTINCT ServiceName) as unique_services
      FROM otel_logs
      WHERE Timestamp > now() - INTERVAL 24 HOUR
    `;

    const stats = await client.query({ query: statsQuery, format: 'JSONEachRow' });
    const statsData = await stats.json();

    if (statsData.length > 0) {
      const stat = statsData[0];
      console.log(`Total logs (24h): ${stat.total_logs}`);
      console.log(`Logs with TraceId: ${stat.logs_with_traceid} (${stat.traceid_percentage}%)`);
      console.log(`Logs without TraceId: ${stat.logs_without_traceid}`);
      console.log(`Unique traces: ${stat.unique_traces}`);
      console.log(`Unique services: ${stat.unique_services}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('KEY INSIGHTS:');
    console.log('='.repeat(80));
    console.log(`
1. CURRENT STATE:
   - Logs table has a TraceId field that can correlate with workflow traces
   - Most logs currently don't have TraceId populated
   - Workflow executions in traces have 'workflow.name' attribute

2. TO ENABLE LOG-WORKFLOW CORRELATION:
   - Ensure your application propagates TraceId when logging
   - Use OpenTelemetry context propagation in your code
   - Logs emitted during workflow execution will automatically include TraceId

3. CLICKHOUSE QUERY PATTERN:
   - Join otel_logs with otel_traces on TraceId
   - Filter traces by SpanName = 'execute_sequence' for workflows
   - Extract workflow.name from SpanAttributes map

4. IMPLEMENTATION IN OBSERVABILITY UI:
   - Add TraceId column to logs view
   - When TraceId exists, query traces table for workflow context
   - Display workflow name/ID alongside log entries
   - Enable filtering logs by specific workflow execution
`);

    await client.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the query
queryLogsWithWorkflow();