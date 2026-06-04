import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { auth, currentUser } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { clerkClient } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { isLegacyOrg } from '@/lib/client-config';

const notificationService = NotificationService.getInstance();

// Cache for non-existent orgs to avoid repeated 404 errors
const nonExistentOrgs = new Set<string>();

// Helper function to fetch organization members using Clerk SDK
async function getOrganizationMembers(orgId: string): Promise<string[]> {
  try {
    // Skip if we know this org doesn't exist
    if (nonExistentOrgs.has(orgId)) {
      return [];
    }

    // Handle legacy Mediar org (members not in Clerk; fall back to staff).
    if (isLegacyOrg(orgId)) {
      return ['matt@mediar.ai'];
    }

    const clerk = await clerkClient();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });

    const emails = memberships?.data?.map(membership =>
      membership.publicUserData?.identifier
    ).filter(Boolean) as string[] || [];

    return emails;
  } catch (error: any) {
    if (error?.status === 404) {
      // Cache this org ID to prevent future lookups
      nonExistentOrgs.add(orgId);
    }
    // Silently return empty array - no need to log these errors
    return [];
  }
}

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

    // Enrich alerts with workflow, execution, and recipient details
    const enrichedAlerts = await Promise.all(
      alerts.map(async (alert) => {
        let workflowName = null;
        let workflowOrgId = null;
        let executionStatus = null;
        const recipients: string[] = [];

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

        if (alert.execution_id) {
          // Use service role client to bypass RLS for workflow_executions
          const supabaseAdmin = getSupabaseAdmin();
          const { data: execution } = await supabaseAdmin
            .from('workflow_executions')
            .select('status')
            .eq('id', alert.execution_id)
            .single();

          if (execution) {
            executionStatus = execution.status;
          }
        }

        // Get recipients from config
        if (alert.config_id) {
          const { data: config } = await supabase
            .from('notification_configs')
            .select('email_recipients, organization_id')
            .eq('id', alert.config_id)
            .single();

          if (config) {
            // Add configured recipients
            if (config.email_recipients && Array.isArray(config.email_recipients)) {
              recipients.push(...config.email_recipients);
            }

            // Determine which org to fetch members from
            let targetOrgId = config.organization_id;
            if (!targetOrgId && workflowOrgId) {
              targetOrgId = workflowOrgId;
            }

            // If workflow has no owner (NULL organization_id), it's a shared workflow
            // Fetch members from ALL organizations with access
            if (!targetOrgId && alert.workflow_id) {
              try {
                const { data: sharedOrgs } = await supabase
                  .from('workflow_organization_access')
                  .select('organization_id')
                  .eq('workflow_id', alert.workflow_id);

                if (sharedOrgs && sharedOrgs.length > 0) {
                  // Fetch members from each organization using Clerk SDK
                  for (const org of sharedOrgs) {
                    const orgEmails = await getOrganizationMembers(org.organization_id);
                    recipients.push(...orgEmails);
                  }
                }
              } catch (err) {
                console.error(`Error fetching shared organizations for alert ${alert.id}:`, err);
              }
            } else if (targetOrgId) {
              // Fetch org members if we have a single target org
              try {
                const orgEmails = await getOrganizationMembers(targetOrgId);
                recipients.push(...orgEmails);
              } catch (err) {
                console.error(`Error fetching organization members for alert ${alert.id}:`, err);
              }
            }
          }
        }

        // Remove duplicates
        const uniqueRecipients = [...new Set(recipients)];

        return {
          ...alert,
          workflow_name: workflowName,
          workflow_organization_id: workflowOrgId,
          execution_status: executionStatus,
          recipients: uniqueRecipients,
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