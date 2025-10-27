import { redirect } from 'next/navigation';

export async function GET() {
  // Redirect to the Windows installer on CrabNebula
  redirect('https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/nsis-x86_64');
}