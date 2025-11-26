import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    // If token provided, validate it belongs to this user
    if (token) {
      const { data: tokenData, error: tokenError } = await supabase
        .from('mediar_app_credits_purchase')
        .select('id, price, paid_at')
        .eq('purchase_token', token)
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (tokenError && tokenError.code !== 'PGRST116') {
        console.error('purchase-status: token validation error', tokenError);
      }

      if (tokenData) {
        return NextResponse.json({
          hasPurchased: true,
          purchase: tokenData,
        });
      }
    }

    // Fall back to checking by user_id
    const { data, error } = await supabase
      .from('mediar_app_credits_purchase')
      .select('id, price, paid_at')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('purchase-status: error', error);
      return NextResponse.json(
        { error: 'failed to check purchase status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      hasPurchased: !!data,
      purchase: data || null,
    });
  } catch (error) {
    console.error('purchase-status: error', error);
    return NextResponse.json(
      { error: 'failed to check purchase status' },
      { status: 500 }
    );
  }
}
