import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret, validateSecretName } from '@/lib/crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * PATCH /api/secrets/[id] - Update secret
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, value, description } = body;

    // Verify secret belongs to user's org
    const { data: existingSecret, error: fetchError } = await supabase
      .from('org_secrets')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !existingSecret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, any> = {};

    if (name !== undefined) {
      if (!validateSecretName(name)) {
        return NextResponse.json(
          { error: 'Secret name must be uppercase alphanumeric with underscores (e.g., GITHUB_TOKEN)' },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (value !== undefined) {
      updates.encrypted_value = await encryptSecret(value);
    }

    if (description !== undefined) {
      updates.description = description;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Update secret
    const { data, error } = await supabase
      .from('org_secrets')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, name, description, created_at, updated_at, created_by')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Secret with this name already exists' },
          { status: 409 }
        );
      }
      console.error('Error updating secret:', error);
      return NextResponse.json(
        { error: 'Failed to update secret' },
        { status: 500 }
      );
    }

    return NextResponse.json({ secret: data });
  } catch (error) {
    console.error('Error in PATCH /api/secrets/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/secrets/[id] - Delete secret
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Delete secret (RLS ensures it belongs to user's org)
    const { error } = await supabase
      .from('org_secrets')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) {
      console.error('Error deleting secret:', error);
      return NextResponse.json(
        { error: 'Failed to delete secret' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/secrets/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
