import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { auth, currentUser } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

const notificationService = NotificationService.getInstance();

// GET alerts with optional filters and org-based access control
// - @mediar.ai admins: returns ALL alerts
// - Regular users: returns alerts for their organization only (via workflow.organization_id)
export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    const user = await currentUser();

    // Check if user is a Mediar admin
    const isMediarAdmin = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    const { searchParams } = new URL(request.url);
    const filters = {
      configId: searchParams.get('configId') ? parseInt(searchParams.get('configId')!) : undefined,
      workflowId: searchParams.get('workflowId') ? parseInt(searchParams.get('workflowId')!) : undefined,
      severity: searchParams.get('severity') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
    };

    // Get alerts from notification service
    let alerts = await notificationService.getAlerts(filters);

    // Apply organization filtering for non-Mediar users
    if (!isMediarAdmin) {
      if (!orgId) {
        return NextResponse.json(
          { success: false, error: 'Organization not found' },
          { status: 401 }
        );
      }

      // Get workflow IDs for this organization
      const { data: workflows } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('organization_id', orgId);

      const orgWorkflowIds = new Set((workflows || []).map(w => w.id));

      // Filter alerts to only include those from org's workflows
      alerts = alerts.filter(alert =>
        alert.workflow_id && orgWorkflowIds.has(alert.workflow_id)
      );
    }

    // Enrich alerts with workflow and execution details
    const enrichedAlerts = await Promise.all(
      alerts.map(async (alert) => {
        let workflowName = null;
        let workflowOrgId = null;

        if (alert.workflow_id) {
          const { data: workflow } = await supabase
            .from('deployed_workflows')
            .select('name, organization_id')
            .eq('id', alert.workflow_id)
            .single();

          if (workflow) {
            workflowName = workflow.name;
            workflowOrgId = workflow.organization_id;
          }
        }

        return {
          ...alert,
          workflow_name: workflowName,
          workflow_organization_id: workflowOrgId,
        };
      })
    );

    return NextResponse.json({ success: true, alerts: enrichedAlerts });
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}

// POST create new alert (mainly for testing)
export async function POST(request: NextRequest) {
  try {
    const alert = await request.json();
    const newAlert = await notificationService.createAlert(alert);
    return NextResponse.json({ success: true, alert: newAlert });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}