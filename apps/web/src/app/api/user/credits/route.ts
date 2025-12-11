import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * GET /api/user/credits
 * Get current user's credit balance and transaction history
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Get user's credit balance
    const { data: credits, error: creditsError } = await supabase
      .rpc('get_user_credits', { p_user_id: userId });

    if (creditsError) {
      console.error('[Credits API] Failed to get credits:', creditsError);
      // Return zeros if function doesn't exist yet (migration not run)
      return NextResponse.json({
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0,
        transactions: [],
      });
    }

    // Get recent transactions (last 50)
    const { data: transactions, error: txError } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (txError) {
      console.error('[Credits API] Failed to get transactions:', txError);
    }

    const creditData = credits?.[0] || { balance: 0, lifetime_earned: 0, lifetime_spent: 0 };

    return NextResponse.json({
      balance: creditData.balance || 0,
      lifetime_earned: creditData.lifetime_earned || 0,
      lifetime_spent: creditData.lifetime_spent || 0,
      transactions: transactions || [],
    });
  } catch (error) {
    console.error('[Credits API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get credits' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/credits
 * Add credits to user account (admin only or from webhook)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { amount, type, description, reference_id, target_user_id } = body;

    // Validate amount
    if (typeof amount !== 'number' || amount === 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    // For adding credits to other users, require internal API key
    const apiKey = req.headers.get('x-api-key');
    const internalKey = process.env.INTERNAL_API_KEY;

    const targetUserId = target_user_id || userId;

    // Only allow modifying own credits or with internal API key
    if (targetUserId !== userId && apiKey !== internalKey) {
      return NextResponse.json(
        { error: 'Cannot modify other users credits' },
        { status: 403 }
      );
    }

    const supabase = createServerClient();

    // Use the appropriate function based on whether we're adding or deducting
    if (amount > 0) {
      const { data, error } = await supabase.rpc('add_credits', {
        p_user_id: targetUserId,
        p_amount: amount,
        p_type: type || 'manual',
        p_description: description,
        p_reference_id: reference_id,
      });

      if (error) {
        console.error('[Credits API] Failed to add credits:', error);
        return NextResponse.json(
          { error: 'Failed to add credits' },
          { status: 500 }
        );
      }

      const result = data?.[0];
      return NextResponse.json({
        success: true,
        new_balance: result?.new_balance || 0,
        transaction_id: result?.transaction_id,
      });
    } else {
      const { data, error } = await supabase.rpc('deduct_credits', {
        p_user_id: targetUserId,
        p_amount: Math.abs(amount),
        p_type: type || 'manual',
        p_description: description,
        p_reference_id: reference_id,
      });

      if (error) {
        console.error('[Credits API] Failed to deduct credits:', error);
        return NextResponse.json(
          { error: 'Failed to deduct credits' },
          { status: 500 }
        );
      }

      const result = data?.[0];
      if (!result?.success) {
        return NextResponse.json(
          { error: result?.error_message || 'Insufficient credits' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        new_balance: result?.new_balance || 0,
        transaction_id: result?.transaction_id,
      });
    }
  } catch (error) {
    console.error('[Credits API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process credits' },
      { status: 500 }
    );
  }
}
