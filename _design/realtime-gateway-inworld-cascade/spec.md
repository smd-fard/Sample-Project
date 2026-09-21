# Spec for realtime-gateway-inworld-cascade

branch: feature/realtime-gateway-inworld-cascade

## Summary

A WebSocket gateway that speaks the **OpenAI Realtime API (GA dialect)** to clients while internally
running a **cascaded voice pipeline on Inworld services**: streaming **Inworld STT** for
transcription and turn detection, the **Inworld LLM Router** for the conversational model, and
streaming **Inworld TTS** for the spoken reply. Any client written against OpenAI's Realtime protocol
(`session.update`, `input_audio_buffer.append`, `response.create`, …) connects to this server
unchanged and receives the standard server events (`session.created`,
`input_audio_buffer.speech_started`, `response.output_audio.delta`, `response.done`, …).

The gateway owns the full orchestration: it holds one session per WebSocket connection, keeps the
conversation history in memory, forwards client audio to Inworld STT, lets Inworld's voice-activity
detection drive turn-taking, streams the LLM's tokens sentence-by-sentence into a per-response TTS
context, and relays 24 kHz PCM audio plus aligned transcripts back to the client. Barge-in cancels
the in-flight LLM and TTS work cleanly. Each upstream stage sits behind its own adapter so it can be
replaced or faked; functional tests run against in-process fake Inworld services, with a live
end-to-end smoke test when a real API key is present.

The three Inworld services are reached as follows: STT over its bidirectional WebSocket
(`/stt/v1/transcribe:streamBidirectional`), the LLM Router over its OpenAI-compatible streaming
chat-completions endpoint (`/v1/chat/completions`), and TTS over its bidirectional WebSocket
(`/tts/v1/voice:streamBidirectional`). All three authenticate with the single Inworld API key held
by the server; the key never reaches a client.

A small read-only REST surface (`GET /api/realtime/sessions`, `GET /api/realtime/sessions/:sessionId`)
exposes live session state and latency metrics through the repository's normal
controller → service → repository layers, so operators can inspect what the gateway is doing.

**Scope decisions made during the interview:** full cascade (not a proxy to Inworld's own Realtime
API); GA dialect only (no beta event names); Inworld STT VAD for `server_vad` / `semantic_vad` plus
manual commits; sentence-chunked TTS streaming; function calling and text-only turns **in** scope;
G.711 codecs and ephemeral client secrets **out** of scope; **no client authentication in v1 (dev
only)**; LLM model fixed by server configuration; OpenAI voice names aliased to Inworld voices.

## Functional Requirements

### Transport and connection

- The gateway exposes a WebSocket endpoint at `/v1/realtime`, served from the same HTTP server as the
  Express application produced by `createApp()`. The REST routes keep their `/api` prefix; the
  WebSocket path deliberately matches OpenAI's so client base URLs need only the host swapped.
- The optional `?model=` query parameter is accepted and echoed in `session.model` but does **not**
  select the upstream model (see _Model and voice mapping_).
- **No client authentication is performed in v1.** Any `Authorization` header or `OpenAI-Beta`
  header is ignored. This is a development-only posture and must be called out in the README.
- Every message in both directions is a single JSON object with a `type` field. Client events may
  carry an optional `event_id`; every server event carries a server-generated `event_id`, and an
  `error` event caused by a client event echoes that client's `event_id`.
- Each client event is validated against a Zod schema for its `type`. Unknown `type`, malformed JSON,
  or a schema failure produces an `error` event (`type: "invalid_request_error"`) and never closes
  the socket.
- The gateway responds to WebSocket ping frames and closes idle connections after a configurable
  inactivity timeout. On close (either side), all upstream connections and in-flight work for that
  session are torn down and the session is removed from the live-session repository.

### Session lifecycle

- On connection, the gateway creates a session with a unique `sess_…` id and immediately sends
  `session.created` containing the full effective configuration with defaults applied.
