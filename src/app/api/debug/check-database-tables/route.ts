import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { orgId, userId } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'No organization context' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check all tables in the public schema
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .order('table_name');

    // Check columns of deployed_workflows table
    const { data: workflowColumns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'deployed_workflows')
      .order('ordinal_position');

    // Check if workflow_organization_access exists
    const { data: accessColumns, error: accessColumnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'workflow_organization_access')
      .order('ordinal_position');

    // Check sample deployed_workflows data
    const { data: sampleWorkflows, error: workflowsError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .limit(3);

    // Check if there are any user-related tables
    const userTables = tables?.filter(t =>
      t.table_name.includes('user') ||
      t.table_name.includes('org') ||
      t.table_name.includes('member')
    );

    // Try to check workflow_organization_access data
    let accessData = null;
    let accessError = null;
    try {
      const result = await supabase
        .from('workflow_organization_access')
        .select('*')
        .limit(5);
      accessData = result.data;
      accessError = result.error;
    } catch (e) {
      accessError = e;
    }

    return NextResponse.json({
      currentContext: {
        orgId,
        userId,
      },
      database: {
        allTables: tables?.map(t => t.table_name),
        userRelatedTables: userTables?.map(t => t.table_name),
        deployedWorkflowsColumns: workflowColumns,
        workflowOrganizationAccessColumns: accessColumns,
      },
      sampleData: {
        workflows: sampleWorkflows,
        workflowOrganizationAccess: accessData,
      },
      errors: {
        tables: tablesError?.message,
        columns: columnsError?.message,
        accessColumns: accessColumnsError?.message,
        workflows: workflowsError?.message,
        access: typeof accessError === 'object' && accessError && 'message' in accessError
          ? (accessError as any).message
          : accessError?.toString(),
      }
    });
  } catch (error) {
    console.error('Error checking database tables:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}