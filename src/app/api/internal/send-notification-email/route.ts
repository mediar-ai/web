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

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://app.mediar.ai';

  // Extract useful debugging info from the execution details
  const executionDetails = alert.details || {};
  const workflowName = executionDetails.workflow_name || alert.workflow_name || `Workflow ${alert.workflow_id}`;
  const executionId = alert.execution_id || executionDetails.execution_id || executionDetails.id;
  const workflowId = alert.workflow_id || executionDetails.workflow_id;
  const errorMessage = alert.error_message || executionDetails.error_message || alert.message;
  const triggerSource = executionDetails.trigger_source || 'unknown';
  const duration = executionDetails.duration || executionDetails.execution_time_seconds || '0';

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
          padding: 32px 24px;
          text-align: center;
          border-radius: 8px 8px 0 0;
        }
        .alert-badge {
          display: inline-block;
          background: white;
          color: #000;
          padding: 6px 16px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-top: 16px;
          border: 2px solid white;
        }
        .content {
          background: white;
          padding: 32px 24px;
        }
        .action-button {
          display: inline-block;
          background: #000;
          color: white !important;
          padding: 14px 28px;
          border-radius: 6px;
          text-decoration: none !important;
          font-weight: 600;
          margin: 8px;
          border: 2px solid #000 !important;
          font-size: 14px;
          transition: all 0.2s;
        }
        .action-button:hover {
          background: #333;
          border-color: #333 !important;
        }
        .secondary-button {
          display: inline-block;
          background: white;
          color: #000 !important;
          padding: 12px 24px;
          border-radius: 6px;
          text-decoration: none !important;
          font-weight: 600;
          margin: 8px;
          border: 2px solid #000 !important;
          font-size: 14px;
          transition: all 0.2s;
        }
        .secondary-button:hover {
          background: #000;
          color: white !important;
        }
        .error-box {
          background: #fff5f5;
          border: 2px solid #000;
          border-left: 6px solid #000;
          border-radius: 6px;
          padding: 20px;
          margin: 24px 0;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace;
          font-size: 13px;
          color: #000;
          white-space: pre-wrap;
          word-wrap: break-word;
          line-height: 1.6;
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
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
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
          <h2 style="margin-bottom: 8px;">⚠️ Workflow Execution Failed</h2>
          <div class="workflow-name">${workflowName}</div>
          <div class="alert-badge">${alert.severity?.toUpperCase() || 'ERROR'}</div>
        </div>

        <div class="content">
          <p style="font-size: 16px; margin-top: 0;">
            <strong>${config.name}</strong> detected an error in your workflow execution.
          </p>

          <div class="error-box">
            <strong style="font-size: 14px;">Error:</strong> ${errorMessage || 'Workflow execution failed'}
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${baseUrl}/deployments?execution=${executionId}" class="action-button">
              View Execution Details →
            </a>
            <br/>
            <a href="${baseUrl}/deployments?workflow=${workflowId}" class="secondary-button">
              View Workflow
            </a>
          </div>

          <div class="metadata">
            <div class="metadata-item">
              <strong>Workflow ID:</strong> ${workflowId || 'N/A'}
            </div>
            <div class="metadata-item">
              <strong>Execution ID:</strong> ${executionId || 'N/A'}
            </div>
            <div class="metadata-item">
              <strong>Status:</strong> failed
            </div>
            <div class="metadata-item">
              <strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}
            </div>
            <div class="metadata-item">
              <strong>Duration:</strong> ${duration ? `${duration}s` : 'N/A'}
            </div>
          </div>

          <div class="debug-section">
            <div class="debug-title">🔍 Debug Information</div>
            <div class="metadata-item">
              <strong>Triggered By:</strong> ${triggerSource}
            </div>
          </div>



          <details style="margin-top: 20px;">
            <summary style="cursor: pointer; color: #000; font-size: 13px; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; font-weight: 600;">
              📊 View Full Details
            </summary>
            <div class="error-box" style="margin-top: 8px; font-size: 12px; background: #fafafa; border-color: #ddd; max-height: 400px; overflow-y: auto;">
              <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">${JSON.stringify(alert.details || alert, null, 2)
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')}</pre>
            </div>
          </details>
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