- `session.update` performs a **partial merge** into the current configuration and replies with
  `session.updated` carrying the full effective configuration. Fields not mentioned are unchanged.
- Supported session fields (GA schema): `type` (always `"realtime"`), `model` (echo only),
  `instructions`, `output_modalities` (`["audio"]` or `["text"]`), `audio.input.format`,
  `audio.input.transcription`, `audio.input.turn_detection`, `audio.output.format`,
  `audio.output.voice`, `audio.output.speed`, `tools`, `tool_choice`, `temperature`,
  `max_output_tokens`.
- `audio.input.transcription` is always effectively enabled (the cascade requires a transcript); its
  `model` value is accepted and echoed but the gateway always uses the configured Inworld STT model.
- Changing `audio.output.voice` while a response is in progress is rejected with an `error` event
  (mirrors OpenAI, which forbids changing voice mid-response); otherwise it takes effect for the
  next response.
- Changing a field that alters the STT stream configuration (turn detection parameters, input format)
  reconfigures the upstream STT connection for subsequent audio without losing audio already
  buffered.

### Audio formats

- Input format supported in v1: `{ type: "audio/pcm", rate: 24000 }` — 16-bit signed little-endian
  mono PCM at 24 kHz, base64 encoded in `input_audio_buffer.append`. Any other input format in
  `session.update` is rejected with an `error` event.
- Output format supported in v1: `{ type: "audio/pcm", rate: 24000 }` — the gateway asks Inworld TTS
  for LINEAR16 at 24 kHz so no output conversion is needed.
- The gateway converts client audio to the sample rate the Inworld STT stream is configured for
  (16 kHz by default) before forwarding. The conversion is internal and invisible to the client.
- A single `input_audio_buffer.append` payload larger than 15 MiB is rejected with an `error` event.

### Input audio and turn detection

- `input_audio_buffer.append` audio is forwarded to the session's Inworld STT stream as it arrives
  and also retained in the current input buffer (so `commit` can produce a conversation item and
  `clear` can discard it). No acknowledgement is sent for `append`.
- `input_audio_buffer.clear` discards the un-committed buffer and replies `input_audio_buffer.cleared`.
- **Turn detection modes**:
  - `turn_detection: null` — manual mode. The gateway never commits automatically. The client sends
    `input_audio_buffer.commit` (which signals end-of-turn to STT) and then `response.create`.
  - `turn_detection.type: "server_vad"` — Inworld STT's voice-activity events drive the turn.
    `threshold` maps to the STT VAD threshold and `silence_duration_ms` to the STT end-of-turn silence
    parameters; `prefix_padding_ms` is accepted and echoed.
  - `turn_detection.type: "semantic_vad"` — as above but relies on Inworld STT's confidence-based
    end-of-turn detection; `eagerness` (`low` / `medium` / `high` / `auto`) maps to the
    end-of-turn confidence threshold.
  - In both automatic modes `create_response` (default `true`) controls whether a response is started
    automatically at end-of-turn and `interrupt_response` (default `true`) controls barge-in.
- When STT reports speech start, the gateway sends `input_audio_buffer.speech_started` with
  `audio_start_ms` measured from the start of the buffer. When STT reports end-of-turn, the gateway
  sends `input_audio_buffer.speech_stopped` with `audio_end_ms`, commits the buffer, and (if
  `create_response` is true) starts a response.
- A commit — manual or automatic — produces, in order: `input_audio_buffer.committed`
  (`previous_item_id`, `item_id`), `conversation.item.added` and `conversation.item.done` for a new
  `message` item with role `user` and an `input_audio` content part (audio itself is not echoed
  back), then `conversation.item.input_audio_transcription.delta` events as interim STT results
  arrive and one `conversation.item.input_audio_transcription.completed` with the final transcript.
- Committing an empty buffer (no audio since the last commit/clear) produces an `error` event
  (`input_audio_buffer_commit_empty`) and no item.
- The response for a turn must not be sent to the LLM until the final transcript for that turn is
  available; interim transcripts are never used as LLM input.

