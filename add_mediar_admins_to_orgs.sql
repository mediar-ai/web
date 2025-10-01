-- SQL to add louis@mediar.ai and matt@mediar.ai to all existing organizations
-- This uses the Clerk API via a server-side script since Clerk manages org memberships

-- First, let's get all organization IDs from your database
-- Assuming you have an organizations table with clerk_organization_id

SELECT
  id,
  name,
  clerk_organization_id
FROM organizations
ORDER BY created_at DESC;

-- NOTE: Since Clerk manages organization memberships, you cannot directly insert into Clerk's database.
-- You need to use the Clerk Admin API or Dashboard to invite users to organizations.

-- OPTION 1: Use Clerk Dashboard (Manual)
-- 1. Go to https://dashboard.clerk.com
-- 2. Navigate to each organization
-- 3. Click "Members" -> "Invite"
-- 4. Add louis@mediar.ai and matt@mediar.ai as org:admin

-- OPTION 2: Use the API script below (Recommended)
-- Save this as a Node.js script and run it:

/*
// add-admins-to-all-orgs.ts
import { createClerkClient } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const MEDIAR_ADMINS = ['louis@mediar.ai', 'matt@mediar.ai'];

async function addAdminsToAllOrgs() {
  // Get all organizations
  const orgs = await clerkClient.organizations.getOrganizationList();

  console.log(`Found ${orgs.data.length} organizations`);

  for (const org of orgs.data) {
    console.log(`\nProcessing: ${org.name} (${org.id})`);

    // Get existing members
    const members = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId: org.id,
    });

    const existingEmails = members.data.map(m => m.publicUserData?.identifier).filter(Boolean);

    for (const email of MEDIAR_ADMINS) {
      if (existingEmails.includes(email)) {
        console.log(`  ✓ ${email} already a member`);
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
          console.log(`  ✓ Added ${email} as member`);
        } else {
          // User doesn't exist, send invitation
          await clerkClient.organizations.createOrganizationInvitation({
            organizationId: org.id,
            emailAddress: email,
            role: 'org:admin',
          });
          console.log(`  ✓ Sent invitation to ${email}`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to add ${email}:`, error);
      }
    }
  }

  console.log('\n✅ Done!');
}

addAdminsToAllOrgs().catch(console.error);
*/

-- To run the script:
-- 1. Save the commented code above to: add-admins-to-all-orgs.ts
-- 2. Make sure you have @clerk/backend installed: npm install @clerk/backend
-- 3. Run: npx tsx add-admins-to-all-orgs.ts
