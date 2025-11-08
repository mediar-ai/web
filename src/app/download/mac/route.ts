import { redirect } from 'next/navigation';

export async function GET() {
  // Redirect to the releases page on CrabNebula where users can download the latest installer
  redirect('https://web.crabnebula.cloud/mediar/mediar/releases');
}