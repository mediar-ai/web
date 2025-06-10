# Windows Events Ingestion API

This document outlines how to send low-level events from the Windows recorder to the Mediar application for processing and analysis.

## Endpoint Details

- **URL:** `https://app.mediar.ai/api/ingest`
- **Method:** `POST`
- **Content-Type:** `application/json`

## Request Body Structure

The request body must be a JSON object with the following structure:

```json
{
  "session_id": "your-session-id",
  "user_id": "optional-user-id",
  "payload": {
    "type": "event-type-as-string",
    "timestamp": "iso-8601-timestamp",
    "event": {
      // The specific event data goes here
    }
  },
  "screenshots": [
    {
      "id": "a-unique-screenshot-id",
      "dataUrl": "data:image/jpeg;base64,your_base64_encoded_string"
    }
  ]
}
```

### Key Fields

- **`session_id` (string, required):** A unique identifier for the recording session. This should be a UUID generated when the recording starts and used for all subsequent events in that session.
- **`user_id` (string, optional):** A unique identifier for the user. This can be an installation ID or another persistent identifier.
- **`payload` (object, required):** An object containing the event details.
- **`screenshots` (array, optional):** An array of screenshot objects associated with the event.

### Screenshot Object Structure

Each object in the `screenshots` array must have the following structure:

- **`id` (string, required):** A unique identifier for the screenshot, e.g., a timestamp or a generated UUID. This ID will be used as part of the filename in storage.
- **`dataUrl` (string, required):** The screenshot image encoded as a Base64 data URL. The format must be `data:[MIME_TYPE];base64,[BASE64_DATA]`.
  - Supported `MIME_TYPE`s include `image/jpeg`, `image/png`, etc.

## Event Structure

The `payload` object should follow this structure:

```typescript
interface FrontendWorkflowEvent {
  type: string;           // Event type: "mouse_event", "keyboard_event", etc.
  timestamp: string;      // ISO 8601 timestamp (RFC3339 format)
  event: FrontendEventData;
}

interface FrontendEventData {
  mouse?: MouseEvent;
  keyboard?: KeyboardEvent;
  // ... other event types
}
```

For the complete, detailed event structure, please refer to the document previously provided.

## Example `curl` Request with Screenshot

Here is an example of how to send a keyboard event with an associated screenshot:

```bash
# Note: The Base64 string is heavily truncated for readability.
# In a real request, this would be a very long string.
curl -X POST https://app.mediar.ai/api/ingest \\
-H "Content-Type: application/json" \\
-d '{
  "session_id": "a_unique_session_uuid",
  "user_id": "an_optional_user_uuid",
  "payload": {
    "type": "keyboard_event",
    "timestamp": "2024-01-15T10:30:45.123Z",
    "event": {
      "keyboard": {
        "key_code": 65,
        "is_key_down": true,
        "typed_string": "Hello from the Windows recorder!"
      }
    }
  },
  "screenshots": [
    {
      "id": "screenshot-1673778645123",
      "dataUrl": "data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/epv2AAAAABJRU5ErkJggg=="
    }
  ]
}'
```

## Success Response

A successful request will return a detailed JSON object. The HTTP status code will indicate the overall outcome.

- **`200 OK`:** The event and all associated screenshots were processed successfully.
- **`207 Multi-Status`:** The event was saved, but one or more screenshots failed to upload.

### Example Successful Response (200 OK)

```json
{
  "message": "Event ingested successfully",
  "dbInsertSuccess": true,
  "successfulUploads": [
    "a_unique_session_uuid/screenshot-1673778645123.jpeg"
  ],
  "failedUploads": []
}
```

### Example Partially Successful Response (207 Multi-Status)

This response indicates that the screenshot failed to upload due to a "Bucket not found" error, but the event itself was still saved.

```json
{
  "message": "Event ingested with partial success",
  "dbInsertSuccess": true,
  "successfulUploads": [],
  "failedUploads": [
    {
      "id": "screenshot-1673778645123",
      "error": "Bucket not found"
    }
  ]
}
``` 