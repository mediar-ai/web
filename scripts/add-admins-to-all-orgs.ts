#!/usr/bin/env tsx
import { createClerkClient } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const MEDIAR_ADMINS = ['louis@mediar.ai', 'matt@mediar.ai'];

async function addAdminsToAllOrgs() {
  console.log('🔍 Fetching all organizations...\n');

  // Get all organizations
  const orgs = await clerkClient.organizations.getOrganizationList({ limit: 100 });

  console.log(`📋 Found ${orgs.data.length} organizations\n`);

  for (const org of orgs.data) {
    console.log(`\n🏢 Processing: ${org.name} (${org.id})`);

    // Get existing members
    const members = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId: org.id,
      limit: 100,
    });

    const existingEmails = members.data
      .map(m => m.publicUserData?.identifier)
      .filter(Boolean);

    console.log(`   Current members: ${members.data.length}`);

    for (const email of MEDIAR_ADMINS) {
      if (existingEmails.includes(email)) {
        console.log(`   ✓ ${email} already a member`);
        continue;
      }

      try {
        // Check if user exists in Clerk
        const users = await clerkClient.users.getUserList({ emailAddress: [email] });

        if (users.data.length > 0) {
          // User exists, add them directly
          await clerkClient.organizations.createOrganizationMembership({
            organizationId: org.id,
            userId: users.data[0].id,
            role: 'org:admin',
          });
          console.log(`   ✅ Added ${email} as admin`);
        } else {
          // User doesn't exist, send invitation
          await clerkClient.organizations.createOrganizationInvitation({
            organizationId: org.id,
            emailAddress: email,
            role: 'org:admin',
          });
          console.log(`   📧 Sent invitation to ${email}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`   ❌ Failed to add ${email}:`, error?.message || error);
      }
    }
  }

  console.log('\n\n✅ Done! Mediar admins have been added to all organizations.');
}

addAdminsToAllOrgs().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
