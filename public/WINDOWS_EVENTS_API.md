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
  }
}
```

### Key Fields

- **`session_id` (string, required):** A unique identifier for the recording session. This should be a UUID generated when the recording starts and used for all subsequent events in that session.
- **`user_id` (string, optional):** A unique identifier for the user. This can be an installation ID or another persistent identifier.
- **`payload` (object, required):** An object containing the event details, as defined in the "Event Structure" section below.

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

## Example `curl` Request

Here is an example of how to send a keyboard event using `curl`:

```bash
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
  }
}'
```

## Success Response

A successful request will return a `201 Created` status code and a JSON body like this:

```json
{
  "message": "Event ingested successfully",
  "data": null
}
``` 