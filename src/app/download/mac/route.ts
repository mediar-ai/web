import { redirect } from 'next/navigation';

export async function GET() {
  // Redirect to the Mac installer on CrabNebula
  // For now, using the same releases page since Mac URL might be different
  redirect('https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/dmg-universal');
}