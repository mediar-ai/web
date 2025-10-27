#!/usr/bin/env node

/**
 * Apply workflow statistics fix migration
 * Fixes the column name issue in workflow_statistics_summary view
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  console.log('🔧 Applying workflow statistics fix migration...\n');

  // Load environment variables
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL must be set');
    process.exit(1);
  }

  // Extract project ref from URL
  const projectRef = supabaseUrl.split('//')[1].split('.')[0];
  console.log(`📡 Project: ${projectRef}`);

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
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261027000000_fix_workflow_statistics_column_name.sql');

    console.log(`📄 Reading migration: ${path.basename(migrationPath)}`);

    if (!fs.existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📝 Migration loaded (${migrationSql.length} characters)\n`);

    console.log(`📌 Applying migration...`);
    await pool.query(migrationSql);
    console.log(`✅ Migration applied successfully\n`);

    // Verify view exists
    console.log('🔍 Verifying view...');
    const { rows } = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'workflow_statistics_summary'
    `);

    if (rows.length > 0) {
      console.log(`\n✅ View verified: ${rows[0].table_name} (${rows[0].table_type})`);
    }

    console.log('\n🎉 Migration applied successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Fixed workflow_statistics_summary view to use correct column name');
    console.log('   - Changed workflow_version_number to version_number');
    console.log('   - Performance metrics should now display correctly');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
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
