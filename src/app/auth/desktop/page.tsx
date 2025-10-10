import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import DesktopAuthHandler from './DesktopAuthHandler';

export default async function DesktopAuthPage() {
  // Check if user is authenticated
  const { userId } = await auth();

  if (!userId) {
    // Redirect to sign-in with return URL
    redirect('/sign-in?redirect_url=/auth/desktop');
  }

  // Get user info
  const user = await currentUser();

  if (!user || !user.emailAddresses || user.emailAddresses.length === 0) {
    redirect('/sign-in?redirect_url=/auth/desktop');
  }

  // Client component will handle token generation and redirect
  return (
    <DesktopAuthHandler
      userId={userId}
      email={user.emailAddresses[0].emailAddress}
    />
  );
}
