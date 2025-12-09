import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Admin endpoint to apply database migrations
 * POST /api/admin/run-migration
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { migration_file } = body;

    if (!migration_file) {
      return NextResponse.json(
        { success: false, error: 'migration_file parameter required' },
        { status: 400 }
      );
    }

    console.log(`🔧 Applying migration: ${migration_file}`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not set');
    }

    // Read migration file
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migration_file);

    if (!fs.existsSync(migrationPath)) {
      return NextResponse.json(
        { success: false, error: `Migration file not found: ${migration_file}` },
        { status: 404 }
      );
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`📝 Migration loaded (${migrationSql.length} characters)`);

    // Split into individual statements (separated by semicolons outside of function bodies)
    // For function definitions, we need to execute each CREATE OR REPLACE FUNCTION separately
    const functionDefinitions = [];
    const parts = migrationSql.split('CREATE OR REPLACE FUNCTION');

    for (let i = 1; i < parts.length; i++) {
      functionDefinitions.push('CREATE OR REPLACE FUNCTION' + parts[i]);
    }

    console.log(`📊 Found ${functionDefinitions.length} function definitions`);

    const results = [];

    // Use postgres connection for raw SQL execution
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || `${supabaseUrl.replace('https://', 'postgres://postgres:')}@${supabaseUrl.split('//')[1].split('.')[0]}.supabase.co:5432/postgres`,
      ssl: { rejectUnauthorized: false }
    });

    try {
      for (let i = 0; i < functionDefinitions.length; i++) {
        const sql = functionDefinitions[i].trim();
        if (!sql) continue;

        console.log(`\n📌 Executing function ${i + 1}/${functionDefinitions.length}...`);

        try {
          const result = await pool.query(sql);
          console.log(`✅ Function ${i + 1} created successfully (command: ${result.command}, rows: ${result.rowCount})`);
          results.push({
            index: i + 1,
            success: true,
            sql: sql.substring(0, 100) + '...'
          });
        } catch (error) {
          console.error(`❌ Error executing function ${i + 1}:`, error);
          results.push({
            index: i + 1,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            sql: sql.substring(0, 100) + '...'
          });
        }
      }
    } finally {
      await pool.end();
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`\n📊 Migration complete: ${successCount} succeeded, ${failCount} failed`);

    return NextResponse.json({
      success: failCount === 0,
      message: `Migration ${migration_file} applied`,
      results: {
        total: results.length,
        succeeded: successCount,
        failed: failCount,
        details: results
      }
    });

  } catch (error) {
    console.error('❌ Migration error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to apply migration',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
