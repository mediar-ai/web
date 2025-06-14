import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to convert a base64 data URL into a Blob
function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    const mimeType = parts[0].match(/:(.*?);/)![1];
    const b64 = atob(parts[1]);
    let n = b64.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = b64.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mimeType });
}

export const uploadScreenshot = async (
    imageDataUrl: string, 
    userId: string, 
    sessionId: string,
    imageId: string
): Promise<void> => {
    
    // Construct the file path as it will be stored in Supabase
    const path = `${userId}/${sessionId}/screenshots/${imageId}.jpeg`;

    try {
        // 1. Get a secure, one-time-use upload URL from our backend API
        const uploadUrlResponse = await fetch('/api/capture/generate-upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });

        if (!uploadUrlResponse.ok) {
            const errorBody = await uploadUrlResponse.json();
            throw new Error(`Failed to get upload URL: ${errorBody.error}`);
        }
        
        const { signedUrl } = await uploadUrlResponse.json();
        
        // 2. Convert the base64 image data into a binary Blob for uploading
        const fileBlob = dataUrlToBlob(imageDataUrl);

        // 3. Upload the file directly to Supabase Storage using the signed URL
        const { error } = await supabase.storage
            .from('low-level-event-screenshots')
            .uploadToSignedUrl(path, signedUrl.token, fileBlob, {
                upsert: true, // Overwrite if it already exists
            });

        if (error) {
            throw new Error(`Screenshot upload failed: ${error.message}`);
        }

        console.log(`[screenshotUploader] Successfully uploaded ${path}`);

    } catch (error) {
        console.error('[screenshotUploader] Error in upload process:', error);
        // In a real app, you might want to add more robust error handling here,
        // like retrying or notifying the user.
    }
}; 