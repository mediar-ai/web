import { redirect } from 'next/navigation';

export async function GET() {
  // Redirect to the Windows installer on CrabNebula CDN
  redirect('https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64');
}