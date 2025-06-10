# Transcripts Ingestion API

This document outlines how to send transcript data to the application for processing and storage.

## Endpoint Details

- **URL:** `https://app.mediar.ai/api/transcripts`
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Authentication:** `Bearer <YOUR_API_KEY>`

## Request Body Structure

The request body must be a JSON object with the following structure:

```json
{
  "session_id": "your-session-id",
  "user_id": "optional-user-id",
  "lead_id": "optional-lead-id",
  "items": [
    {
      "id": "item_05e270695025",
      "type": "message",
      "role": "assistant",
      "content": [
        "Hi this is Alice from Stoke on a recorded line, am I speaking with Nida?"
      ],
      "interrupted": false
    }
  ]
}
```

### Key Fields

- **`session_id` (uuid, required):** A unique identifier for the session.
- **`user_id` (uuid, optional):** A unique identifier for the user.
- **`lead_id` (text, optional):** A unique identifier for the lead.
- **`items` (array, required):** An array of transcription items.

## Example `curl` Request

Here is an example of how to send a transcript using `curl`:

```bash
curl -X POST https://app.mediar.ai/api/transcripts \\
-H "Content-Type: application/json" \\
-H "Authorization: Bearer <YOUR_API_KEY>" \\
-d '{
  "session_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "user_id": "b47ac10b-58cc-4372-a567-0e02b2c3d479",
  "lead_id": "a_unique_lead_id",
  "items": [
    {
      "id": "item_05e270695025",
      "type": "message",
      "role": "assistant",
      "content": [
        "Hi this is Alice from Stoke on a recorded line, am I speaking with Nida?"
      ],
      "interrupted": false
    },
    {
      "id": "item_fce1047a0130",
      "type": "message",
      "role": "user",
      "content": [
        "No. Joseph."
      ],
      "interrupted": false
    }
  ]
}'
```

## Success Response

A successful request will return a `201 Created` status code and a JSON body like this:

```json
{
  "message": "Transcriptions ingested successfully",
  "data": null
}
``` 