### Text input and conversation items

- `conversation.item.create` accepts `message` items with `input_text` (role `user`), `text` (role
  `assistant`, for seeding history), and `system` role; and `function_call_output` items. Each
  accepted item is stored in the conversation and acknowledged with `conversation.item.created`
  (GA also emits `conversation.item.added` / `conversation.item.done`; the gateway emits all three
  for compatibility with either reading of the spec). `previous_item_id` is honoured for insertion
  order; `"root"` inserts at the beginning.
- `conversation.item.delete` removes an item and replies `conversation.item.deleted`; an unknown
  `item_id` produces an `error` event.
- `conversation.item.retrieve` returns the stored item via `conversation.item.retrieved`, including
  the transcript of user audio items.
- `conversation.item.truncate` (assistant audio items only) trims the stored transcript to the
  portion that had been played by `audio_end_ms`. In v1 the cut point is **proportional** to the
  synthesized audio duration (exact word-timestamp alignment is an open question). It replies
  `conversation.item.truncated`. Truncating a non-assistant or non-audio item, or an `audio_end_ms`
  beyond the item's audio length, produces an `error` event.
- When `output_modalities` is `["text"]`, a response produces `response.output_text.delta` /
  `response.output_text.done` and no TTS work is started; a text-only turn (`input_text` +
  `response.create`) with audio modality still produces spoken audio plus its transcript.

### Response generation

- `response.create` starts a response. Only **one response may be active per session**; a second
  `response.create` while one is active is rejected with an `error` event
  (`conversation_already_has_active_response`). Optional per-response overrides in
  `response.{instructions, output_modalities, voice, tools, tool_choice, temperature,
max_output_tokens, metadata}` apply to that response only; `response.conversation: "none"`
  runs the response out-of-band without writing its output into the session history, and
  `response.input` supplies an explicit item list for such responses.
- The LLM request is built from: the effective `instructions` as the system prompt, the conversation
  items in order (user/assistant messages using transcripts for audio items, function calls and
  their outputs), the session `tools` / `tool_choice`, `temperature`, and `max_output_tokens`.
  Streaming is always requested.
- Server events for an audio response, in order: `response.created` (status `in_progress`),
  `response.output_item.added` (a `message` item, role `assistant`),
  `response.content_part.added` (`type: "audio"`), then interleaved
  `response.output_audio_transcript.delta` and `response.output_audio.delta` events, then
  `response.output_audio_transcript.done`, `response.output_audio.done`,
  `response.content_part.done`, `response.output_item.done`, `conversation.item.done`, and
  finally `response.done` (status `completed`) carrying `usage`.
- **Sentence-chunked synthesis:** LLM tokens are accumulated and split at sentence boundaries; each
  completed sentence (or the trailing remainder when the LLM finishes) is sent to the response's TTS
  context and flushed, and its text is emitted as one `response.output_audio_transcript.delta`
  **before** the corresponding audio deltas. Audio deltas are relayed to the client as soon as each
  TTS chunk arrives; audio for sentence _n+1_ is never emitted before the audio for sentence _n_ is
  complete. The first audio delta must not wait for the LLM to finish.
- Each response uses a **dedicated TTS context** on the session's TTS WebSocket, identified by the
  response id, so that cancelling the response only discards that response's audio.
- `response.done.usage` reports input/output token counts from the LLM Router when available, plus
  the input audio milliseconds transcribed and output characters synthesized for this response.
- `rate_limits.updated` is emitted after each `response.done` with placeholder limits (the gateway
  has no real limits in v1); the event exists so clients that expect it do not break.

### Function calling

- Session `tools` (OpenAI `function` tool definitions) and `tool_choice` are passed through to the
  LLM Router in OpenAI format.
- When the LLM streams a tool call, the gateway emits `response.output_item.added` with a
  `function_call` item (`name`, `call_id`), `response.function_call_arguments.delta` events as the
  arguments stream, `response.function_call_arguments.done`, `response.output_item.done`, and
  `response.done`. No TTS work is started for a function-call item.
