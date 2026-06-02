import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';
import { requireMediarAdmin } from '@/lib/auth/requireMediarAdmin';

const clickhouse = createClient({
  url: process.env.NEXT_PUBLIC_CLICKHOUSE_URL || 'https://g2g4mz36xc.us-east-1.aws.clickhouse.cloud:8443',
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USERNAME || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE || 'default'
});

export async function GET() {
  try {
    const denied = await requireMediarAdmin();
    if (denied) return denied;

    // Add health_details column if it doesn't exist
    const query = `
      ALTER TABLE remote_machines
      ADD COLUMN IF NOT EXISTS health_details String DEFAULT ''
    `;

    await clickhouse.command({ query });

    return NextResponse.json({
      success: true,
      message: 'health_details column added successfully'
    });
  } catch (error: any) {
    console.error('Error adding health_details column:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to add column'
      },
      { status: 500 }
    );
  }
}