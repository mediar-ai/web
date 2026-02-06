import { redirect } from 'next/navigation';
import { DESKTOP_DOWNLOAD_URL } from '@/lib/constants';

export async function GET() {
  // Redirect to the Windows installer on CrabNebula CDN
  redirect(DESKTOP_DOWNLOAD_URL);
}