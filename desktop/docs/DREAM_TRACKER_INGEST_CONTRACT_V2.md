# Dream Tracker ingest contract (v2)

## Goal
Send aggregated/merge/clarification results directly to Supabase RPC in `dream-tracker`.

## Note type model
- `0` regular
- `1` aggregated
- `2` merge
- `3` clarification

## Required RPCs (already on DB side)
- `ingest_aggregated_v1(p_payload jsonb, p_idempotency_key text, p_payload_hash text)`
- `ingest_merge_v1(p_payload jsonb, p_idempotency_key text, p_payload_hash text)`
- `ingest_clarification_v1(p_payload jsonb, p_idempotency_key text, p_payload_hash text)`

---

## 1) Create/update aggregated note

RPC: `ingest_aggregated_v1`

Payload:
```json
{
  "schema": "aggregated_ingest_v1",
  "session_id": 123, 
  "title": "Aggregated Test Node",
  "project_tag_id": "8d4f75ea-a4cf-4625-9c89-b82aa3642c06",
  "aggregated_note_id": "2a5e5d59-bb22-4d90-86e1-4c0e80bf50d2",
  "replace_existing": true,
  "platform_code": "WIN",
  "active_segment_id": "gemini",
  "responses": [
    {
      "segment_id": "chatgpt",
      "provider": "chatgpt",
      "model": "gpt-4.1",
      "source_url": "https://chat.openai.com/...",
      "markdown": "## ChatGPT response..."
    },
    {
      "segment_id": "gemini",
      "provider": "gemini",
      "model": "2.5-pro",
      "source_url": "https://gemini.google.com/...",
      "markdown": "## Gemini response..."
    }
  ]
}
```

Notes:
- If `session_id` omitted/null, backend allocates new integer `session_id`.
- Normal create path inserts a new aggregated note for the current question in that session.
- Manual overwrite path must pass both `aggregated_note_id` and `replace_existing=true`; backend will then update that exact aggregated root note only.
- For the first note of a new session, `project_tag_id` selects its Dream Tracker project.
- For a continuation of an existing session chain, backend ignores the client's current `project_tag_id` and inherits `note_tags` from the previous aggregated note.
- Backend persists immutable `origin_platform_code` on the created note from `platform_code` (`WIN`, `MAC`, `LNX`, `AND`, `IOS`, `WEB`).
- Response contains `note_id`, `session_id`, and the effective `project_tag_id` actually attached to the note (which can differ from the client's input on continuation).

---

## 2) Create merge note

RPC: `ingest_merge_v1`

Payload:
```json
{
  "schema": "merge_ingest_v1",
  "session_id": 123,
  "platform_code": "WIN",
  "prompt_text": "Original user prompt for this merge",
  "markdown": "Merged summary across providers..."
}
```

Behavior:
- Always creates NEW note (`type=2`) under aggregated note (`type=1`) for this `session_id`.
- Backend derives canonical note title from `prompt_text`.
- Backend inherits project membership (`note_tags`) from the parent aggregated note.
- Backend persists immutable `origin_platform_code` on the merge note from `platform_code`.
- Legacy `title` payloads are still accepted, but clients should treat them as deprecated.

---

## 3) Create clarification note

RPC: `ingest_clarification_v1`

Payload:
```json
{
  "schema": "clarification_ingest_v1",
  "session_id": 123,
  "platform_code": "WIN",
  "prompt_text": "Follow-up question from the user",
  "markdown": "Follow-up clarification..."
}
```

Behavior:
- Creates note `type=3`.
- Parent selection is automatic:
  - latest clarification in chain of latest merge, or
  - latest merge if no clarifications yet.
- So calls form chain: `merge -> clar1 -> clar2 -> clar3...`
- Backend derives canonical note title from `prompt_text`.
- Backend inherits project membership (`note_tags`) from the parent clarification/merge chain.
- Backend persists immutable `origin_platform_code` on the clarification note from `platform_code`.
- Legacy `title` payloads are still accepted, but clients should treat them as deprecated.

---

## Idempotency (mandatory recommendation)

Send these two args for every RPC call:
- `p_idempotency_key`: unique stable event key
- `p_payload_hash`: hash of normalized payload (sha256 recommended)

### Key format suggestion
`{kind}:{session_id}:{source_message_id}`

Examples:
- `aggregated:123:msg_001`
- `merge:123:msg_002`
- `clarification:123:msg_003`

If same key is replayed, backend returns previous result with `idempotent_replay=true`.

---

## Minimal TypeScript client example

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function rpc(name: string, payload: any, key: string, hash: string) {
  const { data, error } = await supabase.rpc(name, {
    p_payload: payload,
    p_idempotency_key: key,
    p_payload_hash: hash,
  });
  if (error) throw error;
  return data;
}
```

---

## Processing pipeline recommendation

1. Receive LLM JSON.
2. Normalize to internal DTO.
3. Decide event kind:
   - aggregated / merge / clarification
4. Build payload for corresponding RPC.
5. Compute `payload_hash`.
6. Build deterministic `idempotency_key`.
7. Call RPC.
8. Store returned `session_id` and `note_id` in sender logs.

---

## JSON mapping rules

Incoming source fields can vary. Map to:
- aggregated: `responses[].markdown` (fallback: `content/text/answer/response`)
- merge/clarification: use `markdown` (fallback `content/text`)

Keep source URL in markdown if needed:
```md
[source](https://...)
```

---

## Error handling

- `session_id is required` on merge/clarification -> sender must pass valid session.
- `aggregated note not found for session_id` -> aggregated not created yet; send aggregated first.
- `merge note not found for session_id` on clarification -> send merge first.
- Retry only with same `idempotency_key`.

---

## Final requirement for both apps

Implement 3 explicit send methods:
- `sendAggregated(sessionId?, title, responses, activeSegmentId?, projectTagId?, aggregatedNoteId?, replaceExisting?)`
- `sendMerge(sessionId, title, markdown)`
- `sendClarification(sessionId, title, markdown)`

Do not emulate merge/clarification via direct table inserts; always use RPC.