- The client supplies the result with `conversation.item.create` of type `function_call_output`
  (`call_id`, `output`) and then sends `response.create`; the gateway includes the call and its
  output in the next LLM request. A `function_call_output` whose `call_id` does not match a stored
  call produces an `error` event.
- A response may contain both text/audio and a function call; items are emitted in the order the
  LLM produced them.

### Interruption and cancellation

- `response.cancel` (with or without `response_id`) aborts the active response: the LLM stream is
  aborted, the response's TTS context is closed, no further deltas are sent, and `response.done`
  is emitted with status `cancelled`. Cancelling when no response is active produces an
  `error` event (`response_cancel_not_active`).
- **Barge-in:** when turn detection is automatic, `interrupt_response` is true, and STT reports
  speech start while a response is active, the gateway cancels that response exactly as above
  (emitting `input_audio_buffer.speech_started` first). The assistant item keeps the transcript
  generated so far; the client is expected to send `conversation.item.truncate` to align it with
  what was actually played.
- Audio deltas that were already relayed cannot be recalled; the gateway never emits a delta for a
  cancelled response after `response.done`.

### Upstream orchestration and configuration

- **STT:** one Inworld STT WebSocket per session, opened when the session is created and configured
  from the session settings (model, language, encoding, sample rate, VAD parameters). If the
  upstream socket drops, the gateway reconnects transparently; audio received while disconnected is
  buffered and flushed on reconnect, up to a bounded size.
- **TTS:** one Inworld TTS WebSocket per session, opened lazily at the first audio response and kept
  open; one context per response with the effective voice, model, and 24 kHz LINEAR16 output.
- **LLM:** one streaming HTTP request per response to the Router's OpenAI-compatible chat-completions
  endpoint, with an abort handle for cancellation.
- Environment configuration (read once at boot; the server **fails fast** with a clear message if
  `INWORLD_API_KEY` is missing):
  - `INWORLD_API_KEY` — replaces the current `API-KEY` entry in `.env`.
  - `INWORLD_LLM_MODEL` — router id sent as `model` (default `auto`).
  - `INWORLD_STT_MODEL`, `INWORLD_STT_SAMPLE_RATE`, `INWORLD_TTS_MODEL`, `INWORLD_TTS_VOICE`
    (default voice), `INWORLD_BASE_URL` (default `https://api.inworld.ai`, overridable so tests can
    point at fakes), `SESSION_IDLE_TIMEOUT_MS`, `PORT`.
- **Model mapping:** the LLM model is always `INWORLD_LLM_MODEL`; the client's `session.model` is
  echoed but never honoured.
- **Voice mapping:** an alias table maps the OpenAI voice names (`alloy`, `ash`, `ballad`, `coral`,
  `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`) to configured Inworld voices; any other
  value is passed through to Inworld as a voice id. An invalid voice surfaces as an `error` event
  when synthesis fails, not as a session-update failure.
- Each upstream stage is defined by an interface with an Inworld implementation, wired through the
  DI container, so tests substitute fakes without touching the orchestration.

### Error mapping

- All client-visible failures are `error` events with `error.{type, code, message, param, event_id}`.
  `type` is `invalid_request_error` for client mistakes and `server_error` for upstream/internal
  failures.
- Upstream failures are surfaced per stage with stable codes (`stt_unavailable`,
  `llm_request_failed`, `tts_unavailable`, …). A failure during a response ends that response with
  `response.done` status `failed` and a `status_details.error`; the session stays open and usable.
- An upstream authentication failure (bad Inworld key) is reported once as a `server_error` and the
  gateway closes the session with a WebSocket close code indicating a server-side configuration
  error, since nothing will work.
- An exception in the handling of a single client event never crashes the process or closes other
  sessions.

### Live-session REST endpoints

