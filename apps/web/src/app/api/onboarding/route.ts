import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';

const CREDIT_VALUES = {
  twitter: 2,
  github: 2,
  linkedin: 2,
  discord: 2,
  video: 2,
} as const;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('user_onboarding')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('onboarding: error fetching', error);
      return NextResponse.json({ error: 'failed to fetch onboarding state' }, { status: 500 });
    }

    // No onboarding record yet
    if (!data) {
      return NextResponse.json({
        onboarding: null,
        shouldShowOnboarding: true,
      });
    }

    // Check if onboarding is completed
    if (data.onboarding_completed_at) {
      return NextResponse.json({
        onboarding: data,
        shouldShowOnboarding: false,
      });
    }

    // Check if dismissed recently (within 3 days)
    if (data.dismissed_at) {
      const dismissedTime = new Date(data.dismissed_at).getTime();
      const now = Date.now();
      if (now - dismissedTime < THREE_DAYS_MS) {
        return NextResponse.json({
          onboarding: data,
          shouldShowOnboarding: false,
        });
      }
    }

    // Should show onboarding
    return NextResponse.json({
      onboarding: data,
      shouldShowOnboarding: true,
    });
  } catch (error) {
    console.error('onboarding GET: error', error);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, platform } = body;

    const supabase = createServerClient();

    // Get or create onboarding record
    const { data: existingOnboarding, error: fetchError } = await supabase
      .from('user_onboarding')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('onboarding: error fetching', fetchError);
      return NextResponse.json({ error: 'failed to fetch onboarding state' }, { status: 500 });
    }

    // Create record if doesn't exist
    let onboarding = existingOnboarding;
    if (!onboarding) {
      const { data: newRecord, error: insertError } = await supabase
        .from('user_onboarding')
        .insert({ user_id: userId })
        .select()
        .single();

      if (insertError) {
        console.error('onboarding: error creating', insertError);
        return NextResponse.json({ error: 'failed to create onboarding record' }, { status: 500 });
      }
      onboarding = newRecord;
    }

    const updates: Record<string, unknown> = {};
    let creditsToAdd = 0;

    switch (action) {
      case 'follow_social': {
        // Track social follow
        const platformKey = platform as keyof typeof CREDIT_VALUES;
        const columnMap: Record<string, string> = {
          twitter: 'followed_twitter',
          github: 'starred_github',
          linkedin: 'followed_linkedin',
          discord: 'joined_discord',
        };

        const column = columnMap[platformKey];
        if (!column) {
          return NextResponse.json({ error: 'invalid platform' }, { status: 400 });
        }

        // Only award credits if not already followed
        if (!onboarding[column]) {
          updates[column] = true;
          creditsToAdd = CREDIT_VALUES[platformKey];
        }
        break;
      }

      case 'watch_video':
        // Track video watch
        if (!onboarding.watched_video) {
          updates.watched_video = true;
          creditsToAdd = CREDIT_VALUES.video;
        }
        break;

      case 'invite_sent':
        // Track invite sent (just increment counter, no credits)
        updates.invites_sent = (onboarding.invites_sent || 0) + 1;
        break;

      case 'dismiss':
        // User clicked "Maybe later"
        updates.dismissed_at = new Date().toISOString();
        break;

      case 'complete':
        // User finished onboarding
        updates.onboarding_completed_at = new Date().toISOString();
        break;

      default:
        return NextResponse.json({ error: 'invalid action' }, { status: 400 });
    }

    // Add credits if earned
    if (creditsToAdd > 0) {
      updates.total_credits_earned = (onboarding.total_credits_earned || 0) + creditsToAdd;
    }

    // Update record
    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from('user_onboarding')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('onboarding: error updating', updateError);
        return NextResponse.json({ error: 'failed to update onboarding' }, { status: 500 });
      }

      // Also add credits to user_credits table for VM usage
      if (creditsToAdd > 0) {
        const actionDescription = action === 'watch_video'
          ? 'Watched onboarding video'
          : `Followed ${platform}`;

        try {
          const { error: creditError } = await supabase.rpc('add_credits', {
            p_user_id: userId,
            p_amount: creditsToAdd,
            p_type: 'onboarding',
            p_description: actionDescription,
            p_reference_id: `onboarding-${action}-${platform || 'video'}`,
          });
          if (creditError) {
            console.error('onboarding: failed to add credits to user_credits', creditError);
          }
        } catch (err) {
          // Don't fail the request if credits table doesn't exist yet
          console.error('onboarding: failed to add credits to user_credits', err);
        }
      }

      return NextResponse.json({
        onboarding: updated,
        creditsEarned: creditsToAdd,
      });
    }

    return NextResponse.json({
      onboarding,
      creditsEarned: 0,
    });
  } catch (error) {
    console.error('onboarding POST: error', error);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
