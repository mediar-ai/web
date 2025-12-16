import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';
import { sendTransactionalEmail } from '@/lib/loops';
import { getPostHogClient } from '@/lib/posthog-server';

interface SurveyFormData {
  fullName: string;
  whatsappNumber: string;
  agreesToProvideFeedback: 'Yes' | 'No' | '';
  agreesToRaiseIssues: 'Yes' | 'No' | '';
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const user = await currentUser();
    const userEmail = user?.emailAddresses?.[0]?.emailAddress;

    if (!userEmail) {
      return NextResponse.json(
        { error: 'no email found for user' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { submissionId, formData } = body as {
      submissionId: string;
      formData: SurveyFormData;
    };

    if (!submissionId || !formData) {
      return NextResponse.json(
        { error: 'missing required fields' },
        { status: 400 }
      );
    }

    // Validate all required fields are 'Yes' for yes/no questions
    const yesNoFields = [
      'agreesToProvideFeedback',
      'agreesToRaiseIssues',
    ] as const;

    for (const field of yesNoFields) {
      if (formData[field] !== 'Yes') {
        return NextResponse.json(
          { error: `Invalid answer for ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate text fields are not empty
    if (!formData.fullName?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    if (!formData.whatsappNumber?.trim()) {
      return NextResponse.json(
        { error: 'WhatsApp number is required' },
        { status: 400 }
      );
    }

    console.log('free-eligibility: processing submission', {
      userId,
      userEmail,
      submissionId,
    });

    const supabase = createServerClient();

    // Insert into purchased table (same as stripe webhook does)
    const { error: insertError } = await supabase
      .from('mediar_app_credits_purchase')
      .insert({
        user_id: userId,
        email: userEmail,
        price: 0, // Free access
        purchase_token: submissionId,
        paid_at: new Date().toISOString(),
        stripe_session_id: `free_eligibility_${submissionId}`,
        stripe_payment_intent: null,
      });

    if (insertError) {
      console.error('free-eligibility: failed to insert purchase record', insertError);
      return NextResponse.json(
        { error: 'failed to grant access' },
        { status: 500 }
      );
    }

    console.log('free-eligibility: purchase record created', { submissionId });

    // Format survey results for email
    const surveyResultsHtml = `
<h2>Free Trial Submission</h2>
<p><strong>User ID:</strong> ${userId}</p>
<p><strong>User Email:</strong> ${userEmail}</p>
<p><strong>Submission ID:</strong> ${submissionId}</p>
<p><strong>Submitted at:</strong> ${new Date().toISOString()}</p>

<hr>

<h3>Survey Responses:</h3>
<ul>
  <li><strong>Name:</strong> ${formData.fullName}</li>
  <li><strong>WhatsApp:</strong> ${formData.whatsappNumber}</li>
  <li><strong>Agrees to provide feedback:</strong> ${formData.agreesToProvideFeedback}</li>
  <li><strong>Agrees to raise issues:</strong> ${formData.agreesToRaiseIssues}</li>
</ul>
    `.trim();

    // Send email notification to matt@mediar.ai
    const emailResult = await sendTransactionalEmail({
      to: 'matt@mediar.ai',
      subject: `Free Access Survey: ${userEmail}`,
      body: surveyResultsHtml,
      replyTo: userEmail,
      senderName: 'Mediar Free Access',
    });

    if (!emailResult.success) {
      console.error('free-eligibility: failed to send email notification', emailResult.error);
      // Don't fail the request - the user still got access
    } else {
      console.log('free-eligibility: email notification sent');
    }

    // Track in PostHog
    try {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: 'free_eligibility_granted',
        properties: {
          user_id: userId,
          email: userEmail,
          submission_id: submissionId,
          full_name: formData.fullName,
          whatsapp: formData.whatsappNumber,
        },
      });
      await posthog.flush();
    } catch (posthogErr) {
      console.error('free-eligibility: posthog tracking error', posthogErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Free access granted',
    });
  } catch (error) {
    console.error('free-eligibility: error', error);
    return NextResponse.json(
      { error: 'internal server error' },
      { status: 500 }
    );
  }
}
