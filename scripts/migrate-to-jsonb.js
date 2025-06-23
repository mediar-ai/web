import { createClient } from '@supabase/supabase-js';

// Configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Migrate existing analyses from individual columns to JSONB format
 */
async function migrateToJSONB() {
  console.log('Starting migration to JSONB format...');
  
  try {
    // Fetch all analyses that don't have JSONB data yet
    const { data: analyses, error: fetchError } = await supabase
      .from('low_level_workflow_analyses')
      .select('*')
      .is('llm_structured_output', null)
      .not('workflow', 'is', null);

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${analyses.length} analyses to migrate`);

    let migratedCount = 0;
    let errorCount = 0;

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < analyses.length; i += batchSize) {
      const batch = analyses.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(analyses.length / batchSize)}`);

      const updates = batch.map(analysis => ({
        id: analysis.id,
        llm_structured_output: {
          workflow: analysis.workflow || 'Not available in data',
          step: analysis.step || 'Not available in data',
          description: analysis.description || 'Not available in data',
          facts: analysis.facts || 'Not available in data',
          logic: analysis.logic || 'Not available in data',
          tech: analysis.tech || 'Not available in data',
          apps: analysis.apps || 'Not available in data',
          context: analysis.context || 'Not available in data',
          schema_version: 'v1_legacy',
          migration_timestamp: new Date().toISOString(),
        }
      }));

      // Update each record in the batch
      for (const update of updates) {
        try {
          const { error: updateError } = await supabase
            .from('low_level_workflow_analyses')
            .update({ llm_structured_output: update.llm_structured_output })
            .eq('id', update.id);

          if (updateError) {
            console.error(`Error updating record ${update.id}:`, updateError);
            errorCount++;
          } else {
            migratedCount++;
          }
        } catch (err) {
          console.error(`Exception updating record ${update.id}:`, err);
          errorCount++;
        }
      }

      // Add small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Migration completed:`);
    console.log(`  Successfully migrated: ${migratedCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Total processed: ${migratedCount + errorCount}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

/**
 * Verify migration results
 */
async function verifyMigration() {
  console.log('\nVerifying migration results...');
  
  try {
    // Count total analyses
    const { count: totalCount, error: totalError } = await supabase
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;

    // Count analyses with JSONB data
    const { count: jsonbCount, error: jsonbError } = await supabase
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true })
      .not('llm_structured_output', 'is', null);

    if (jsonbError) throw jsonbError;

    // Count legacy-only analyses
    const { count: legacyCount, error: legacyError } = await supabase
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true })
      .is('llm_structured_output', null)
      .not('workflow', 'is', null);

    if (legacyError) throw legacyError;

    console.log(`Verification results:`);
    console.log(`  Total analyses: ${totalCount}`);
    console.log(`  With JSONB data: ${jsonbCount}`);
    console.log(`  Legacy-only remaining: ${legacyCount}`);
    console.log(`  Migration coverage: ${((jsonbCount / totalCount) * 100).toFixed(1)}%`);

    // Sample a few migrated records to verify structure
    const { data: samples, error: sampleError } = await supabase
      .from('low_level_workflow_analyses')
      .select('id, workflow, llm_structured_output')
      .not('llm_structured_output', 'is', null)
      .limit(3);

    if (sampleError) throw sampleError;

    console.log(`\nSample migrated records:`);
    samples.forEach((sample, index) => {
      console.log(`  ${index + 1}. ID: ${sample.id}`);
      console.log(`     Legacy workflow: ${sample.workflow}`);
      console.log(`     JSONB workflow: ${sample.llm_structured_output?.workflow}`);
      console.log(`     Schema version: ${sample.llm_structured_output?.schema_version}`);
    });

  } catch (error) {
    console.error('Verification failed:', error);
  }
}

/**
 * Create indexes for better performance (if they don't exist)
 */
async function createIndexes() {
  console.log('\nCreating performance indexes...');
  
  const indexQueries = [
    `CREATE INDEX IF NOT EXISTS idx_llm_structured_output_gin ON low_level_workflow_analyses USING GIN (llm_structured_output);`,
    `CREATE INDEX IF NOT EXISTS idx_llm_structured_output_workflow ON low_level_workflow_analyses USING GIN ((llm_structured_output->>'workflow'));`,
    `CREATE INDEX IF NOT EXISTS idx_llm_structured_output_step ON low_level_workflow_analyses USING GIN ((llm_structured_output->>'step'));`,
    `CREATE INDEX IF NOT EXISTS idx_llm_structured_output_schema_version ON low_level_workflow_analyses USING GIN ((llm_structured_output->>'schema_version'));`
  ];

  for (const query of indexQueries) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: query });
      if (error) {
        console.warn(`Index creation warning: ${error.message}`);
      }
    } catch (err) {
      console.warn(`Index creation failed (may already exist): ${err.message}`);
    }
  }
  
  console.log('Index creation completed');
}

/**
 * Main execution
 */
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      await migrateToJSONB();
      await verifyMigration();
      break;
    case 'verify':
      await verifyMigration();
      break;
    case 'indexes':
      await createIndexes();
      break;
    case 'all':
      await migrateToJSONB();
      await verifyMigration();
      await createIndexes();
      break;
    default:
      console.log('Usage: node migrate-to-jsonb.js [migrate|verify|indexes|all]');
      console.log('');
      console.log('Commands:');
      console.log('  migrate  - Migrate existing data to JSONB format');
      console.log('  verify   - Verify migration results');
      console.log('  indexes  - Create performance indexes');
      console.log('  all      - Run migration, verification, and index creation');
      process.exit(1);
  }
}

// Run the script
main().catch(console.error); 