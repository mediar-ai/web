import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const uploadImage = async (dataUrl: string, path: string) => {
    const mimeTypeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,/);
    if (!mimeTypeMatch) throw new Error('Invalid dataUrl format');
    const mimeType = mimeTypeMatch[1];
    const base64Data = dataUrl.substring(mimeTypeMatch[0].length);
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    const { error } = await supabaseAdmin.storage
      .from('low-level-event-screenshots')
      .upload(path, imageBuffer, { contentType: mimeType, upsert: true });

    if (error) throw new Error(`Failed to upload to Supabase Storage: ${error.message}`);
}; 