- `GET /api/realtime/sessions` lists live sessions (`sessionId`, `createdAt`, `state`, item count,
  turn detection mode, output modalities, voice) in the standard `{ message, data, errors }`
  envelope.
- `GET /api/realtime/sessions/:sessionId` returns one session with its metrics: number of turns,
  last time-to-first-transcript, last time-to-first-audio (from end-of-turn to first audio delta),
  last LLM time-to-first-token, cumulative transcribed audio ms and synthesized characters.
  Unknown id → 404. Sessions disappear from these endpoints when their WebSocket closes.
- Both endpoints are read-only; no REST endpoint creates, mutates, or closes a session.

### Testing

- Functional tests boot the real application with **fake Inworld services** running in-process:
  a fake STT WebSocket server that emits scripted `speechStarted` / interim / final / `speechStopped`
  results, a fake LLM endpoint that streams scripted tokens (and tool calls), and a fake TTS
  WebSocket server that returns deterministic audio bytes per flushed text. Tests connect as a real
  WebSocket client and assert on the exact server-event sequence.
- A **live smoke test** exercises one full audio turn against the real Inworld services, and is
  skipped automatically when `INWORLD_API_KEY` is not set.
- Unit tests cover the sentence splitter, sample-rate conversion, session config merge/validation,
  the voice alias table, and the response state machine (including cancellation paths).

### Documentation

- `README.md` and `CLAUDE.md` are updated to describe the WebSocket edge alongside the REST layers,
  the event flow, the environment variables, the no-auth caveat, and how to run the live smoke test.

## Possible Edge Cases

- Client sends `input_audio_buffer.append` before any `session.update` → defaults apply (24 kHz PCM,
  `server_vad`); it must just work.
- Client sends audio while the STT upstream is still connecting → buffered and flushed in order once
  the stream is ready; nothing is dropped and no `error` is emitted.
- `input_audio_buffer.commit` in manual mode with STT still holding audio → the gateway signals
  end-of-turn upstream and waits for the final transcript before the item's `completed` event; the
  `committed` event is not delayed.
- Commit with an empty buffer → `error` (`input_audio_buffer_commit_empty`), no item created.
- Two `response.create` in a row → second rejected with `conversation_already_has_active_response`;
  the first continues untouched.
- `response.create` while the final transcript for the last committed turn is still pending → the
  response waits for the transcript rather than sending an empty user message.
- End-of-turn detected but the final transcript is empty or whitespace (noise, cough) → the item is
  still created with an empty transcript; **no** response is auto-started, and if a client manually
  requests one the LLM is called with the empty turn omitted.
- Barge-in arrives before the first audio delta of a response → response cancelled with no audio
  ever sent; the assistant item may have an empty transcript.
- Barge-in arrives between two sentences → audio for the current sentence stops at the next chunk
  boundary; the next sentence is never synthesized.
- Speech start with `interrupt_response: false` → the response continues; the new user audio is
  still transcribed and becomes the next turn.
- `response.cancel` racing with natural completion → whichever `response.done` is emitted first
  wins; exactly one `response.done` per response.
- LLM stream ends with no sentence terminator (trailing fragment) → the remainder is synthesized and
  transcribed as the final delta.
- LLM produces a very long single sentence (> TTS per-message limit) → split at the last clause or
  whitespace boundary under the limit; never sent oversized upstream.
- Sentence splitter must not split on abbreviations, decimals, or ellipses (`"Dr. Smith"`,
  `"3.14"`, `"wait…"`), and must treat `?` and `!` as terminators.
- LLM returns a tool call and text in the same response → two output items in LLM order; only the
  message item is synthesized.
- `function_call_output` with unknown `call_id` → `error`; `response.create` with a pending tool
  call lacking output → the LLM is called anyway (mirrors OpenAI) and the missing output is not
  fabricated.
- `conversation.item.truncate` with `audio_end_ms` of 0 → transcript becomes empty; beyond the
  synthesized length → `error`.
- `conversation.item.delete` of the item a response is currently writing → `error` rather than a
  half-deleted item.
