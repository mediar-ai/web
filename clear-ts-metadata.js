const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearCache() {
  const { data, error } = await supabase
    .from('deployed_workflows')
    .update({ typescript_metadata: null })
    .eq('id', '238')
    .select();

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('✅ Cleared cached TypeScript metadata for workflow 238');
  console.log('Next page load will re-parse with the new parser');
}

clearCache();
