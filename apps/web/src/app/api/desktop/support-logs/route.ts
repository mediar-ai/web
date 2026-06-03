import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY.trim())
  : null;

export async function POST(request: NextRequest) {
  console.log('[support-logs] Received support log upload request');

  if (!resend) {
    console.error('[support-logs] RESEND_API_KEY not configured');
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 });
  }

  const systemInfo = (formData.get('system_info') as string) ?? 'No system info provided';
  const logsZip = formData.get('logs_zip') as File | null;

  if (!logsZip) {
    return NextResponse.json({ error: 'No logs_zip field provided' }, { status: 400 });
  }

  const zipBuffer = Buffer.from(await logsZip.arrayBuffer());
  const filename = logsZip.name || 'mediar-logs.zip';

  console.log(`[support-logs] Sending ${filename} (${zipBuffer.length} bytes) via Resend`);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'alerts@alerts.mediar.ai',
    to: [process.env.SUPPORT_LOGS_EMAIL ?? 'support@mediar.ai'],
    subject: `Support Logs - Mediar Desktop - ${filename}`,
    text: systemInfo,
    attachments: [{ filename, content: zipBuffer }],
  });

  if (error) {
    console.error('[support-logs] Resend error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }

  console.log('[support-logs] Email sent successfully');
  return NextResponse.json({ success: true });
}
