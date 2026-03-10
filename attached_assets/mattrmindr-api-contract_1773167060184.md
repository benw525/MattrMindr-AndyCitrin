# MattrMindr External API Contract for MattrMindrScribe Integration

This document defines the API endpoints that MattrMindr must implement to allow MattrMindrScribe (a legal transcription tool) to integrate with it. MattrMindrScribe will call these endpoints to authenticate users, search for cases, and send transcription files to cases.

## Base Configuration

All endpoints live under the `/api/external/` path on the MattrMindr server. MattrMindrScribe stores the user's MattrMindr base URL (e.g. `https://mattrmindr.example.com`) and will prepend it to all paths below.

## Authentication

### POST /api/external/auth

Authenticate a MattrMindr user from MattrMindrScribe. This should validate the user's credentials and return a long-lived token that MattrMindrScribe will store and use for subsequent API calls.

**Request:**
```json
{
  "email": "user@lawfirm.com",
  "password": "their-mattrmindr-password"
}
```

**Success Response (200):**
```json
{
  "token": "jwt-or-session-token-string",
  "user": {
    "id": "uuid-of-user",
    "email": "user@lawfirm.com",
    "fullName": "Jane Doe"
  }
}
```

**Error Response (401):**
```json
{
  "error": "Invalid email or password"
}
```

**Notes:**
- The token should be long-lived (at least 30 days) since the user connects once and expects it to stay connected.
- If your system uses JWT, consider issuing a special "integration" token type that doesn't expire as quickly as normal session tokens.
- MattrMindrScribe will send this token as `Authorization: Bearer <token>` on all subsequent requests.

---

## Case Search

### GET /api/external/cases

Search for cases where the authenticated user is a team member. Used when a MattrMindrScribe user wants to link a folder to a MattrMindr case.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| q         | string | No       | Search query to filter cases by name or case number. If empty, return all accessible cases. |

**Success Response (200):**
```json
{
  "cases": [
    {
      "id": "case-uuid-1",
      "name": "Smith v. Johnson",
      "caseNumber": "2024-CV-1234",
      "pinned": true
    },
    {
      "id": "case-uuid-2",
      "name": "Estate of Williams",
      "caseNumber": "2024-PR-5678",
      "pinned": false
    }
  ]
}
```

**Requirements:**
- Only return cases where the authenticated user is on the case team (has access).
- Sort results with `pinned: true` cases first, then alphabetically by name.
- Filter by `q` parameter: match against case name and case number (case-insensitive, partial match).
- If `q` is empty or not provided, return all accessible cases (pinned first).

---

## File Management

### GET /api/external/cases/:caseId/files

Check if a file with a given name already exists in a case. MattrMindrScribe uses this before sending files to detect conflicts.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| filename  | string | Yes      | The exact filename to check for |

**Success Response (200):**
```json
{
  "exists": true,
  "fileId": "existing-file-uuid"
}
```

Or if not found:
```json
{
  "exists": false
}
```

---

### POST /api/external/cases/:caseId/files

