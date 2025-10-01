#!/usr/bin/env tsx
import { createClerkClient } from '@clerk/backend';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

async function clearUserSessions() {
  const users = await clerkClient.users.getUserList({ emailAddress: ['louis@mediar.ai'] });

  if (users.data.length === 0) {
    console.error('User not found');
    return;
  }

  const user = users.data[0];
  console.log(`Found user: ${user.id}`);

  // Get all sessions
  const sessions = await clerkClient.sessions.getSessionList({ userId: user.id });

  console.log(`Found ${sessions.data.length} active sessions`);

  for (const session of sessions.data) {
    console.log(`Revoking session: ${session.id}`);
    await clerkClient.sessions.revokeSession(session.id);
  }

  console.log('✅ All sessions revoked. Sign in again to see all orgs.');
}

clearUserSessions();
