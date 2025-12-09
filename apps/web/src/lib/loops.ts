"use server";

const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
const LOOPS_NEWSLETTER_FORM_ID = "clkotuj73009emj0nyov824h1";
const LOOPS_TRANSACTIONAL_ID = "cma8lnpvba4zgzstitn3kgrrf";

/**
 * Add a user to Loops newsletter and optionally send a welcome email
 */
export async function addToLoops(
  email: string,
  userGroup: string,
  options?: {
    sendWelcomeEmail?: boolean;
    firstName?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { sendWelcomeEmail = true, firstName } = options || {};

  if (!LOOPS_API_KEY) {
    console.error("[Loops] LOOPS_API_KEY is not set");
    return { success: false, error: "LOOPS_API_KEY not configured" };
  }

  try {
    // 1. Subscribe to newsletter
    console.log(`[Loops] Subscribing ${email} to newsletter with userGroup: ${userGroup}`);

    const subscribeResponse = await fetch(
      `https://app.loops.so/api/newsletter-form/${LOOPS_NEWSLETTER_FORM_ID}`,
      {
        method: "POST",
        body: `userGroup=${encodeURIComponent(userGroup)}&email=${encodeURIComponent(email)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (!subscribeResponse.ok) {
      const status = subscribeResponse.status;
      console.error(`[Loops] Newsletter subscription failed with status: ${status}`);

      if (status === 429) {
        return { success: false, error: "Rate limit exceeded" };
      } else if (status === 400) {
        // User might already be subscribed - this is OK
        console.log(`[Loops] User ${email} may already be subscribed (400 response)`);
      } else {
        return { success: false, error: `Newsletter subscription failed (${status})` };
      }
    } else {
      console.log(`[Loops] Successfully subscribed ${email} to newsletter`);
    }

    // 2. Send welcome email if requested
    if (sendWelcomeEmail) {
      console.log(`[Loops] Sending welcome email to ${email}`);

      const greeting = firstName ? `Hey ${firstName}` : "Hey";

      const emailResponse = await fetch("https://app.loops.so/api/v1/transactional", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOOPS_API_KEY}`,
        },
        body: JSON.stringify({
          transactionalId: LOOPS_TRANSACTIONAL_ID,
          email,
          dataVariables: {
            subject: "Did it work for you?",
            email_preview: "Quick question from the founder",
            body: `${greeting}, founder here - Matt. I saw you signed up for the app, did it work for you?`,
            sender_name: "Matt from Mediar",
            reply_to: "matt@mediar.ai",
          },
        }),
      });

      if (!emailResponse.ok) {
        const status = emailResponse.status;
        console.error(`[Loops] Welcome email failed with status: ${status}`);
        return { success: false, error: `Welcome email failed (${status})` };
      }

      console.log(`[Loops] Successfully sent welcome email to ${email}`);
    }

    return { success: true };
  } catch (error) {
    console.error("[Loops] Error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send a transactional email with custom content
 */
export async function sendTransactionalEmail(options: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  senderName?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { to, subject, body, replyTo = "matt@mediar.ai", senderName = "Mediar" } = options;

  if (!LOOPS_API_KEY) {
    console.error("[Loops] LOOPS_API_KEY is not set");
    return { success: false, error: "LOOPS_API_KEY not configured" };
  }

  try {
    console.log(`[Loops] Sending transactional email to ${to}`);

    const emailResponse = await fetch("https://app.loops.so/api/v1/transactional", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOOPS_API_KEY}`,
      },
      body: JSON.stringify({
        transactionalId: LOOPS_TRANSACTIONAL_ID,
        email: to,
        dataVariables: {
          subject,
          email_preview: subject,
          body,
          sender_name: senderName,
          reply_to: replyTo,
        },
      }),
    });

    if (!emailResponse.ok) {
      const status = emailResponse.status;
      console.error(`[Loops] Transactional email failed with status: ${status}`);
      return { success: false, error: `Email failed (${status})` };
    }

    console.log(`[Loops] Successfully sent transactional email to ${to}`);
    return { success: true };
  } catch (error) {
    console.error("[Loops] Transactional email error:", error);
    return { success: false, error: String(error) };
  }
}