- Voice change via `session.update` during an active response → `error`; after the response → applied.
- Unknown session field or unsupported `audio.input.format` → `error` naming the `param`; the rest
  of the update is **not** applied (atomic update).
- Malformed base64 in `append` → `error`, buffer unchanged.
- Client disconnects mid-response → LLM aborted, TTS context closed, STT closed, session removed;
  no writes to a closed socket.
- Inworld STT socket drops mid-turn → reconnect; the partial turn's audio already sent upstream is
  lost, so the gateway re-sends the retained un-committed buffer and surfaces one `server_error`
  only if reconnection ultimately fails.
- Inworld TTS fails for one sentence → the response ends with status `failed`, transcript deltas
  already sent remain valid, and the session continues.
- LLM Router returns a non-streaming error body (4xx/5xx) → `response.done` status `failed` with the
  upstream message; no partial assistant item is left in `in_progress`.
- Two sessions must be fully isolated: audio, items, upstream sockets, and metrics never cross
  between connections.
- Idle session (no client events, no audio) beyond the timeout → closed with a descriptive close
  reason and removed from the live-session list.
- `GET /api/realtime/sessions/:sessionId` for a session that just closed → 404, not a stale record.

## Acceptance Criteria

- Connecting to `ws://<host>/v1/realtime` yields a `session.created` event whose `session` has
  `type: "realtime"`, a `sess_…` id, `audio.input.format.type: "audio/pcm"` at `24000`,
  `audio.input.turn_detection.type: "server_vad"`, and `output_modalities: ["audio"]`.
- `session.update` with `instructions` and `audio.output.voice: "marin"` returns `session.updated`
  reflecting both, and the next response is synthesized with the aliased Inworld voice.
- `session.update` with `audio.input.format.rate: 16000` returns an `error` event with
  `param: "session.audio.input.format"` and the session configuration is unchanged.
- **Automatic turn (server_vad):** streaming a spoken utterance via `input_audio_buffer.append`
  produces, in order, `input_audio_buffer.speech_started`, `input_audio_buffer.speech_stopped`,
  `input_audio_buffer.committed`, `conversation.item.added`, ≥1
  `conversation.item.input_audio_transcription.delta`,
  `conversation.item.input_audio_transcription.completed` with the final transcript, then a full
  response sequence ending in `response.done` with status `completed` — with no `response.create`
  sent by the client.
- **Manual turn (`turn_detection: null`):** no `speech_*` or `committed` events are emitted until
  the client sends `input_audio_buffer.commit`; a response starts only on `response.create`.
- Every audio response emits at least one `response.output_audio_transcript.delta` **before** the
  first `response.output_audio.delta`, and the concatenated transcript deltas equal
  `response.output_audio_transcript.done.transcript`.
- Concatenating all `response.output_audio.delta` payloads of a response yields the bytes the TTS
  fake produced for each sentence, in sentence order.
- With the fake LLM scripted to stream three sentences, the first `response.output_audio.delta` is
  emitted before the fake has finished streaming the third sentence.
- A text-only session (`output_modalities: ["text"]`) with a `conversation.item.create`
  (`input_text`) + `response.create` yields `response.output_text.delta` events and
  `response.output_text.done`, and the TTS fake receives no requests.
- Sending `response.create` twice while the first is active returns one `error` with code
  `conversation_already_has_active_response`, and exactly one `response.done` follows.
- `response.cancel` during an active response yields `response.done` with status `cancelled`, no
  further `response.output_audio.delta`, and the TTS fake observes the response's context closed.
- With `interrupt_response: true`, a scripted `speechStarted` from the STT fake during an active
  response produces `input_audio_buffer.speech_started` followed by `response.done` with status
  `cancelled`; with `interrupt_response: false` the response completes normally.
- `conversation.item.truncate` on the cancelled assistant item with `audio_end_ms` at roughly half
  the synthesized duration returns `conversation.item.truncated`, and a subsequent
  `conversation.item.retrieve` shows a transcript shorter than the original.