Send a transcription file and its associated data to a MattrMindr case. This is the main integration endpoint.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "filename": "Deposition - John Smith.mp3",
  "description": "Deposition taken on 2024-01-15",
  "type": "audio",
  "duration": 3600.5,
  "replaceFileId": null,
  "transcript": {
    "segments": [
      {
        "startTime": 0.0,
        "endTime": 5.2,
        "speaker": "Attorney Rodriguez",
        "text": "Please state your name for the record."
      },
      {
        "startTime": 5.5,
        "endTime": 8.1,
        "speaker": "Witness Smith",
        "text": "My name is John Smith."
      }
    ],
    "versions": [
      {
        "changeDescription": "Initial transcription",
        "createdAt": "2024-01-15T10:30:00Z",
        "segments": [
          {
            "startTime": 0.0,
            "endTime": 5.2,
            "speaker": "Speaker 1",
            "text": "Please state your name for the record."
          }
        ]
      },
      {
        "changeDescription": "Speaker names updated",
        "createdAt": "2024-01-15T11:00:00Z",
        "segments": [
          {
            "startTime": 0.0,
            "endTime": 5.2,
            "speaker": "Attorney Rodriguez",
            "text": "Please state your name for the record."
          }
        ]
      }
    ],
    "summaries": [
      {
        "agentType": "deposition_analyst",
        "summary": "Key testimony regarding the incident on March 5th...",
        "modelUsed": "gpt-4o-mini",
        "createdAt": "2024-01-15T12:00:00Z"
      }
    ],
    "pipelineLog": {
      "whisper": { "status": "success", "segments": 142 },
      "diarization": { "status": "success", "speakersDetected": 3 },
      "refinement": { "status": "success", "speakersAfterRefinement": 3 },
      "startedAt": "2024-01-15T10:00:00Z",
      "completedAt": "2024-01-15T10:05:00Z"
    }
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| filename | string | The user-given name of the file in MattrMindrScribe |
| description | string | Optional description of the media file |
| type | string | `"audio"` or `"video"` |
| duration | number | Duration of the media file in seconds |
| replaceFileId | string/null | If replacing an existing file, provide its ID (from the conflict check). If null, creates a new file. |
| transcript.segments | array | The current transcript segments with speaker labels and timestamps |
| transcript.versions | array | Full version history (change log). Each version contains the complete segment state at that point in time. |
| transcript.summaries | array | AI-generated summaries from various legal analysis agents |
| transcript.pipelineLog | object | Technical metadata about the transcription pipeline steps |

**Success Response (201 for new, 200 for replaced):**
```json
{
  "fileId": "new-or-updated-file-uuid",
  "replaced": false
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Filename is required" }` | Missing required fields |
| 401 | `{ "error": "Invalid or expired token" }` | Bad auth token |
| 403 | `{ "error": "No access to this case" }` | User not on case team |
| 404 | `{ "error": "Case not found" }` | Invalid caseId |

---

## Error Format

All error responses should follow this format:

```json
{
  "error": "Human-readable error message"
}
```

## CORS

If MattrMindrScribe and MattrMindr are on different domains, MattrMindr must allow CORS from the MattrMindrScribe origin. However, since MattrMindrScribe proxies all requests through its own backend server (not the browser), CORS is not strictly required. The requests will be server-to-server.

---

# Reverse Integration: Sending Files FROM MattrMindr TO MattrMindrScribe

MattrMindr can also send audio/video files to MattrMindrScribe for transcription. The flow is: MattrMindr connects to the user's MattrMindrScribe account, uploads a file from a case, and MattrMindrScribe runs its full AI transcription pipeline on it.

MattrMindrScribe exposes the following endpoints under `/api/external/` for MattrMindr to call.

## Authentication (Inbound)

### POST /api/external/auth

Authenticate against MattrMindrScribe. This is the same shape as the outbound auth endpoint — MattrMindr stores the user's MattrMindrScribe credentials and gets a token.

**Request:**
```json
{
  "email": "user@lawfirm.com",
  "password": "their-scribe-password"
}
```

**Success Response (200):**
```json
{
  "token": "jwt-token-string",
  "user": {
    "id": "uuid-of-user",
    "email": "user@lawfirm.com",
    "fullName": "Jane Doe"
  }
}
```

**Notes:**
- Token is a JWT valid for 7 days.
- MattrMindr should send this token as `Authorization: Bearer <token>` on all subsequent requests.

---

## Sending Files for Transcription

### POST /api/external/receive

Send an audio or video file to MattrMindrScribe for AI transcription. MattrMindr provides a publicly accessible download URL for the file and MattrMindrScribe downloads it, stores it, and runs the full transcription pipeline (Whisper + AssemblyAI diarization + GPT-4o refinement).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "filename": "Deposition - John Smith.mp3",
  "fileUrl": "https://mattrmindr.example.com/api/files/abc123/download?token=temp-token",
  "contentType": "audio/mpeg",
  "fileSize": 52428800,
  "description": "Deposition taken on 2024-01-15",
  "caseId": "case-uuid-1",
  "caseName": "Smith v. Johnson",
  "expectedSpeakers": 3
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| filename | string | Yes | Original filename of the media file |
| fileUrl | string | Yes | A publicly accessible URL where MattrMindrScribe can download the file. This can be a temporary/signed URL. |
| contentType | string | No | MIME type of the file (e.g. `audio/mpeg`, `video/mp4`). Used to determine audio vs video. |
| fileSize | number | No | File size in bytes. For informational/validation purposes. |
| description | string | No | Description to attach to the transcript |
| caseId | string | No | MattrMindr case ID. If provided, the transcript will be placed in a folder linked to this case (creating one if needed). |
| caseName | string | No | Human-readable case name. Used if a new folder needs to be created for this case. |
| expectedSpeakers | number | No | Expected number of speakers (2-10). Helps the diarization pipeline. |

**Success Response (201):**
```json
{
  "transcriptId": "transcript-uuid",
  "filename": "Deposition - John Smith.mp3",
  "status": "pending",
  "folderId": "folder-uuid-or-null",
  "message": "File received and transcription started"
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "filename and fileUrl are required" }` | Missing required fields |
| 400 | `{ "error": "Unsupported file type: .xyz" }` | File extension not allowed |
| 401 | `{ "error": "Authentication required" }` | Missing auth token |
| 403 | `{ "error": "Invalid or expired token" }` | Bad auth token |
| 502 | `{ "error": "Could not download file from the provided URL" }` | File URL unreachable |

**Important Notes for MattrMindr:**
- The `fileUrl` must be downloadable by the MattrMindrScribe server (server-to-server). If your files are behind auth, generate a temporary signed/public URL.
- Transcription is asynchronous. The response comes back immediately with `status: "pending"`. Use the status endpoint below to poll for completion.
- Supported file types: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.aac`, `.webm`, `.wma`, `.amr`, `.opus`, `.aiff`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.wmv`, `.flv`, `.3gp`, `.m4v`, `.mpg`, `.mpeg`

---

## Checking Transcription Status

### GET /api/external/transcripts/:transcriptId/status

Poll the status of a previously submitted transcription. Once status is `completed`, the response includes all transcript segments.

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200) — Pending/Processing:**
```json
{
  "transcriptId": "transcript-uuid",
  "filename": "Deposition - John Smith.mp3",
  "status": "processing",
  "duration": null,
  "errorMessage": null,
  "pipelineLog": null,
  "segments": []
}
```

