import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Simple in-memory email queue for development/fallback
const emailQueue: any[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject, alert, config } = body;

    const emailHtml = generateEmailHTML(alert, config);

    // Check if Resend is configured
    if (process.env.RESEND_API_KEY) {
      try {
        // Send email using Resend
        const { data, error } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'alerts@alerts.mediar.ai',
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

  // Clean, professional email template
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
        .error-box {
          background: #f9f9f9;
          border: 1px solid #e5e5e5;
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
        }
        .metadata-item strong {
          color: #1a1a1a;
          font-weight: 500;
        }
        .footer {
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: #666;
          border-top: 1px solid #e5e5e5;
        }
        a {
          color: #000;
          text-decoration: none;
          border-bottom: 1px solid #000;
        }
        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Workflow Execution Failed</h2>
          <div class="alert-badge">ERROR</div>
        </div>

        <div class="content">
          <p style="font-size: 16px; margin-top: 0;">
            <strong>${config.name}</strong> detected an error in your workflow execution.
          </p>

          ${alert.error_message ? `
            <div class="error-box">${alert.error_message}</div>
          ` : `
            <div class="error-box">${alert.message || 'Workflow execution failed without detailed error message.'}</div>
          `}

          <div class="metadata">
            ${alert.workflow_id ? `
              <div class="metadata-item">
                <strong>Workflow:</strong> ${alert.workflow_id}
              </div>
            ` : ''}
            ${alert.execution_id ? `
              <div class="metadata-item">
                <strong>Execution:</strong> ${alert.execution_id}
              </div>
            ` : ''}
            <div class="metadata-item">
              <strong>Time:</strong> ${new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
              })}
            </div>
          </div>

          ${alert.details && Object.keys(alert.details).length > 0 ? `
            <details style="margin-top: 20px;">
              <summary style="cursor: pointer; color: #666; font-size: 14px;">View additional details</summary>
              <div class="error-box" style="margin-top: 8px; font-size: 12px;">
${JSON.stringify(alert.details, null, 2)}
              </div>
            </details>
          ` : ''}
        </div>

        <div class="footer">
          <p style="margin: 0;">
            <a href="${process.env.NEXT_PUBLIC_URL || 'https://app.mediar.ai'}/deployments" style="font-weight: 500;">View Deployment Dashboard</a>
          </p>
          <p style="margin: 8px 0 0 0; color: #999;">
            Mediar • Workflow Automation
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}