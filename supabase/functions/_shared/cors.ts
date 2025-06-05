export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Or your specific frontend domain for better security later
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Important for allowing POST requests and preflight OPTIONS
}