- A session with `tools` defined, where the fake LLM streams a tool call, produces
  `response.output_item.added` (`type: "function_call"`), ≥1
  `response.function_call_arguments.delta`, `response.function_call_arguments.done`, and
  `response.done`; after `function_call_output` + `response.create`, the fake LLM receives the
  call and its output in the message history.
- Committing an empty buffer returns an `error` with code `input_audio_buffer_commit_empty` and
  creates no item.
- Malformed JSON and an unknown event `type` each return an `error` event and the socket remains
  open and usable.
- A scripted TTS failure produces `response.done` with status `failed` and a `status_details.error`;
  a subsequent turn on the same session succeeds.
- Two concurrent WebSocket clients complete independent turns with no cross-talk in items,
  transcripts, or audio.
- `GET /api/realtime/sessions` lists the open sessions in the `{ message, data, errors }` envelope;
  `GET /api/realtime/sessions/:sessionId` returns the session with metric fields after one turn, and
  404 after the client disconnects.
- Booting with `INWORLD_API_KEY` unset exits with a clear error before listening.
- The live smoke test (run only when `INWORLD_API_KEY` is set) completes one real audio turn: a
  non-empty user transcript, at least one audio delta, and `response.done` status `completed`.
- `npm run build` passes and `npm test` passes without network access.

## Open Questions

Resolved during spec definition:

- Cascade or proxy? => **Full cascade**: gateway orchestrates Inworld STT → LLM Router → TTS with
  swappable adapters. Inworld's own Realtime API is not used.
- Which protocol dialect? => **GA only**; event naming isolated so a beta shim could be added later.
- How is end-of-turn detected? => **Inworld STT VAD** backs `server_vad` / `semantic_vad`;
  `turn_detection: null` manual mode is also supported. No local VAD.
- How is LLM output voiced? => **Sentence-chunked** streaming into one TTS WebSocket context per
  response.
- Optional features in v1? => **Function calling** and **text-only turns** are in; G.711 codecs and
  ephemeral client secrets are out.
- Client authentication? => **None in v1 (dev only)**; documented as unsafe outside local use.
- Testing? => **Fake upstreams** for deterministic functional tests plus a **live smoke test** gated
  on the API key.
- How does `session.model` map? => **Server-configured router only** (`INWORLD_LLM_MODEL`); client
  value echoed, never honoured.
- Voice names? => **Alias table** for OpenAI voice names, **passthrough** for Inworld voice ids.
- Configuration? => Rename `.env` key to **`INWORLD_API_KEY`** plus the `INWORLD_*` settings above;
  fail fast when missing.
- Observability? => **Read-only REST** `GET /api/realtime/sessions[/:sessionId]`.
- PoC? => Mostafa Fard.

Still open:

- Should `conversation.item.truncate` use TTS word timestamps for an exact cut instead of the proportional estimate assumed here?
- Does Inworld STT accept 24 kHz LINEAR16 natively (which would remove the in-gateway sample-rate conversion), or must the gateway always convert to 16 kHz?
- What are the exact mappings from OpenAI `server_vad.threshold` / `silence_duration_ms` and `semantic_vad.eagerness` to Inworld's VAD threshold, end-of-turn confidence, and silence parameters? Defaults will be chosen empirically during implementation.
- Which Inworld voices should the ten OpenAI aliases resolve to?
- Should there be a maximum session duration and a maximum number of concurrent sessions, and what happens when the limit is reached (refuse upgrade vs. queue)?
- Should `rate_limits.updated` be omitted entirely rather than emitted with placeholder values?
- Should the sentence splitter be language-aware (CJK punctuation, no-space languages), or is English-style punctuation sufficient for v1?
- Should a beta-dialect compatibility mode, G.711 codecs, ephemeral client secrets, and a real client-auth scheme be scheduled as follow-up specs?

For all open questions, go with the best design that you think required for now, also the simplest one for now.
