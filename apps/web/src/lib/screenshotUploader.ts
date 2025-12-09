// Helper function to convert a base64 data URL into a Blob
function base64ToBlob(base64: string, mimeType: string): Blob {
    const b64 = atob(base64);
    let n = b64.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = b64.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mimeType });
}

export const uploadScreenshot = async (
    base64Data: string,
    userId: string,
    sessionId: string,
    imageId: string
): Promise<void> => {

    // Construct the file path as it will be stored in Supabase
    const path = `${userId}/${sessionId}/screenshots/${imageId}.jpeg`;

    try {
        // 1. Get a secure, one-time-use signed upload URL from our backend API
        const uploadUrlResponse = await fetch('/api/capture/generate-upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });

        if (!uploadUrlResponse.ok) {
            const errorBody = await uploadUrlResponse.json();
            throw new Error(`Failed to get upload URL: ${errorBody.error}`);
        }

        const uploadData = await uploadUrlResponse.json();
        const { signedUrl } = uploadData;

        if (!signedUrl) {
            throw new Error('Signed URL not found in API response.');
        }

        // 2. Convert the base64 image data into a binary Blob for uploading
        const fileBlob = base64ToBlob(base64Data, 'image/jpeg');

        // 3. Upload the file directly to Supabase Storage using the signed URL
        const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'image/jpeg',
            },
            body: fileBlob,
        });

        if (!uploadResponse.ok) {
            throw new Error(`Screenshot upload failed: ${uploadResponse.statusText}`);
        }

        console.log(`[screenshotUploader] Successfully uploaded ${path}`);

    } catch (error) {
        console.error('[screenshotUploader] Error in upload process:', error);
    }
}; 