import { serve } from 'inngest/next';
import { inngest, inngestFunctions } from '@/lib/inngest';

// Required for Inngest to work with Vercel's serverless functions
// Inngest steps each have their own timeout, but the route itself needs max duration
export const maxDuration = 300; // 5 minutes (Vercel Pro max)

// @ts-expect-error - inngest serve() types not fully compatible with Next.js 15 route handlers
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});

