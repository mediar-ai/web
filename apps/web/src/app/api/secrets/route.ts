import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret, validateSecretName } from '@/lib/crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * GET /api/secrets - List all secrets for user's org (values masked)
 */
export async function GET() {
  const supabase = getSupabaseAdmin();
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch secrets for this org
    const { data: secrets, error } = await supabase
      .from('org_secrets')
      .select('id, name, description, created_at, updated_at, created_by')
      .eq('org_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching secrets:', error);
      return NextResponse.json(
        { error: 'Failed to fetch secrets' },
        { status: 500 }
      );
    }

    return NextResponse.json({ secrets: secrets || [] });
  } catch (error) {
    console.error('Error in GET /api/secrets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/secrets - Create new secret
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, value, description } = body;

    if (!name || !value) {
      return NextResponse.json(
        { error: 'Name and value are required' },
        { status: 400 }
      );
    }

    // Validate secret name format
    if (!validateSecretName(name)) {
      return NextResponse.json(
        { error: 'Secret name must be uppercase alphanumeric with underscores (e.g., GITHUB_TOKEN)' },
        { status: 400 }
      );
    }

    // Encrypt the secret value
    let encryptedValue: string;
    try {
      encryptedValue = await encryptSecret(value);
    } catch (encryptError: any) {
      console.error('Encryption error:', encryptError);
      return NextResponse.json(
        { error: encryptError.message || 'Failed to encrypt secret. Check SECRETS_ENCRYPTION_KEY is set.' },
        { status: 500 }
      );
    }

    // Insert into database
    const { data, error } = await supabase
      .from('org_secrets')
      .insert({
        org_id: orgId,
        name,
        description: description || null,
        encrypted_value: encryptedValue,
        created_by: userId,
      })
      .select('id, name, description, created_at, updated_at, created_by')
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return NextResponse.json(
          { error: 'Secret with this name already exists' },
          { status: 409 }
        );
      }
      console.error('Error creating secret:', error);
      return NextResponse.json(
        { error: 'Failed to create secret' },
        { status: 500 }
      );
    }

    return NextResponse.json({ secret: data }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/secrets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
