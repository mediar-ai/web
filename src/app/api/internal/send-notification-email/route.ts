import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

// Initialize Resend only if API key is available
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Simple in-memory email queue for development/fallback
const emailQueue: any[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject, alert, config } = body;

    const emailHtml = generateEmailHTML(alert, config);

    // Check if Resend is configured
    if (process.env.RESEND_API_KEY && resend) {
      try {
        // Use a hardcoded fallback that we know works
        const fromEmail = (process.env.RESEND_FROM_EMAIL || 'alerts@alerts.mediar.ai').trim();
        console.log('Sending email with from:', JSON.stringify(fromEmail));

        // Send email using Resend
        const { data, error } = await resend.emails.send({
          from: fromEmail,
          to: Array.isArray(to) ? to : [to],
          subject,
          html: emailHtml,
        });

        if (error) {
          console.error('Resend error:', error);
          // Fall back to queue
          emailQueue.push({
            to,
            subject,
            html: emailHtml,
            timestamp: new Date().toISOString(),
            error: error.message,
          });
          return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        console.log('✅ Email sent successfully via Resend:', data);
        return NextResponse.json({ success: true, sent: true, id: data?.id });
      } catch (resendError) {
        console.error('Failed to send via Resend:', resendError);
        // Fall back to queue
        emailQueue.push({
          to,
          subject,
          html: emailHtml,
          timestamp: new Date().toISOString(),
          error: 'Resend service error',
        });
      }
    } else {
      // Development mode - just queue the email
      emailQueue.push({
        to,
        subject,
        html: emailHtml,
        timestamp: new Date().toISOString(),
      });
      console.log('📧 Email notification queued (no RESEND_API_KEY configured):', {
        to,
        subject,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true, queued: true });
  } catch (error) {
    console.error('Failed to process notification email:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process email' },
      { status: 500 }
    );
  }
}

// GET endpoint to view queued emails (development only)
export async function GET() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_EMAIL_QUEUE_VIEW) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  return NextResponse.json({
    emails: emailQueue,
    resendConfigured: !!process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'Not configured',
  });
}

