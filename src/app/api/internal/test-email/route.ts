import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject } = body;

    if (!to) {
      return NextResponse.json(
        { success: false, error: 'Email address required' },
        { status: 400 }
      );
    }

    const testEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; border-radius: 5px; }
          .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; margin-top: 20px; border-radius: 5px; }
          .success { color: #4CAF50; font-weight: bold; }
          .info { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #4CAF50; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">✅ Email Configuration Test Successful!</h2>
          </div>
          <div class="content">
            <p class="success">Your email notification system is working correctly!</p>

            <div class="info">
              <h3>Configuration Details:</h3>
              <ul>
                <li><strong>Resend API:</strong> ${process.env.RESEND_API_KEY ? 'Configured ✓' : 'Not configured ✗'}</li>
                <li><strong>From Email:</strong> ${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'}</li>
                <li><strong>Test Time:</strong> ${new Date().toLocaleString()}</li>
                <li><strong>Recipient:</strong> ${to}</li>
              </ul>
            </div>

            <p>This test confirms that:</p>
            <ul>
              <li>✓ Your Resend API key is valid</li>
              <li>✓ Email sending is properly configured</li>
              <li>✓ You can receive notification alerts</li>
            </ul>

            <p style="margin-top: 20px;">
              When workflow errors occur, you'll receive similar notification emails based on your configured alert rules.
            </p>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
              <p>This is a test email from your deployment monitoring system.</p>
              <p>Configure notifications at: <a href="${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/internal/notifications">Notification Settings</a></p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    if (process.env.RESEND_API_KEY) {
      try {
        const { data, error } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          to: Array.isArray(to) ? to : [to],
          subject: subject || 'Test Email - Notification System',
          html: testEmailHtml,
        });

        if (error) {
          console.error('Resend error:', error);
          return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        console.log('✅ Test email sent successfully:', data);
        return NextResponse.json({ success: true, sent: true, id: data?.id });
      } catch (resendError: any) {
        console.error('Failed to send test email:', resendError);
        return NextResponse.json(
          { success: false, error: resendError.message || 'Failed to send email' },
          { status: 500 }
        );
      }
    } else {
      console.log('📧 Test email (no API key configured):', { to, subject });
      return NextResponse.json({
        success: true,
        sent: false,
        queued: true,
        message: 'Email would be sent if RESEND_API_KEY was configured',
      });
    }
  } catch (error) {
    console.error('Failed to process test email:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process test email' },
      { status: 500 }
    );
  }
}