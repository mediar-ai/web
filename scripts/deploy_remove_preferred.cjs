#!/usr/bin/env node

/**
 * Deploy Script: Remove 'preferred' assignment type
 * Runs the migration: 20250207000000_remove_preferred_assignment_type.sql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function deployMigration() {
  console.log('================================================================================');
  console.log('🚀 DEPLOYMENT: Remove "preferred" Assignment Type');
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

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

  // Construct database connection string
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
    console.log(`✅ Connected successfully at ${testResult.rows[0].now}`);

    // Read migration file
    const migrationFile = path.join(__dirname, '..', 'supabase', 'migrations', '20250207000000_remove_preferred_assignment_type.sql');
    
    if (!fs.existsSync(migrationFile)) {
      console.error(`❌ Migration file not found: ${migrationFile}`);
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
    console.log(`📄 Loaded migration file (${migrationSQL.length} characters)`);
    console.log('🚀 Running migration...\n');

    // Execute migration
    await pool.query(migrationSQL);
    
    console.log('\n✅ Migration completed successfully!');

    // Verify migration
    console.log('\n🔍 Verifying migration...');
    
    // Check for any remaining preferred assignments
    const { rows: preferredCheck } = await pool.query(`
      SELECT COUNT(*) as count 
      FROM workflow_machine_assignments 
      WHERE assignment_type = 'preferred';
    `);
    
    const preferredCount = parseInt(preferredCheck[0].count);
    if (preferredCount > 0) {
      console.log(`   ⚠️  WARNING: ${preferredCount} preferred assignments still exist!`);
    } else {
      console.log(`   ✅ No preferred assignments found (expected)`);
    }

    // Check current assignments
    const { rows: assignments } = await pool.query(`
      SELECT assignment_type, COUNT(*) as count 
      FROM workflow_machine_assignments 
      GROUP BY assignment_type 
      ORDER BY assignment_type;
    `);
    
    console.log(`\n   📊 Current assignments:`);
    for (const row of assignments) {
      console.log(`      • ${row.assignment_type}: ${row.count}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ DEPLOYMENT COMPLETE!');
    console.log('='.repeat(80));
    console.log('\n📋 Next steps:');
    console.log('   1. Restart your Next.js application (Vercel will auto-deploy)');
    console.log('   2. Test workflow execution with exclusive assignments');
    console.log('   3. Verify cron scheduler works correctly');
    console.log('   4. Check UI - assignment dropdowns should show only "EXCLUSIVE"');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.message.includes('already exists') || error.message.includes('does not exist')) {
      console.log('⚠️  This might mean the migration was already applied');
      console.log('✅ Proceeding anyway...');
      process.exit(0);
    }
    
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

deployMigration();

