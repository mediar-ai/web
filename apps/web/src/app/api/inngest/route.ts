import { serve } from 'inngest/next';
import { inngest, inngestFunctions } from '@/lib/inngest';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
