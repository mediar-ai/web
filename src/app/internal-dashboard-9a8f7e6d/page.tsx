import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import AdminDashboardClient from './AdminDashboardClient';

export default async function AdminPage() {
  const { userId, has } = await auth();
  
  if (!userId) {
    redirect('/sign-in');
  }

  // Check if user has admin or member role in organization
  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });
  
  if (!hasAdminRole && !hasMemberRole) {
    redirect('/unauthorized');
  }

  // Pass role information to the client component
  return <AdminDashboardClient isAdmin={hasAdminRole} />;
}