// Cleanup script to list and delete all Daytona sandboxes
import { Daytona } from '@daytonaio/sdk';

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  target: 'us',
});

async function main() {
  console.log('Listing all sandboxes...');

  try {
    const result = await daytona.list();

    // result.items contains sandbox objects with .id property
    const sandboxes = result?.items || [];
    console.log(`Found ${sandboxes.length} sandboxes`);

    for (const sb of sandboxes) {
      console.log(`  - ${sb.id} (${sb.state})`);
    }

    if (sandboxes.length === 0) {
      console.log('No sandboxes to delete.');
      return;
    }

    console.log('\nDeleting all sandboxes...');

    for (const sandbox of sandboxes) {
      const sandboxId = sandbox.id;
      try {
        console.log(`  Deleting ${sandboxId}...`);
        // The sandbox object from list() has a delete method
        await sandbox.delete();
        console.log(`  ✓ Deleted ${sandboxId}`);
      } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
      }
    }

    console.log('\nDone! Waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));

    // Verify cleanup
    const afterResult = await daytona.list();
    console.log(`Remaining sandboxes: ${afterResult?.items?.length || 0}`);

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

main();
