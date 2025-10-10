#!/usr/bin/env node

const { createClient } = require('@clickhouse/client');

// ClickHouse client configuration
const client = createClient({
  url: 'https://h4xqcq6igz.us-west-2.aws.clickhouse.cloud:8443',
  username: 'default',
  password: 'oi~mx3yL8UOgh',
  database: 'default',
});

async function exploreTables() {
  try {
    console.log('='.repeat(80));
    console.log('CLICKHOUSE TABLE EXPLORATION');
    console.log('='.repeat(80));

    // 1. List all tables
    console.log('\n1. AVAILABLE TABLES:');
    console.log('-'.repeat(40));
    const tablesQuery = `
      SELECT
        name as table_name,
        total_rows,
        total_bytes,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
        AND name NOT LIKE '.%'
      ORDER BY total_bytes DESC
    `;

    const tables = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
    const tablesData = await tables.json();

    console.log('Table Name'.padEnd(30), 'Rows'.padStart(15), 'Size'.padStart(15));
    console.log('-'.repeat(60));
    tablesData.forEach(table => {
      console.log(
        table.table_name.padEnd(30),
        (table.total_rows || 0).toString().padStart(15),
        (table.size || '0.00 B').padStart(15)
      );
    });

    // 2. Explore otel_traces structure
    console.log('\n2. OTEL_TRACES TABLE STRUCTURE:');
    console.log('-'.repeat(40));
    const schemaQuery = `
      SELECT
        name as column_name,
        type as data_type,
        comment
      FROM system.columns
      WHERE table = 'otel_traces'
        AND database = currentDatabase()
      ORDER BY position
    `;

    const schema = await client.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schemaData = await schema.json();

    console.log('Column'.padEnd(30), 'Type'.padEnd(40));
    console.log('-'.repeat(70));
    schemaData.forEach(col => {
      console.log(col.column_name.padEnd(30), col.data_type.padEnd(40));
    });

    // 3. Sample recent traces with workflow info
    console.log('\n3. RECENT TRACES WITH WORKFLOW INFO:');
    console.log('-'.repeat(40));
    const sampleQuery = `
      SELECT
        toString(Timestamp) as time,
        TraceId,
        SpanId,
        SpanName,
        ServiceName,
        ScopeName,
        -- Extract all workflow-related attributes
        if(mapContains(SpanAttributes, 'workflow.id'), SpanAttributes['workflow.id'], '') as workflow_id,
        if(mapContains(SpanAttributes, 'workflow.name'), SpanAttributes['workflow.name'], '') as workflow_name,
        if(mapContains(SpanAttributes, 'workflow.execution_id'), SpanAttributes['workflow.execution_id'], '') as execution_id,
        if(mapContains(SpanAttributes, 'workflow.total_steps'), SpanAttributes['workflow.total_steps'], '') as total_steps,
        if(mapContains(SpanAttributes, 'step.number'), SpanAttributes['step.number'], '') as step_number,
        if(mapContains(SpanAttributes, 'tool.name'), SpanAttributes['tool.name'], '') as tool_name,
        StatusCode,
        mapKeys(SpanAttributes) as all_attributes
      FROM otel_traces
      WHERE Timestamp > now() - INTERVAL 1 HOUR
        AND (mapContains(SpanAttributes, 'workflow.id')
          OR mapContains(SpanAttributes, 'workflow.name')
          OR SpanName = 'execute_sequence')
      ORDER BY Timestamp DESC
      LIMIT 10
    `;

    const samples = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samplesData = await samples.json();

    if (samplesData.length > 0) {
      console.log('\nFound', samplesData.length, 'workflow-related traces:\n');

      samplesData.forEach((trace, idx) => {
        console.log(`[${idx + 1}] ${trace.time}`);
        console.log(`    TraceId: ${trace.TraceId}`);
        console.log(`    SpanName: ${trace.SpanName}`);
        console.log(`    Service: ${trace.ServiceName} / ${trace.ScopeName}`);
        if (trace.workflow_id) console.log(`    Workflow ID: ${trace.workflow_id}`);
        if (trace.workflow_name) console.log(`    Workflow Name: ${trace.workflow_name}`);
        if (trace.execution_id) console.log(`    Execution ID: ${trace.execution_id}`);
        if (trace.tool_name) console.log(`    Tool: ${trace.tool_name}`);
        if (trace.step_number) console.log(`    Step: ${trace.step_number}/${trace.total_steps}`);
        console.log(`    Status: ${trace.StatusCode}`);
        console.log(`    Available Attributes: ${trace.all_attributes.join(', ')}`);
        console.log();
      });
    } else {
      console.log('No workflow traces found in the last hour');
    }

    // 4. Explore otel_logs structure
    console.log('\n4. OTEL_LOGS TABLE STRUCTURE:');
    console.log('-'.repeat(40));
    const logsSchemaQuery = `
      SELECT
        name as column_name,
        type as data_type
      FROM system.columns
      WHERE table = 'otel_logs'
        AND database = currentDatabase()
      ORDER BY position
      LIMIT 20
    `;

    const logsSchema = await client.query({ query: logsSchemaQuery, format: 'JSONEachRow' });
    const logsSchemaData = await logsSchema.json();

    if (logsSchemaData.length > 0) {
      console.log('Column'.padEnd(30), 'Type'.padEnd(40));
      console.log('-'.repeat(70));
      logsSchemaData.forEach(col => {
        console.log(col.column_name.padEnd(30), col.data_type.padEnd(40));
      });
    } else {
      console.log('otel_logs table not found');
    }

    // 5. Sample recent logs
    console.log('\n5. RECENT LOG ENTRIES WITH WORKFLOW CONTEXT:');
    console.log('-'.repeat(40));
    const logsQuery = `
      SELECT
        toString(Timestamp) as time,
        TraceId,
        SeverityText,
        Body,
        ServiceName,
        ScopeName,
        if(mapContains(LogAttributes, 'workflow.id'), LogAttributes['workflow.id'], '') as workflow_id,
        if(mapContains(LogAttributes, 'workflow.name'), LogAttributes['workflow.name'], '') as workflow_name,
        if(mapContains(ResourceAttributes, 'host.name'), ResourceAttributes['host.name'], '') as host,
        mapKeys(LogAttributes) as log_attributes
      FROM otel_logs
      WHERE Timestamp > now() - INTERVAL 1 HOUR
      ORDER BY Timestamp DESC
      LIMIT 10
    `;

    const logs = await client.query({ query: logsQuery, format: 'JSONEachRow' });
    const logsData = await logs.json();

    if (logsData.length > 0) {
      console.log('\nFound', logsData.length, 'recent log entries:\n');

      logsData.forEach((log, idx) => {
        console.log(`[${idx + 1}] ${log.time} [${log.SeverityText}]`);
        console.log(`    TraceId: ${log.TraceId || 'N/A'}`);
        console.log(`    Service: ${log.ServiceName} / ${log.ScopeName}`);
        console.log(`    Message: ${log.Body.substring(0, 100)}${log.Body.length > 100 ? '...' : ''}`);
        if (log.workflow_id) console.log(`    Workflow ID: ${log.workflow_id}`);
        if (log.workflow_name) console.log(`    Workflow Name: ${log.workflow_name}`);
        if (log.host) console.log(`    Host: ${log.host}`);
        if (log.log_attributes.length > 0) {
          console.log(`    Attributes: ${log.log_attributes.join(', ')}`);
        }
        console.log();
      });
    } else {
      console.log('No log entries found in the last hour');
    }

    // 6. Check for workflow correlation
    console.log('\n6. WORKFLOW CORRELATION CHECK:');
    console.log('-'.repeat(40));
    const correlationQuery = `
      SELECT
        TraceId,
        count() as span_count,
        countIf(table = 'traces') as trace_spans,
        countIf(table = 'logs') as log_entries,
        groupArray(DISTINCT if(table = 'traces' AND mapContains(SpanAttributes, 'workflow.id'),
          SpanAttributes['workflow.id'], '')) as workflow_ids,
        groupArray(DISTINCT if(table = 'traces' AND mapContains(SpanAttributes, 'workflow.name'),
          SpanAttributes['workflow.name'], '')) as workflow_names,
        groupArray(DISTINCT if(table = 'logs', SeverityText, '')) as log_severities,
        min(Timestamp) as start_time,
        max(Timestamp) as end_time
      FROM (
        SELECT
          'traces' as table,
          Timestamp,
          TraceId,
          SpanAttributes,
          '' as SeverityText
        FROM otel_traces
        WHERE Timestamp > now() - INTERVAL 1 HOUR
          AND TraceId != ''

        UNION ALL

        SELECT
          'logs' as table,
          Timestamp,
          TraceId,
          map() as SpanAttributes,
          SeverityText
        FROM otel_logs
        WHERE Timestamp > now() - INTERVAL 1 HOUR
          AND TraceId != ''
      )
      GROUP BY TraceId
      HAVING span_count > 1
      ORDER BY span_count DESC
      LIMIT 5
    `;

    const correlation = await client.query({ query: correlationQuery, format: 'JSONEachRow' });
    const correlationData = await correlation.json();

    if (correlationData.length > 0) {
      console.log('\nTraces with both logs and spans:');
      correlationData.forEach((trace, idx) => {
        console.log(`\n[${idx + 1}] TraceId: ${trace.TraceId}`);
        console.log(`    Total Records: ${trace.span_count} (${trace.trace_spans} spans, ${trace.log_entries} logs)`);
        const workflowIds = trace.workflow_ids.filter(id => id !== '');
        const workflowNames = trace.workflow_names.filter(name => name !== '');
        if (workflowIds.length > 0) console.log(`    Workflow IDs: ${workflowIds.join(', ')}`);
        if (workflowNames.length > 0) console.log(`    Workflow Names: ${workflowNames.join(', ')}`);
        const severities = trace.log_severities.filter(s => s !== '');
        if (severities.length > 0) console.log(`    Log Severities: ${severities.join(', ')}`);
        console.log(`    Duration: ${trace.start_time} to ${trace.end_time}`);
      });
    } else {
      console.log('No correlated traces and logs found');
    }

    console.log('\n' + '='.repeat(80));
    console.log('EXPLORATION COMPLETE');
    console.log('='.repeat(80));

    await client.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the exploration
exploreTables();