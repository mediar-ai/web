# Windows Events Ingestion API

This document outlines how to send low-level events from the Windows recorder to the Mediar application for processing and analysis.
                            
## Endpoint

- **URL:** `https://app.mediar.ai/api/ingest`
- **Method:** `POST`
- **Content-Type:** `application/json`

## General Request Structure

All requests must be a `POST` with a JSON body. The body must contain a `session_id`, an optional `user_id`, and a `payload` object. The server uses the `payload.type` field to determine how to process the event.    
```json
{
  "session_id": "your-session-id",
  "user_id": "optional-user-id",
  "payload": {
    "type": "event_type_string",
    "timestamp": "iso-8601-timestamp",
    "event": {
      // Event-specific data structure goes here
    }
  }
}
```

---

## Event Ingestion Paths

There are three primary ways to send data, based on the `payload.type`.

### Path 1: Meaningful Event (with UI Tree)

This is the primary method for capturing a complete snapshot of the UI state. It is the equivalent of an "Initial Dump" in the web recorder workflow.
                            
- **`payload.type`**: `meaningful_event`
- **`payload.event` object**: Must contain a `screen` object with a `ui_tree` string. A `screenshot_data` string is optional but recommended for better analysis.
                            
#### Example Body

```json
{
  "session_id": "session-12345",
  "user_id": "user-abcde",
  "payload": {
    "type": "meaningful_event",
    "timestamp": "2024-06-12T12:00:00.000Z",
    "event": {
      "mouse": null,
      "screen": {
        "ui_tree": "{\\\"id\\\": ... }"
      }
    }
  }
}
```

---

### Path 2: Screenshot Diff

This path is used to get a detailed analysis of a visual change between two screenshots. It is the equivalent of a "UI Diff" in the web recorder workflow.
                            
- **`payload.type`**: `screenshot_diff`
- **`payload.event` object**: Must contain a `screenshot_diff` object with the following fields:
  - `before`: The base64 data URL for the "before" image. Use `null` if not available (not empty string).
  - `after`: The base64 data URL for the "after" image. Use `null` if not available (not empty string).
  - `before_timestamp`: The ISO 8601 timestamp of when the "before" image was captured.
  - `after_timestamp`: The ISO 8601 timestamp of when the "after" image was captured.

#### Example Body
```json
{
  "session_id": "session-12345",
  "user_id": "user-abcde",
  "payload": {
    "type": "screenshot_diff",
    "timestamp": "2024-06-12T12:00:05.000Z",
    "event": {
      "screenshot_diff": {
        "before": "data:image/jpeg;base64,...",
        "after": "data:image/jpeg;base64,...",
        "before_timestamp": "2024-06-12T12:00:00.000Z",
        "after_timestamp": "2024-06-12T12:00:05.000Z"
      }
    }
  }
}
```

---

### Path 3: Simple Low-Level Event

This is the fallback for discrete, simple actions that do not have a full UI tree or screenshot diff.

- **`payload.type`**: Any other string (e.g., `mouse_click`, `key_press`).
- **`payload.event` object**: Contains the specific data for the simple event.

#### Example Body
```json
{
  "session_id": "session-12345",
  "user_id": "user-abcde",
  "payload": {
    "type": "mouse_click",
    "timestamp": "2024-06-12T12:00:02.000Z",
    "event": {
      "mouse": {
        "x": 120,
        "y": 450,
        "button": "left"
      }
    }
  }
}
```

---

## Important Notes

### Screenshot Data Handling

When sending screenshot data in the `screenshot_diff` event:
- For missing screenshots, use `null` instead of empty strings (`""`)
- The server will normalize empty strings to `null` for backward compatibility
- Both `before` and `after` screenshots are required for a standard diff operation
- If only the `after` screenshot is provided (first screenshot case), it will be processed as an initial dump
                            
### Error Responses

If the request contains invalid screenshot data, the server will return a `400` error with debug information including:
- Whether each screenshot field is present
- The data types of the screenshot fields
- The lengths of the screenshot data

---

## Success Response

A successful request will return a `200 OK` status. If the request included screenshots that were processed, the response body will detail the outcome. Note that analysis happens asynchronously, so the success response only confirms that the event was received.
                                                        
### Example Response

```json
{
  "message": "Event ingested successfully",
  "dbInsertSuccess": true
}
```