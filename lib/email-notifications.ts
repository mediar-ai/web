// Enhanced email notification system with error analysis
import { createServerClient } from '@/lib/supabase/server';

interface WorkflowErrorNotification {
  workflowName: string;
  executionId: string;
  errorSummary: string;
  errorAnalysis?: string;
  dashboardUrl: string;
  recipientEmail: string;
}

export async function sendWorkflowErrorNotification({
  workflowName,
  executionId,
  errorSummary,
  errorAnalysis,
  dashboardUrl,
  recipientEmail,
}: WorkflowErrorNotification) {
  // Generate email content with analysis
  const subject = `🚨 Workflow Failed: ${workflowName}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; padding: 20px; }
        .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 15px; margin: 15px 0; }
        .analysis-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 15px; margin: 15px 0; }
        .solution-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 15px; margin: 15px 0; }
        .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
        .button:hover { background: #2563eb; }
        h1 { margin: 0; font-size: 24px; }
        h2 { color: #1f2937; font-size: 18px; margin-top: 20px; }
        .metadata { color: #6b7280; font-size: 14px; }
        ul { margin: 10px 0; padding-left: 20px; }
        li { margin: 5px 0; }
        .code { font-family: 'Monaco', 'Courier New', monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>❌ Workflow Execution Failed</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${workflowName}</p>
        </div>
        <div class="content">
          <p class="metadata">
            <strong>Execution ID:</strong> <span class="code">${executionId}</span><br>
            <strong>Time:</strong> ${new Date().toLocaleString()}
          </p>

          <div class="error-box">
            <h2>📋 Error Summary</h2>
            <p>${errorSummary}</p>
          </div>

          ${errorAnalysis ? `
            <div class="analysis-box">
              <h2>🤖 AI Analysis</h2>
              ${formatAnalysisForEmail(errorAnalysis)}
            </div>
          ` : ''}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${dashboardUrl}/workflows/executions/${executionId}" class="button">
              View Full Details in Dashboard →
            </a>
          </div>

          <div style="border-top: 1px solid #e5e7eb; margin-top: 30px; padding-top: 20px;">
            <h2>💡 Quick Actions</h2>
            <ul>
              <li><a href="${dashboardUrl}/workflows/executions/${executionId}">View execution logs</a></li>
              <li><a href="${dashboardUrl}/settings/machines">Check machine status</a></li>
              <li><a href="${dashboardUrl}/workflows">Review workflow configuration</a></li>
            </ul>
          </div>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            This is an automated notification from your workflow automation system.
            To manage notification preferences, visit your <a href="${dashboardUrl}/settings/notifications">settings</a>.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Workflow Failed: ${workflowName}
================================

Execution ID: ${executionId}
Time: ${new Date().toLocaleString()}

ERROR SUMMARY:
${errorSummary}

${errorAnalysis ? `
AI ANALYSIS:
${errorAnalysis}
` : ''}

View full details: ${dashboardUrl}/workflows/executions/${executionId}

---
This is an automated notification from your workflow automation system.
  `;

  // Send email using your preferred email service (SendGrid, Resend, etc.)
  // For now, we'll store it in a notifications table
  const supabase = await createServerClient();

  await supabase.from('email_notifications').insert({
    recipient: recipientEmail,
    subject,
    html_content: htmlContent,
    text_content: textContent,
    workflow_execution_id: executionId,
    sent_at: new Date().toISOString(),
    status: 'pending',
  });

  // If you have an email service configured:
  // await sendEmail({ to: recipientEmail, subject, html: htmlContent, text: textContent });

  return { success: true };
}

function formatAnalysisForEmail(analysis: string): string {
  // Convert markdown-style analysis to HTML
  let html = analysis
    .replace(/\*\*Root Cause[:\s]*/gi, '<h3>🔍 Root Cause</h3><p>')
    .replace(/\*\*Solution[:\s]*/gi, '</p><h3>✅ Solution</h3><ul>')
    .replace(/\*\*Prevention[:\s]*/gi, '</ul><h3>🛡️ Prevention</h3><p>')
    .replace(/\*\*Impact[:\s]*/gi, '</p><h3>⚠️ Impact</h3><p>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\*\*/g, '<strong>')
    .replace(/\*/g, '</strong>');

  // Clean up any unclosed tags
  if (!html.includes('</p>')) html += '</p>';
  if (html.includes('<ul>') && !html.includes('</ul>')) html += '</ul>';

  return html;
}

// Function to be called when a workflow fails
export async function notifyWorkflowFailure(
  executionId: string,
  workflowId: string,
  error: any,
  errorAnalysis?: string
) {
  const supabase = await createServerClient();

  // Get workflow details
  const { data: workflow } = await supabase
    .from('workflows')
    .select('name, created_by')
    .eq('id', workflowId)
    .single();

  if (!workflow) return;

  // Get user email
  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', workflow.created_by)
    .single();

  if (!user?.email) return;

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  await sendWorkflowErrorNotification({
    workflowName: workflow.name,
    executionId,
    errorSummary: error?.message || 'Unknown error occurred',
    errorAnalysis,
    dashboardUrl,
    recipientEmail: user.email,
  });
}