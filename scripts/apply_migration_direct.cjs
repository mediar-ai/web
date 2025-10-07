#!/usr/bin/env node

/**
 * Apply Migration Directly via Postgres Connection
 * This script connects directly to Supabase Postgres and executes the migration
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  console.log('🔧 Starting migration application via direct Postgres connection...\n');

  // Load environment variables
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL must be set');
    process.exit(1);
  }

  // Extract project ref from URL (e.g., https://eshwntsgsputksqamckh.supabase.co)
  const projectRef = supabaseUrl.split('//')[1].split('.')[0];
  console.log(`📡 Project: ${projectRef}`);

  // Construct database connection string
  // Format: postgres://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
  const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD;

  if (!dbPassword) {
    console.error('❌ Error: SUPABASE_DB_PASSWORD or DATABASE_PASSWORD must be set');
    console.log('💡 Tip: Get it from Supabase Dashboard > Settings > Database > Connection String');
    process.exit(1);
  }

  const connectionString = `postgres://postgres:${dbPassword}@db.${projectRef}.supabase.co:5432/postgres`;

  console.log(`🔗 Connecting to database...`);

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Test connection
    const testResult = await pool.query('SELECT NOW()');
    console.log(`✅ Connected successfully at ${testResult.rows[0].now}\n`);

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20250210000000_add_get_workflow_version_history.sql');

    console.log(`📄 Reading migration: ${path.basename(migrationPath)}`);

    if (!fs.existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📝 Migration loaded (${migrationSql.length} characters)\n`);

    // Split into individual function definitions
    const parts = migrationSql.split('CREATE OR REPLACE FUNCTION');
    const functions = [];

    for (let i = 1; i < parts.length; i++) {
      const funcSql = 'CREATE OR REPLACE FUNCTION' + parts[i];
      // Remove comments at the end
      const cleanSql = funcSql.split('COMMENT ON FUNCTION')[0].trim();
      if (cleanSql) {
        functions.push(cleanSql);
      }
    }

    console.log(`📊 Found ${functions.length} functions to create\n`);

    // Execute each function
    for (let i = 0; i < functions.length; i++) {
      const sql = functions[i];
      const funcName = sql.match(/FUNCTION\s+(\w+)/)?.[1] || `function_${i + 1}`;

      console.log(`📌 Creating ${funcName}...`);

      try {
        await pool.query(sql);
        console.log(`✅ ${funcName} created successfully\n`);
      } catch (error) {
        console.error(`❌ Error creating ${funcName}:`);
        console.error(error.message);
        console.error('\nSQL Preview:');
        console.error(sql.substring(0, 200) + '...\n');
        throw error;
      }
    }

    // Verify functions exist
    console.log('🔍 Verifying functions...');

    const { rows } = await pool.query(`
      SELECT routine_name, routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN ('get_workflow_version_history', 'activate_workflow_version')
      ORDER BY routine_name
    `);

    console.log(`\n✅ Functions verified:`);
    rows.forEach(row => {
      console.log(`   - ${row.routine_name} (${row.routine_type})`);
    });

    console.log('\n🎉 Migration applied successfully!');
    console.log('\n📊 Summary:');
    console.log('   - get_workflow_version_history() function created');
    console.log('   - activate_workflow_version() function created');
    console.log('\n✨ You can now:');
    console.log('   1. View execution counts per version in the Versions tab');
    console.log('   2. Activate versions and cron will use the correct version');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('\n👋 Connection closed');
  }
}

// Run the migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