**Success Response (200) — Completed:**
```json
{
  "transcriptId": "transcript-uuid",
  "filename": "Deposition - John Smith.mp3",
  "status": "completed",
  "duration": 3600.5,
  "errorMessage": null,
  "pipelineLog": {
    "whisper": { "status": "success", "segments": 142 },
    "diarization": { "status": "success", "speakersDetected": 3 },
    "refinement": { "status": "success", "speakersAfterRefinement": 3 }
  },
  "segments": [
    {
      "startTime": 0.0,
      "endTime": 5.2,
      "speaker": "Speaker 1",
      "text": "Please state your name for the record."
    },
    {
      "startTime": 5.5,
      "endTime": 8.1,
      "speaker": "Speaker 2",
      "text": "My name is John Smith."
    }
  ]
}
```

**Status Values:**
- `pending` — File received, waiting to start
- `processing` — Transcription pipeline running
- `completed` — Done, segments available
- `failed` — Pipeline failed, check `errorMessage`

**Error Response (404):**
```json
{
  "error": "Transcript not found"
}
```

---

## Implementation Checklist

### Endpoints MattrMindr must implement (for outbound: Scribe → MattrMindr):
1. [ ] `POST /api/external/auth` — User authentication, returns long-lived token
2. [ ] `GET /api/external/cases` — Case search with team filtering and pin sorting
3. [ ] `GET /api/external/cases/:caseId/files` — Check file existence by filename
4. [ ] `POST /api/external/cases/:caseId/files` — Receive and store transcription data
5. [ ] Ensure the token from step 1 is validated on all other endpoints
6. [ ] Only return cases where the authenticated user is a team member
7. [ ] Sort case search results with pinned cases first

### Endpoints MattrMindrScribe already implements (for inbound: MattrMindr → Scribe):
1. [x] `POST /api/external/auth` — Authenticate against MattrMindrScribe, get JWT
2. [x] `POST /api/external/receive` — Send a file URL for transcription
3. [x] `GET /api/external/transcripts/:id/status` — Poll transcription status and get results

### What MattrMindr needs to do for inbound:
1. [ ] Add a "Send to MattrMindrScribe for Transcription" option on case files
2. [ ] Store the user's MattrMindrScribe URL + auth token (from `/api/external/auth`)
3. [ ] Generate a temporary download URL for the file to send in `fileUrl`
4. [ ] Call `POST /api/external/receive` with the file metadata
5. [ ] Poll `GET /api/external/transcripts/:id/status` until `completed` or `failed`
6. [ ] Display the returned transcript segments to the user
