import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';
import { sendTransactionalEmail } from '@/lib/loops';
import { getPostHogClient } from '@/lib/posthog-server';

const FREE_CREDITS_AMOUNT = 15; // Credits granted for open source contributors (15 min workflow time)

interface SurveyFormData {
  isOpenSourceContributor: 'Yes' | 'No' | '';
  githubHandle: string;
  isWorkingOnBounty: 'Yes' | 'No' | '';
  bountyLink: string;
  needsWorkflowsForOthers: 'Yes' | 'No' | '';
  whatsappNumber: string;
  agreesToProvideFeedback: 'Yes' | 'No' | '';
  agreesToRaiseIssues: 'Yes' | 'No' | '';
  agreesToReportMissingFeatures: 'Yes' | 'No' | '';
  agreesToReportImprovements: 'Yes' | 'No' | '';
  agreesToTestNewFeatures: 'Yes' | 'No' | '';
  fullName: string;
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
      'isOpenSourceContributor',
      'isWorkingOnBounty',
      'needsWorkflowsForOthers',
      'agreesToProvideFeedback',
      'agreesToRaiseIssues',
      'agreesToReportMissingFeatures',
      'agreesToReportImprovements',
      'agreesToTestNewFeatures',
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
    if (!formData.githubHandle?.trim()) {
      return NextResponse.json(
        { error: 'GitHub handle is required' },
        { status: 400 }
      );
    }
    if (!formData.bountyLink?.trim()) {
      return NextResponse.json(
        { error: 'Bounty link is required' },
        { status: 400 }
      );
    }
    if (!formData.whatsappNumber?.trim()) {
      return NextResponse.json(
        { error: 'WhatsApp number is required' },
        { status: 400 }
      );
    }
    if (!formData.fullName?.trim()) {
      return NextResponse.json(
        { error: 'Full name is required' },
        { status: 400 }
      );
    }

    console.log('credits/free-eligibility: processing submission', {
      userId,
      userEmail,
      submissionId,
    });

    const supabase = createServerClient();

    // Check if user already received free credits
    const { data: existingCredits } = await supabase
      .from('credit_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'free_oss')
      .limit(1)
      .single();

    if (existingCredits) {
      return NextResponse.json(
        { error: 'You have already received free credits for open source contribution' },
        { status: 400 }
      );
    }

    // Add credits using RPC function
    const { data: creditResult, error: creditError } = await supabase.rpc('add_credits', {
      p_user_id: userId,
      p_amount: FREE_CREDITS_AMOUNT,
      p_type: 'free_oss',
      p_description: `Free credits for open source contributor (${formData.githubHandle})`,
      p_reference_id: `free_oss_${submissionId}`,
    });

    if (creditError) {
      console.error('credits/free-eligibility: failed to add credits', creditError);
      return NextResponse.json(
        { error: 'failed to grant credits' },
        { status: 500 }
      );
    }

    console.log('credits/free-eligibility: credits granted', {
      submissionId,
      amount: FREE_CREDITS_AMOUNT,
      newBalance: creditResult?.[0]?.new_balance,
    });

    // Format survey results for email
    const surveyResultsHtml = `
<h2>Free Credits Survey Submission</h2>
<p><strong>User ID:</strong> ${userId}</p>
<p><strong>User Email:</strong> ${userEmail}</p>
<p><strong>Full Name:</strong> ${formData.fullName}</p>
<p><strong>Submission ID:</strong> ${submissionId}</p>
<p><strong>Credits Granted:</strong> ${FREE_CREDITS_AMOUNT}</p>
<p><strong>Submitted at:</strong> ${new Date().toISOString()}</p>

<hr>

<h3>Survey Responses:</h3>
<ul>
  <li><strong>Open source contributor:</strong> ${formData.isOpenSourceContributor}</li>
  <li><strong>GitHub handle:</strong> ${formData.githubHandle}</li>
  <li><strong>Working on bounty:</strong> ${formData.isWorkingOnBounty}</li>
  <li><strong>Bounty link:</strong> ${formData.bountyLink}</li>
  <li><strong>Needs workflows for others:</strong> ${formData.needsWorkflowsForOthers}</li>
  <li><strong>WhatsApp:</strong> ${formData.whatsappNumber}</li>
  <li><strong>Agrees to provide feedback:</strong> ${formData.agreesToProvideFeedback}</li>
  <li><strong>Agrees to raise issues:</strong> ${formData.agreesToRaiseIssues}</li>
  <li><strong>Agrees to report missing features:</strong> ${formData.agreesToReportMissingFeatures}</li>
  <li><strong>Agrees to suggest improvements:</strong> ${formData.agreesToReportImprovements}</li>
  <li><strong>Agrees to test new features:</strong> ${formData.agreesToTestNewFeatures}</li>
</ul>
    `.trim();

    // Send email notification to matt@mediar.ai
    const emailResult = await sendTransactionalEmail({
      to: 'matt@mediar.ai',
      subject: `Free Credits Survey: ${userEmail} (${formData.fullName})`,
      body: surveyResultsHtml,
      replyTo: userEmail,
      senderName: 'Mediar Free Credits',
    });

    if (!emailResult.success) {
      console.error('credits/free-eligibility: failed to send email notification', emailResult.error);
      // Don't fail the request - the user still got credits
    } else {
      console.log('credits/free-eligibility: email notification sent');
    }

    // Track in PostHog
    try {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: 'free_credits_granted',
        properties: {
          user_id: userId,
          email: userEmail,
          full_name: formData.fullName,
          submission_id: submissionId,
          github_handle: formData.githubHandle,
          bounty_link: formData.bountyLink,
          whatsapp: formData.whatsappNumber,
          credits_amount: FREE_CREDITS_AMOUNT,
        },
      });
      await posthog.flush();
    } catch (posthogErr) {
      console.error('credits/free-eligibility: posthog tracking error', posthogErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Free credits granted',
      creditsGranted: FREE_CREDITS_AMOUNT,
      newBalance: creditResult?.[0]?.new_balance,
    });
  } catch (error) {
    console.error('credits/free-eligibility: error', error);
    return NextResponse.json(
      { error: 'internal server error' },
      { status: 500 }
    );
  }
}