function generateEmailHTML(alert: any, config: any): string {
  const severityColors: Record<string, string> = {
    low: '#10b981',
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#dc2626',
  };
  const severityColor = severityColors[alert.severity] || '#ef4444';

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://app.mediar.ai';

  // Extract useful debugging info from the execution details
  const executionDetails = alert.details || {};
  const workflowName = executionDetails.workflow_name || `Workflow ${alert.workflow_id}`;
  const failureStep = executionDetails.failed_step || 'Unknown step';
  const requestInfo = executionDetails.request_info || {};

  // Clean, professional email template with enhanced debugging
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.5;
          color: #1a1a1a;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
        }
        .header {
          background: #000;
          color: white;
          padding: 24px;
          text-align: center;
        }
        .alert-badge {
          display: inline-block;
          background: ${severityColor};
          color: white;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 12px;
        }
        .content {
          background: white;
          padding: 32px 24px;
        }
        .action-button {
          display: inline-block;
          background: #000;
          color: white !important;
          padding: 12px 24px;
          border-radius: 4px;
          text-decoration: none !important;
          font-weight: 500;
          margin: 20px 0;
          border: none !important;
        }
        .secondary-button {
          display: inline-block;
          background: white;
          color: #000 !important;
          padding: 12px 24px;
          border-radius: 4px;
          text-decoration: none !important;
          font-weight: 500;
          margin: 20px 10px;
          border: 2px solid #000 !important;
        }
        .error-box {
          background: #fee;
          border: 1px solid #fcc;
          border-left: 4px solid #f44;
          border-radius: 4px;
          padding: 16px;
          margin: 20px 0;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 13px;
          color: #333;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .metadata {
          margin: 24px 0;
          padding: 16px;
          background: #fafafa;
          border-radius: 4px;
          font-size: 14px;
        }
        .metadata-item {
          margin: 8px 0;
          color: #666;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 12px;
        }
        .metadata-item strong {
          color: #1a1a1a;
          font-weight: 500;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
        }
        .debug-section {
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 16px;
          margin-top: 20px;
        }
        .debug-title {
          font-weight: 600;
          margin-bottom: 10px;
          font-size: 14px;
        }
        .footer {
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: #666;
          border-top: 1px solid #e5e5e5;
        }
        a {
          color: #0066cc;
          text-decoration: none;
        }
        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }
        .workflow-name {
          font-size: 14px;
          color: #666;
          margin-top: 4px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Workflow Execution Failed</h2>
          <div class="workflow-name">${workflowName}</div>
          <div class="alert-badge">ERROR</div>
        </div>

        <div class="content">
          <p style="font-size: 16px; margin-top: 0;">
            <strong>${config.name}</strong> detected an error in your workflow execution.
          </p>

          ${alert.error_message ? `
            <div class="error-box">
              <strong>Error:</strong> ${alert.error_message}
              ${failureStep !== 'Unknown step' ? `\n<strong>Failed at:</strong> ${failureStep}` : ''}
            </div>
          ` : `
            <div class="error-box">${alert.message || 'Workflow execution failed without detailed error message.'}</div>
          `}

          <div style="text-align: center;">
            ${alert.execution_id ? `
              <a href="${baseUrl}/deployments?execution=${alert.execution_id}" class="action-button">
                View Execution Details →
              </a>
            ` : ''}
            ${alert.workflow_id ? `
              <a href="${baseUrl}/deployments/workflow/${alert.workflow_id}" class="secondary-button">
                View Workflow
              </a>
              <a href="${baseUrl}/deployments/workflow/${alert.workflow_id}/logs" class="secondary-button">
                View Logs
              </a>
            ` : ''}
          </div>

          <div class="metadata">
            <div class="metadata-item">
              <strong>Workflow ID:</strong> ${alert.workflow_id || 'Unknown'}
            </div>
            <div class="metadata-item">
              <strong>Execution ID:</strong> ${alert.execution_id || 'Unknown'}
            </div>
            <div class="metadata-item">
              <strong>Status:</strong> ${executionDetails.status || 'failed'}
            </div>
            <div class="metadata-item">
              <strong>Time:</strong> ${new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
              })}
            </div>
            ${executionDetails.duration ? `
              <div class="metadata-item">
                <strong>Duration:</strong> ${executionDetails.duration}
              </div>
            ` : ''}
          </div>

          ${requestInfo && Object.keys(requestInfo).length > 0 ? `
            <div class="debug-section">
              <div class="debug-title">🔍 Debug Information</div>
              ${requestInfo.ip ? `
                <div class="metadata-item">
                  <strong>Request IP:</strong> ${requestInfo.ip}
                </div>
              ` : ''}
              ${requestInfo.user_agent ? `
                <div class="metadata-item">
                  <strong>User Agent:</strong> ${requestInfo.user_agent}
                </div>
              ` : ''}
              ${requestInfo.trigger_source ? `
                <div class="metadata-item">
                  <strong>Triggered By:</strong> ${requestInfo.trigger_source}
                </div>
              ` : ''}
              ${executionDetails.parameters ? `
                <div class="metadata-item">
                  <strong>Parameters:</strong>
                  <pre style="margin: 5px 0; font-size: 11px; overflow-x: auto;">${JSON.stringify(executionDetails.parameters, null, 2)}</pre>
                </div>
              ` : ''}
            </div>
          ` : ''}

          ${executionDetails.stack_trace ? `
            <div class="debug-section">
              <div class="debug-title">📋 Stack Trace</div>
              <pre style="font-size: 11px; overflow-x: auto; max-height: 200px; overflow-y: auto;">
${executionDetails.stack_trace}
              </pre>
            </div>
          ` : ''}

          ${alert.details && Object.keys(alert.details).length > 0 ? `
            <details style="margin-top: 20px;">
              <summary style="cursor: pointer; color: #666; font-size: 14px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
                📊 View Full Details
              </summary>
              <div class="error-box" style="margin-top: 8px; font-size: 11px; background: #f9f9f9;">
${JSON.stringify(alert.details, null, 2)}
              </div>
            </details>
          ` : ''}
        </div>

        <div class="footer">
          <p style="margin: 0 0 12px 0;">
            <a href="${baseUrl}/deployments" style="font-weight: 500;">Deployment Dashboard</a> •
            <a href="${baseUrl}/internal/notifications">Notification Settings</a>
          </p>
          <p style="margin: 0; color: #999;">
            Mediar • Workflow Automation
          </p>
          <p style="margin: 8px 0 0 0; font-size: 11px; color: #bbb;">
            Alert ID: ${Date.now()}-${alert.execution_id || 'unknown'}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}