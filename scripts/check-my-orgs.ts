#!/usr/bin/env tsx
import { createClerkClient } from '@clerk/backend';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

if (!process.env.CLERK_SECRET_KEY) {
  console.error('❌ CLERK_SECRET_KEY not found in environment');
  process.exit(1);
}

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

async function checkLouisOrgs() {
  console.log('🔍 Checking organizations for louis@mediar.ai...\n');

  // Find Louis's user
  const users = await clerkClient.users.getUserList({ emailAddress: ['louis@mediar.ai'] });

  if (users.data.length === 0) {
    console.error('❌ louis@mediar.ai not found in Clerk');
    return;
  }

  const louisUser = users.data[0];
  console.log(`👤 Found user: ${louisUser.emailAddresses[0].emailAddress} (${louisUser.id})\n`);

  // Get all organization memberships for Louis
  const memberships = await clerkClient.users.getOrganizationMembershipList({
    userId: louisUser.id,
    limit: 100,
  });

  console.log(`📋 Louis is a member of ${memberships.data.length} organizations:\n`);

  for (const membership of memberships.data) {
    console.log(`   ✓ ${membership.organization.name} (${membership.organization.id})`);
    console.log(`     Role: ${membership.role}`);
  }

  // Get pending invitations
  const invitations = await clerkClient.invitations.getInvitationList();
  const louisInvitations = invitations.data.filter(
    inv => inv.emailAddress === 'louis@mediar.ai'
  );

  if (louisInvitations.length > 0) {
    console.log(`\n📧 Pending invitations for louis@mediar.ai: ${louisInvitations.length}\n`);
    for (const inv of louisInvitations) {
      console.log(`   ⏳ Organization ID: ${(inv as any).organizationId}`);
      console.log(`      Status: ${inv.status}`);
    }
  } else {
    console.log('\n✅ No pending invitations');
  }
}

checkLouisOrgs().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
