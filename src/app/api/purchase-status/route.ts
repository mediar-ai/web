import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('mediar_app_credits_purchase')
      .select('id, price, paid_at')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
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
