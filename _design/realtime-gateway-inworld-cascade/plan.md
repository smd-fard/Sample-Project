# Implementation Plan — Realtime Gateway (Inworld Cascade)

> Source spec: `./spec.md` (feature `realtime-gateway-inworld-cascade`, PoC: Mostafa Fard).

## Context

Clients written against the OpenAI Realtime API (GA dialect) should be able to point their base URL at
this server and get a working voice agent without code changes. Internally the gateway runs a cascaded
pipeline on Inworld services — streaming STT (with Inworld's VAD driving turn-taking), the LLM Router
over its OpenAI-compatible chat-completions endpoint, and streaming TTS with one synthesis context per
response — and relays 24 kHz PCM audio plus aligned transcripts back over the client's WebSocket. A small
read-only REST surface (`GET /api/realtime/sessions[/:sessionId]`) exposes live sessions and latency
metrics through the normal controller → service → repository layers so operators can see what the
gateway is doing.

## Approach

The feature has two halves. The **REST half** (live-session listing/detail) is built exactly like any
resource in this repo with the define-* skills, in dependency order: enum + models → response DTOs →
contexts → in-memory repository → service → controller. The **WebSocket half** is a new edge that sits
beside the controllers under `src/realtime/`; it is hand-written (no define-* skill produces it) but
follows the same conventions — `@Service()` classes with constructor injection, `validateDto` for every
inbound client event, `AppError` subclasses for every failure (a `RealtimeError` subclass carries the
OpenAI `type`/`code`/`param` triple), and it writes its live state into the session repository **only
through `RealtimeSessionService`**, never touching the repository directly. Every upstream stage
(STT / LLM / TTS) is an interface with an `Inworld*` implementation registered in the typedi container
so the orchestration never knows which one it is talking to.

Key decisions: `ws` is added as the only new runtime dependency (server socket, upstream STT/TTS
sockets, and test clients); the LLM Router is called with Node's built-in `fetch` and a hand-rolled SSE
reader; configuration is a single `RealtimeConfig` object loaded once at boot (`process.loadEnvFile()`
then `process.env`) that fails fast on a missing `INWORLD_API_KEY` and is placed into the container
before the gateway is resolved, so tests can inject a config pointing at in-process fake Inworld
servers. `createApp()` keeps its signature (REST only); a new `createHttpServer(app, config)` wraps it
in `http.Server` and attaches the gateway at `/v1/realtime`. Sentence-chunked TTS uses one Inworld TTS
context per response with explicit `flush` per sentence, which preserves sentence order and lets a
cancel discard exactly that response's audio.

For the still-open questions the plan takes the simplest workable defaults: proportional truncation;
always resample 24 kHz → `INWORLD_STT_SAMPLE_RATE` (default 16 kHz); a fixed empirical VAD mapping
(`threshold × 0.3` → `vadThreshold`, `silence_duration_ms` → `maxTurnSilence`, eagerness → end-of-turn
confidence); a static ten-entry voice alias table; no session/concurrency caps; `rate_limits.updated`
emitted with placeholders; an English-punctuation sentence splitter. Beta dialect, G.711, ephemeral
secrets and client auth are deferred.

## Implementation steps

### 1. Dependencies and configuration

Create:

- `src/config/RealtimeConfig.ts` — plain class `RealtimeConfig` with fields `inworldApiKey`,
  `inworldBaseUrl` (default `https://api.inworld.ai`), `llmModel` (default `auto`), `sttModel`
  (default `inworld/inworld-stt-1`), `sttSampleRate` (default `16000`), `ttsModel` (default
  `inworld-tts-2-flash`), `ttsVoice` (default `Ashley`), `sessionIdleTimeoutMs` (default `300000`),
  `port` (default `3000`). Exported `loadRealtimeConfig(env: NodeJS.ProcessEnv): RealtimeConfig` reads
  `INWORLD_API_KEY`, `INWORLD_BASE_URL`, `INWORLD_LLM_MODEL`, `INWORLD_STT_MODEL`,
  `INWORLD_STT_SAMPLE_RATE`, `INWORLD_TTS_MODEL`, `INWORLD_TTS_VOICE`, `SESSION_IDLE_TIMEOUT_MS`,
  `PORT`, applies defaults, coerces numbers, and throws a plain `Error` whose message names the missing
  `INWORLD_API_KEY` (the boot code prints it and exits 1). Tests construct `RealtimeConfig` directly.
  The class is the typedi token: boot and tests call `Container.set(RealtimeConfig, config)` before
  resolving anything that injects it.

Modify:

- `package.json` — add dependency `ws` and devDependency `@types/ws`; add script `test:live`
  (`vitest run test/live`). No other new packages: `fetch`, `AbortController`, `process.loadEnvFile`
  are built into Node ≥ 22.
- `.env` — rename `API-KEY` to `INWORLD_API_KEY` (same value); add commented examples for the other
  `INWORLD_*` variables and `SESSION_IDLE_TIMEOUT_MS`.

### 2. Enum + Models for `realtimeSession`

Follow the define-enum / define-model skill templates exactly.

Create:

- `src/enums/RealtimeSessionState.ts` — `RealtimeSessionState { IDLE, RESPONDING, CLOSED }`. `IDLE`
  = connected, no active response; `RESPONDING` = a response is in flight; `CLOSED` = socket gone
  (set just before the record is deleted; excluded from default repository queries).
- `src/models/RealtimeSessionMetrics.ts` — plain class: `turns` (number), `lastTimeToFirstTranscriptMs`
  (number | null), `lastTimeToFirstAudioMs` (number | null), `lastLlmTimeToFirstTokenMs`
  (number | null), `transcribedAudioMs` (number), `synthesizedCharacters` (number).
- `src/models/RealtimeSession.ts` — plain class: `sessionId` (server-owned, `sess_` + 32 hex chars —
  the field is named `sessionId` rather than `realtimeSessionId` because the spec fixes the REST field
  name), `createdAt`, `state: RealtimeSessionState`, `itemCount`, `turnDetectionType`
  (`'server_vad' | 'semantic_vad' | null`), `outputModalities: string[]`, `voice`, `model` (the echoed
  client model), `metrics: RealtimeSessionMetrics`.

### 3. Response DTOs for `realtimeSession`

Follow the define-dto response template. There are **no request DTOs** — both endpoints are read-only.

Create:

- `src/dtos/realtimeSession/responses/RealtimeSessionResponse.ts` — `RealtimeSessionResponseSchema`
  (`sessionId`, `createdAt`, `state` as `z.enum(RealtimeSessionState)`, `itemCount`,
  `turnDetection` (`'server_vad' | 'semantic_vad' | null`), `outputModalities: string[]`, `voice`),
  inferred type, `RealtimeSessionResponseBuilder`.
- `src/dtos/realtimeSession/responses/RealtimeSessionDetailResponse.ts` —
  `RealtimeSessionDetailResponseSchema` = list shape extended with `metrics` (object schema mirroring
  `RealtimeSessionMetrics`), inferred type, `RealtimeSessionDetailResponseBuilder`.

### 4. Contexts for `realtimeSession`

Follow the define-context template. Five verbs: two for REST, three for the gateway.

Create:

- `src/contexts/realtimeSession/ListRealtimeSessionContext.ts` — `traceId` only; builder.
- `src/contexts/realtimeSession/FindRealtimeSessionContext.ts` — `traceId`, `sessionId`; builder.
- `src/contexts/realtimeSession/OpenRealtimeSessionContext.ts` — `traceId`, `model` (echoed query
  param or config default), `turnDetectionType`, `outputModalities`, `voice`; builder. Used by the
  gateway at connection time.
- `src/contexts/realtimeSession/UpdateRealtimeSessionContext.ts` — `traceId`, `sessionId`, and an
  optional partial snapshot: `state?`, `itemCount?`, `turnDetectionType?`, `outputModalities?`,
  `voice?`, `metrics?` (partial `RealtimeSessionMetrics`); builder with one setter per field. Used by
  the gateway after `session.updated`, every commit, and every `response.done`.
- `src/contexts/realtimeSession/CloseRealtimeSessionContext.ts` — `traceId`, `sessionId`; builder.

### 5. Repository for `RealtimeSession`

Follow the define-repository templates.

Create:

- `src/repositories/interfaces/RealtimeSessionRepository.ts` — `create(session)`, `findById(id)`,
  `findAll()`, `update(session): Promise<RealtimeSession | null>` (replace by id, null if absent),
  `delete(id): Promise<boolean>`.
- `src/repositories/InMemoryRealtimeSessionRepository.ts` — `@Service()` hashmap; `create()` assigns
  `sessionId = 'sess_' + randomUUID() without dashes` (the one deviation from the template's bare
  UUID — the id is client-visible and must look like OpenAI's) and `createdAt`; clone on read/write;
  `findAll()` excludes `state === CLOSED`; `delete()` removes the key; `clear()` for tests.

Modify:

- `test/functional/BaseFunctionalTest.ts` — `resetStores()` calls
  `Container.get(InMemoryRealtimeSessionRepository).clear()`.

### 6. Service for `realtimeSession`

Follow the define-service templates (`@Service()`, `@Inject()` of the concrete in-memory repository,
context in → model out, `AppError` subclasses only).

Create:

- `src/services/interfaces/IRealtimeSessionService.ts` — signatures for `list`, `find`, `open`,
  `update`, `close`.
- `src/services/RealtimeSessionService.ts` —
  - `list(context): Promise<RealtimeSession[]>` — `findAll()` (the one method returning an array).
  - `find(context): Promise<RealtimeSession>` — `NotFoundError('Realtime session not found')` with
    field `sessionId` when absent.
  - `open(context): Promise<RealtimeSession>` — builds the model with `state = IDLE`, `itemCount = 0`,
    zeroed metrics, and delegates to `create()`; returns the record whose `sessionId` the gateway
    then sends in `session.created`.
  - `update(context): Promise<RealtimeSession>` — loads by id (`NotFoundError` if absent), shallow-
    merges the snapshot fields and deep-merges `metrics`, saves via `update()`.
  - `close(context): Promise<RealtimeSession>` — loads (`NotFoundError` if absent), sets
    `state = CLOSED`, deletes the record, returns the final snapshot.
- `src/services/RealtimeSessionService.test.ts` — unit tests (see step 14).

### 7. Controller for `realtimeSession`

Follow the define-controller templates, with one deliberate deviation: the spec fixes the paths as
`/api/realtime/sessions`, so the class is `@JsonController('/realtime/sessions')` rather than the
plural-resource default.

Create:

- `src/controllers/interfaces/IRealtimeSessionController.ts` — `list()` and `find(sessionId)`.
- `src/controllers/RealtimeSessionController.ts` — `@Get()` `list` → `ApiResult.data('Realtime
  sessions listed', RealtimeSessionResponse[])`; `@Get('/:sessionId')` `find` → `ApiResult.data(
  'Realtime session found', RealtimeSessionDetailResponse)`. Private `toResponse` /
  `toDetailResponse` mappers (model → DTO). Both build their context with `randomUUID()` trace ids.

Modify:

- `src/index.ts` — register `RealtimeSessionController` in `createApp()`'s `controllers` array.

### 8. Realtime protocol module (OpenAI GA dialect)

Hand-written, under `src/realtime/protocol/`. These are Zod schemas and typed factories, not REST DTOs,
so they do not use `BaseBuilder`; validation still goes through `validateDto`.

Create:

- `src/realtime/protocol/RealtimeErrorCodes.ts` — `const` map of every stable error code:
  `invalid_json`, `unknown_event_type`, `invalid_value`, `payload_too_large`, `invalid_base64`,
  `unsupported_audio_format`, `input_audio_buffer_commit_empty`,
  `conversation_already_has_active_response`, `response_cancel_not_active`, `item_not_found`,
  `item_in_use`, `item_truncate_invalid`, `call_id_not_found`, `voice_change_during_response`,
  `stt_unavailable`, `llm_request_failed`, `tts_unavailable`, `upstream_auth_failed`,
  `internal_error`.
- `src/realtime/protocol/RealtimeError.ts` — `class RealtimeError extends AppError` with
  `type: 'invalid_request_error' | 'server_error'` and optional `param`; static constructors
  `invalidRequest(code, message, param?)` (status 400) and `serverError(code, message)` (status 500).
  Also `toErrorEvent(error: unknown, clientEventId?: string)` which maps: `RealtimeError` → its own
  fields; `ValidationError` → `invalid_request_error` / `invalid_value` with `param` = the first
  field path (prefixed with the event's top-level key, e.g. `session.audio.input.format`) and its
  message; any other `AppError` → `invalid_request_error` with the lower-cased `code`; anything else →
  `server_error` / `internal_error` (message only, no stack).
- `src/realtime/protocol/ids.ts` — `newItemId()` (`item_`), `newResponseId()` (`resp_`),
  `newEventId()` (`event_`), `newCallId()` (`call_`), each prefix + 32 hex chars.
- `src/realtime/protocol/items.ts` — TypeScript types + Zod schemas for conversation items on the
  wire: `message` (roles `user` | `assistant` | `system`; content parts `input_text`, `input_audio`
  (`transcript`, never audio bytes), `text`, `output_audio` (`transcript`)), `function_call`
  (`name`, `call_id`, `arguments`), `function_call_output` (`call_id`, `output`); item `status`
  (`in_progress` | `completed` | `incomplete`). `ConversationItemCreateSchema` is the client-supplied
  subset (no `status`, optional `id`).
- `src/realtime/protocol/sessionConfig.ts` — `SessionConfigSchema` (strict `z.object`s, so unknown
  fields produce a `param`): `type: 'realtime'`, `model`, `instructions`, `output_modalities`
  (`['audio']` | `['text']`), `audio.input.format` (must be exactly `{ type: 'audio/pcm', rate: 24000 }`
  via `refine`, error path `audio.input.format`), `audio.input.transcription` (`model` echoed),
  `audio.input.turn_detection` (`null` | `server_vad` {`threshold` 0–1 default 0.5,
  `prefix_padding_ms` default 300, `silence_duration_ms` default 500, `create_response` default true,
  `interrupt_response` default true} | `semantic_vad` {`eagerness` low|medium|high|auto default auto,
  `create_response`, `interrupt_response`}), `audio.output.format` (same 24 kHz PCM refine),
  `audio.output.voice`, `audio.output.speed` (0.25–1.5 default 1), `tools` (OpenAI `function` tool
  schema), `tool_choice` (`auto` | `none` | `required` | named function), `temperature` (0.6–1.2
  default 0.8), `max_output_tokens` (positive int | `'inf'`). `SessionUpdateSchema` = deep-partial of
  the same (strict). `defaultSessionConfig(config: RealtimeConfig, model?: string)` builds the
  effective defaults (voice = `config.ttsVoice`, `model` = query param or `config.llmModel`,
  transcription model `inworld-stt`). `mergeSessionConfig(current, patch)` deep-merges (arrays and
  `turn_detection` replaced wholesale, objects merged), re-validates the merged result, and throws a
  `RealtimeError` (`invalid_value`, `param` = `session.<path>`) **before** anything is assigned —
  atomic update. `ResponseCreateSchema` = optional `response.{instructions, output_modalities,
  voice, tools, tool_choice, temperature, max_output_tokens, metadata, conversation: 'auto' | 'none',
  input: item[]}`.
- `src/realtime/protocol/clientEvents.ts` — `ClientEventEnvelopeSchema` (`type: string`,
  `event_id?: string`) plus one schema per supported client event, exported in a
  `CLIENT_EVENT_SCHEMAS` map keyed by `type`: `session.update` (`session: SessionUpdateSchema`),
  `input_audio_buffer.append` (`audio: string`, max 15 MiB of base64 checked by length before
  decoding), `input_audio_buffer.commit`, `input_audio_buffer.clear`, `conversation.item.create`
  (`item`, `previous_item_id?`), `conversation.item.retrieve` (`item_id`), `conversation.item.truncate`
  (`item_id`, `content_index`, `audio_end_ms` ≥ 0), `conversation.item.delete` (`item_id`),
  `response.create` (`response?`), `response.cancel` (`response_id?`). `parseClientEvent(raw: string)`
  does JSON.parse (→ `invalid_json`), envelope validation, schema lookup (→ `unknown_event_type` with
  `param: 'type'`), then `validateDto(payload, schema)`.
- `src/realtime/protocol/serverEvents.ts` — `ServerEventType` const map holding every emitted event
  name in one place (`session.created`, `session.updated`, `error`, `input_audio_buffer.speech_started`,
  `.speech_stopped`, `.committed`, `.cleared`, `conversation.item.created`, `.added`, `.done`,
  `.retrieved`, `.deleted`, `.truncated`, `conversation.item.input_audio_transcription.delta`,
  `.completed`, `response.created`, `response.done`, `response.output_item.added`, `.done`,
  `response.content_part.added`, `.done`, `response.output_text.delta`, `.done`,
  `response.output_audio_transcript.delta`, `.done`, `response.output_audio.delta`, `.done`,
  `response.function_call_arguments.delta`, `.done`, `rate_limits.updated`), typed payload interfaces
  for each, and a `ServerEvents` factory whose methods return payloads with a fresh `event_id`. Isolating
  the names here is what makes a future beta shim a one-file change. `response.done` payload carries
  `status`, optional `status_details` (`{ type: 'cancelled', reason }` or `{ type: 'failed', error }`),
  `output` items and `usage` (`input_tokens`, `output_tokens`, `total_tokens`, plus
  `input_audio_ms` and `output_characters` in `input_token_details`/`output_token_details`-style
  extension fields). `rate_limits.updated` payload = placeholder `requests`/`tokens` entries.

### 9. Audio and text utilities

Create:

- `src/realtime/audio/pcm.ts` — `PCM_24K_BYTES_PER_MS = 48`; `decodeBase64Pcm(audio: string): Buffer`
  (strict base64 validation → `RealtimeError invalid_base64`; even byte length enforced);
  `pcmDurationMs(bytes, sampleRate)`.
- `src/realtime/audio/PcmResampler.ts` — stateful class `PcmResampler(fromRate, toRate)` with
  `process(chunk: Buffer): Buffer` doing linear interpolation on int16 LE mono, carrying the fractional
  read position and last sample across chunks so chunk boundaries do not click; identity when rates
  match. `reset()`.
- `src/realtime/audio/SentenceSplitter.ts` — class with `push(text: string): string[]` (returns
  completed sentences) and `flush(): string | null` (trailing remainder). Terminators `.`, `!`, `?`
  followed by whitespace or end-of-text, plus closing quotes/brackets; **not** split on decimals
  (`3.14`), a fixed abbreviation list (`Dr.`, `Mr.`, `Mrs.`, `Ms.`, `St.`, `vs.`, `e.g.`, `i.e.`,
  `etc.`, single-letter initials), or ellipses (`...`, `…`). Constructor option `maxChars` (default
  500): when the pending fragment exceeds it, cut at the last `,;:` or whitespace under the limit so
  nothing oversized is ever sent to TTS. Whitespace-only fragments are dropped.
- `src/realtime/audio/VoiceAliases.ts` — `OPENAI_VOICE_ALIASES` static table for the ten OpenAI names
  (`alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`) → Inworld
  library voice ids (initial picks: Ashley, Dennis, Craig, Olivia, Mark, Elizabeth, Sarah, Timothy,
  Hades, Alex — verify against the voice library during implementation); `resolveVoice(name,
  fallback)` returns the alias, else passes the value through as an Inworld id, else the fallback.

### 10. Upstream adapters (interfaces + Inworld implementations)

Create under `src/realtime/upstream/`:

- `interfaces/SttClient.ts` — `SttStreamOptions` (`model`, `sampleRate`, `language?`, `vadThreshold`,
  `endOfTurnConfidenceThreshold`, `maxTurnSilenceMs`, `minEndOfTurnSilenceWhenConfidentMs`);
  `SttStreamHandlers` (`onSpeechStarted(startTimeMs)`, `onSpeechStopped()`, `onTranscript(text,
  isFinal)`, `onUsage(transcribedAudioMs)`, `onError(error: RealtimeError)`, `onClosed()`);
  `SttStream` (`sendAudio(pcm: Buffer)`, `endTurn()`, `reconfigure(options)`, `close()`);
  `SttClient` (`open(options, handlers): SttStream` — returns immediately; audio sent before the socket
  is ready is queued in order).
- `interfaces/LlmClient.ts` — `LlmChatRequest` (`model`, `messages` in OpenAI chat format, `tools?`,
  `tool_choice?`, `temperature?`, `max_tokens?`); `LlmStreamEvent` union (`text` delta, `tool_call`
  {`index`, `id?`, `name?`, `argumentsDelta`}, `usage` {`inputTokens`, `outputTokens`}, `done`
  {`finishReason`}); `LlmClient` (`streamChat(request, signal: AbortSignal): AsyncIterable<LlmStreamEvent>`).
- `interfaces/TtsClient.ts` — `TtsContextOptions` (`voiceId`, `modelId`, `sampleRate`,
  `speakingRate?`); `TtsContextHandlers` (`onAudio(pcm: Buffer)`, `onFlushCompleted()`,
  `onClosed()`, `onError(error: RealtimeError)`); `TtsContext` (`sendText(text)`, `flush()`,
  `close()`); `TtsConnection` (`createContext(contextId, options, handlers): TtsContext`, `close()`);
  `TtsClient` (`connect(): TtsConnection` — lazy, returns immediately, queues until open).
- `inworld/InworldSttClient.ts` — `@Service()`, injects `RealtimeConfig`. Opens
  `wss://<base>/stt/v1/transcribe:streamBidirectional` (`http(s)` → `ws(s)`) with
  `Authorization: Basic <key>`; first frame `transcribeConfig` {`modelId`, `audioEncoding: LINEAR16`,
  `sampleRateHertz`, `numberOfChannels: 1`, `language?`, `endOfTurnConfidenceThreshold`,
  `inworldSttV1Config: { vadThreshold, maxTurnSilence, minEndOfTurnSilenceWhenConfident }`}; audio as
  `{ audioChunk: { content: <base64> } }`; `endTurn: {}`; `closeStream: {}` on close. Parses
  `result.transcription` (`transcript`, `isFinal`), `result.speechStarted` (`startTimeMs`),
  `result.speechStopped`, `result.usage` (`transcribedAudioMs`), `result.status` (error). Pre-open
  queue; on unexpected close (not initiated by `close()`), reconnect with 3 attempts at 250/500/1000 ms,
  re-send `transcribeConfig`, then replay a bounded (5 MiB, oldest dropped) buffer of the current turn's
  audio (cleared on `endTurn` / final transcript); if all attempts fail call `onError(stt_unavailable)`
  once. A 401/403 on upgrade calls `onError(upstream_auth_failed)`. `reconfigure()` closes and reopens
  with the new options without dropping queued audio.
- `inworld/InworldLlmClient.ts` — `@Service()`, injects `RealtimeConfig`. `POST
  <base>/v1/chat/completions` with `Authorization: Bearer <key>`, body = request + `stream: true` +
  `stream_options: { include_usage: true }`, `signal` forwarded. Non-2xx → reads the body and throws
  `RealtimeError.serverError('llm_request_failed', message)` (401/403 → `upstream_auth_failed`).
  Reads the body as SSE (`data:` lines, `[DONE]` sentinel), yielding `text` for
  `choices[0].delta.content`, `tool_call` for `delta.tool_calls[]`, `usage` from the final usage chunk,
  `done` with `finish_reason`. Abort → the iterator ends silently (caller decides status).
- `inworld/InworldTtsClient.ts` — `@Service()`, injects `RealtimeConfig`. One `ws` per
  `connect()` to `wss://<base>/tts/v1/voice:streamBidirectional`, `Authorization: Basic <key>`.
  Messages: `{ create: { voiceId, modelId, audioConfig: { audioEncoding, sampleRateHertz,
  speakingRate? } }, contextId }`, `{ send_text: { text }, contextId }`, `{ flush_context: {},
  contextId }`, `{ close_context: {}, contextId }`; a 30 s keepalive `send_text` with empty text while
  open. Incoming `result.contextId` routes to the right context: `contextCreated`, `audioChunk.audioContent`
  (base64 → Buffer → `onAudio`), `flushCompleted`, `contextClosed`, `status` (→ `onError(tts_unavailable)`).
  Messages for an unknown/closed context are dropped. Connection drop → every open context gets
  `onError`; the next `connect()` builds a fresh socket. The encoding string (`LINEAR16` vs `PCM`) is a
  single constant to adjust — see Risks.

### 11. Session core (buffer, conversation, response runner, session runtime)

Create under `src/realtime/session/`:

- `InputAudioBuffer.ts` — holds the un-committed 24 kHz PCM chunks; `append(bytes)`, `durationMs`,
  `isEmpty`, `take(): { bytes, durationMs }` (returns and resets), `clear()`, and
  `totalAppendedMs` (monotonic, for `audio_start_ms` / `audio_end_ms` measured from buffer start).
- `Conversation.ts` — ordered store of `StoredItem { item, audioDurationMs? }`. `insert(item,
  previousItemId?)` (`'root'` → index 0, `undefined` → append, unknown id → `item_not_found`), `get`,
  `delete` (`item_not_found`; `item_in_use` when the item is the one an active response is writing),
  `truncateAssistantAudio(itemId, audioEndMs)` (assistant `output_audio` items only; `audio_end_ms >
  audioDurationMs` → `item_truncate_invalid`; keeps `floor(len × audio_end_ms / durationMs)` chars,
  backed off to a word boundary; 0 → empty), `findFunctionCall(callId)`, `count`,
  `toLlmMessages(instructions)` → OpenAI chat messages: system first (when non-empty), user/assistant
  message text from `input_text`/`text`/transcripts, assistant `tool_calls` for `function_call` items,
  `tool` role for `function_call_output`; user items with an empty/whitespace transcript are omitted.
- `ResponseRunner.ts` — one response's state machine. Constructed with the response id, the effective
  per-response settings (session config merged with `response.create` overrides), the LLM messages,
  the target `Conversation` (or `null` for `conversation: 'none'`), the event sink, the `LlmClient`, a
  TTS-context provider, and metric callbacks. `start()` emits `response.created`, opens an
  `AbortController`, and consumes the LLM stream: first text token → `response.output_item.added`
  (assistant `message`, status `in_progress`, inserted into the conversation when in-band) +
  `response.content_part.added` (`audio` or `text`); for the audio modality every completed sentence
  from the `SentenceSplitter` is emitted as one `response.output_audio_transcript.delta`, then
  `sendText` + `flush` on the response's TTS context (`contextId = responseId`) and
  `pendingFlushes++`; for the text modality every token is a `response.output_text.delta`. Tool-call
  deltas open a `function_call` item (`response.output_item.added` with `name`/`call_id` — upstream id
  or `newCallId()`), stream `response.function_call_arguments.delta`, and close with
  `.done` + `response.output_item.done` in LLM order (a message item open at that moment is closed
  first). Audio chunks arriving on the context are relayed immediately as
  `response.output_audio.delta` (base64) and accumulate `audioDurationMs` on the item. When the LLM
  stream ends, the splitter remainder is sent/flushed; completion waits for `pendingFlushes === 0`,
  then emits `response.output_audio_transcript.done`, `response.output_audio.done`,
  `response.content_part.done`, `response.output_item.done`, `conversation.item.done` (in-band only),
  `response.done` (`completed`, with usage: LLM tokens when reported, `input_audio_ms`,
  `output_characters`), and `rate_limits.updated`. `cancel(reason)` aborts the LLM, closes the TTS
  context, marks the runner settled so late audio is dropped, closes open items as `incomplete`, and
  emits `response.done` `cancelled` with `status_details.reason` (`client_cancelled` |
  `turn_detected`). Any LLM/TTS error → `response.done` `failed` with `status_details.error`
  {`type`, `code`, `message`}. A single `settle(status)` guard guarantees exactly one `response.done`
  no matter how completion, cancel and failure race. Exposes `responseId`, `writingItemId`,
  `isSettled`, and `onSettled` callback.
- `SessionRuntime.ts` — the per-connection orchestrator (plain class, one per socket, constructed by
  the gateway with the session record, `RealtimeConfig`, `RealtimeSessionService`, the three upstream
  clients, and the event sink). Owns the effective `SessionConfig`, `InputAudioBuffer`, `Conversation`,
  `PcmResampler`, the `SttStream` (opened on construction from the session config; VAD options from
  the mapping in step 10/Approach; manual mode sends `vadThreshold: 0`), a lazily created
  `TtsConnection`, `activeResponse: ResponseRunner | null`, a FIFO of committed user turns awaiting
  their final transcript and a FIFO of finals awaiting a turn (paired whenever both are non-empty, so
  it does not matter whether Inworld sends the final before or after `speechStopped`), pending interim
  text, timestamps for metrics, and `lastActivityAt`.
  Client-event handlers (all synchronous; long work is started, not awaited, so `response.cancel` and
  audio are never queued behind a response): `updateSession` (voice change while responding →
  `voice_change_during_response`, atomic merge, `session.updated`, reconfigure STT if input format or
  turn detection changed, snapshot to the service), `appendAudio` (decode, append, resample, forward),
  `clearAudio`, `commitAudio` (empty → `input_audio_buffer_commit_empty`; else `endTurn` upstream and
  `commitTurn()`), `createItem` (`function_call_output` with unknown `call_id` → `call_id_not_found`;
  emit `created`, `added`, `done`), `retrieveItem`, `truncateItem`, `deleteItem`, `createResponse`
  (active → `conversation_already_has_active_response`; sets `activeResponse` synchronously, then
  starts the runner after the newest committed turn's final transcript resolves; `conversation:
  'none'` uses `response.input` and no conversation writes), `cancelResponse` (none active →
  `response_cancel_not_active`).
  STT handlers: `onSpeechStarted` (auto modes only: emit `speech_started` with `audio_start_ms =
  buffer.totalAppendedMs`; barge-in when `interrupt_response` and a response is active),
  `onSpeechStopped` (auto modes only: emit `speech_stopped`, `commitTurn()`, and when
  `create_response` is true auto-start a response once the final arrives and is non-empty),
  `onTranscript` (interim → buffered until the turn item exists, then
  `input_audio_transcription.delta` with the new suffix — or the full text on a rewrite; final →
  paired with the oldest waiting turn → `.completed`, TTFT-transcript metric), `onError`
  (`upstream_auth_failed` → one `error` event then close the socket with code 1011; otherwise an
  `error` event and, if a response is active, fail it).
  `commitTurn()` emits `input_audio_buffer.committed` (`previous_item_id`, `item_id`),
  `conversation.item.added`, `conversation.item.done` for a new user `input_audio` item, bumps
  `turns` and `transcribedAudioMs`, and snapshots to the service. Idle timer: checks every
  `min(idleTimeout / 2, 10 s)`; on expiry closes with code 1000 and reason `session_idle_timeout`.
  `close()` (from either side, idempotent): cancel the active response, close STT/TTS, clear timers,
  `RealtimeSessionService.close`.

### 12. Gateway, connection and server bootstrap

Create:

- `src/realtime/RealtimeConnection.ts` — wraps one `ws` socket: `send(event)` (skips when the socket
  is not `OPEN`), `on('message')` → `parseClientEvent` → `runtime.handle(event)` inside a try/catch
  whose only outlet is `send(toErrorEvent(err, event_id))`, so no client event can throw past the
  connection; `on('close')`/`on('error')` → `runtime.close()`; `close(code, reason)`. `ws` answers
  ping frames automatically.
- `src/realtime/RealtimeGateway.ts` — `@Service()`; injects `RealtimeConfig`,
  `RealtimeSessionService`, `InworldSttClient`, `InworldLlmClient`, `InworldTtsClient`.
  `attach(server: http.Server): RealtimeGatewayHandle` creates a `WebSocketServer({ server, path:
  '/v1/realtime' })`; on each connection parses `?model=`, calls `sessionService.open(...)`, builds the
  `SessionRuntime` + `RealtimeConnection`, sends `session.created`, and tracks the runtime in the
  handle. `RealtimeGatewayHandle.close()` closes every live session and the `WebSocketServer`
  (used by tests and shutdown). Attaching to several servers is supported (each test file gets its
  own).

Modify:

- `src/index.ts` — keep `createApp()` (now registering `RealtimeSessionController`); add exported
  `createHttpServer(app: Application, config: RealtimeConfig): { server: http.Server; gateway:
  RealtimeGatewayHandle }` which does `Container.set(RealtimeConfig, config)`, `http.createServer(app)`,
  and `Container.get(RealtimeGateway).attach(server)`. The `require.main === module` block becomes:
  `process.loadEnvFile()` in a try/catch (missing `.env` is fine), `loadRealtimeConfig(process.env)`
  in a try/catch that prints the message and `process.exit(1)`, then `createHttpServer(createApp(),
  config).server.listen(config.port)`; a `SIGINT`/`SIGTERM` handler closes the gateway handle and the
  server.

### 13. Test infrastructure (fake Inworld services)

Create:

- `test/fakes/FakeInworldServer.ts` — one `http.Server` on port 0 exposing: `POST
  /v1/chat/completions` (records every request body in `llm.requests`; pops the next script from
  `llm.scripts` — a script is a list of `{ text }` / `{ toolCall: { name, arguments: string[] } }`
  chunks with an optional `delayMs`, or `{ status, message }` to fail — and streams it as OpenAI SSE
  with a final usage chunk and `[DONE]`; records `llm.chunkSentAt[]` timestamps); an STT
  `WebSocketServer` (`noServer`, upgrade path `/stt/v1/transcribe:streamBidirectional`) whose
  connections record the `transcribeConfig`, audio byte totals and `endTurn` calls, and expose
  `emitSpeechStarted(startTimeMs)`, `emitTranscript(text, isFinal)`, `emitSpeechStopped()`,
  `emitError()`, `drop()` (server-side close to exercise reconnect); an optional per-server
  `stt.script` that runs automatically when the first audio chunk of a turn arrives (used by the
  automatic-turn tests) and an `stt.onEndTurn` final (manual-mode tests); a TTS `WebSocketServer`
  (upgrade path `/tts/v1/voice:streamBidirectional`) that answers `create` with `contextCreated`,
  accumulates `send_text`, on `flush_context` emits `audioChunk`s whose bytes are the deterministic
  `FakeInworldServer.audioFor(text)` (UTF-8 bytes of the text, zero-padded to an even length, split in
  two chunks) followed by `flushCompleted`, answers `close_context` with `contextClosed`, records
  `tts.contexts` (id, options, texts, closed flag), and supports `tts.failNextFlush`. Optional
  `rejectAuth` makes both upgrades and the LLM route return 401. `start(): Promise<string>` (base
  URL), `stop()`.
- `test/functional/realtime/RealtimeTestClient.ts` — thin `ws` client: `connect(url)`,
  `send(event)`, `next()`, `waitFor(type, predicate?, timeoutMs)`, `collectUntil(type)`, `events`
  (everything received, in order), `close()`; `pcmSilence(ms)` and `base64Pcm(buffer)` helpers;
  `sendAudio(buffer, chunkMs)` streams `input_audio_buffer.append` frames.
- `test/functional/realtime/BaseRealtimeTest.ts` — extends `BaseFunctionalTest`: `setup()` starts a
  `FakeInworldServer`, builds a `RealtimeConfig` (fake base URL, dummy key, 2 s idle timeout for the
  idle test only), calls `createHttpServer(this.app, config)`, listens on port 0, exposes `wsUrl`,
  `fake`, and `gateway`; `teardown()` closes the gateway handle, the server and the fake. `resetStores()`
  inherited.

Modify:

- `test/functional/BaseFunctionalTest.ts` — as in step 5 (clear the session store).

### 14. Tests

Unit (co-located, Vitest, constructor-injected stubs, no typedi):

- `src/realtime/audio/SentenceSplitter.test.ts` — `.`/`!`/`?` terminators, abbreviations, decimals,
  ellipses, trailing remainder on `flush`, `maxChars` clause/whitespace cut, whitespace-only drops.
- `src/realtime/audio/PcmResampler.test.ts` — 24 k → 16 k length ratio, identity, chunk-boundary
  continuity on a ramp signal, odd-byte rejection.
- `src/realtime/audio/VoiceAliases.test.ts` — alias hit, passthrough, empty → fallback.
- `src/realtime/protocol/sessionConfig.test.ts` — defaults, partial merge leaves other fields intact,
  unknown field and bad input format rejected with the right `param` and no mutation, turn-detection
  replacement, `null` turn detection.
- `src/realtime/protocol/clientEvents.test.ts` — malformed JSON, unknown type, schema failure param
  mapping, oversized append.
- `src/realtime/session/Conversation.test.ts` — insert root/previous/append, delete unknown/in-use,
  proportional truncate (half, zero, beyond), `toLlmMessages` (system first, empty user turn omitted,
  tool call + output round trip).
- `src/realtime/session/InputAudioBuffer.test.ts` — duration math, take/clear, monotonic offset.
- `src/realtime/session/ResponseRunner.test.ts` — stub LLM (async generator) + stub TTS context:
  completed sequence order, transcript delta before first audio delta, text modality emits no TTS,
  tool-call item sequence, cancel before first audio, cancel between sentences (second sentence never
  sent), TTS error → `failed`, LLM error → `failed`, cancel racing completion → exactly one
  `response.done`, usage fields.
- `src/realtime/upstream/inworld/InworldLlmClient.test.ts` — SSE parsing over a stubbed `fetch`
  (text, tool-call deltas, usage, `[DONE]`, non-2xx → `llm_request_failed`, 401 →
  `upstream_auth_failed`, abort ends iteration).
- `src/services/RealtimeSessionService.test.ts` — `find` not-found, `open` sets defaults, `update`
  merges metrics, `close` deletes and returns `CLOSED`.

Functional (`test/functional/`, real app + fake Inworld, real `ws` client, exact event sequences):

- `realtime/SessionLifecycle.test.ts` — `session.created` defaults (`type`, `sess_` id, 24 kHz PCM,
  `server_vad`, `['audio']`); `session.update` merge with `instructions` + `voice: 'marin'` and the
  TTS fake later receiving the aliased voice id; `audio.input.format.rate: 16000` → `error` with
  `param: 'session.audio.input.format'` and unchanged config; unknown field → error, nothing applied;
  malformed JSON and unknown `type` → `error`, socket still usable; voice change during a response →
  error, after → applied; idle timeout closes with the descriptive reason and the session leaves the
  REST list.
- `realtime/AutomaticTurn.test.ts` — full `server_vad` sequence with no `response.create`; ≥1
  transcript delta before the first audio delta and concatenated transcript deltas equal
  `.done.transcript`; concatenated audio equals `audioFor(sentence)` in order; first audio delta before
  the fake finished streaming the third sentence; empty/whitespace final → item created, no response;
  `semantic_vad` variant; `GET /api/realtime/sessions/:id` shows metrics after the turn.
- `realtime/ManualTurn.test.ts` — no `speech_*`/`committed` until `commit`; commit → `committed` +
  item + transcript on `endTurn`; response only on `response.create`; `response.create` before the
  final arrives waits and sends the transcript; empty commit → `input_audio_buffer_commit_empty`;
  `clear` → `cleared`; audio sent before the STT fake accepts the socket is not lost.
- `realtime/TextOnly.test.ts` — `output_modalities: ['text']` + `input_text` item → `output_text.delta`
  / `.done`, TTS fake sees no contexts; text-only turn with audio modality still speaks.
- `realtime/ResponseControl.test.ts` — double `response.create` → one error, one `response.done`;
  `response.cancel` → `cancelled`, no further audio, TTS context closed; `response.cancel` with
  nothing active → `response_cancel_not_active`; barge-in with `interrupt_response: true` (STT fake
  `speechStarted` mid-response) → `speech_started` then `response.done cancelled`, and with `false`
  the response completes; `conversation.item.truncate` at half the synthesized duration → `truncated`
  and a shorter transcript on `retrieve`, beyond → error; `delete` unknown → error; `conversation:
  'none'` response leaves the item count unchanged.
- `realtime/FunctionCalling.test.ts` — tools in `session.update`, scripted tool call → `function_call`
  item sequence and `response.done`; `function_call_output` + `response.create` → the fake LLM's next
  request contains the assistant tool call and the tool message; unknown `call_id` → error; mixed
  text + tool call in one response → two items in LLM order and only the message synthesized.
- `realtime/Failures.test.ts` — `tts.failNextFlush` → `response.done failed` with `status_details.error`
  and a following turn succeeds; LLM 500 → `failed`, no `in_progress` item left; STT `drop()` mid-turn →
  reconnect, next transcript still delivered, no `error` unless reconnection fails; `rejectAuth` →
  one `server_error` and close code 1011.
- `realtime/Isolation.test.ts` — two clients run interleaved turns; items, transcripts, audio and
  REST metrics never cross.
- `realtimeSession/ListRealtimeSession.test.ts` — via write-functional-test
  `RealtimeSessionController.list`: empty list envelope, two open sockets → two rows with the expected
  fields, one closes → one row.
- `realtimeSession/FindRealtimeSession.test.ts` — via write-functional-test
  `RealtimeSessionController.find`: 404 unknown id, detail with metrics after a turn, 404 after the
  socket closes.
- `test/live/RealtimeLiveSmoke.test.ts` — `describe.skipIf(!process.env.INWORLD_API_KEY)`, 60 s
  timeout, real `RealtimeConfig` from the environment; obtains a spoken utterance by calling Inworld's
  HTTP TTS once (24 kHz LINEAR16), streams it through `/v1/realtime` in `server_vad` mode and asserts a
  non-empty user transcript, ≥1 audio delta and `response.done completed`.

### 15. Documentation

Modify:

- `README.md` — add a "Realtime WebSocket gateway" section: the `/v1/realtime` endpoint beside the
  `/api` REST layer, the cascade diagram (client ⇄ gateway ⇄ Inworld STT / LLM Router / TTS), the
  client→server and server→client event flow for one turn, the environment variables table, the
  **no client authentication (dev only)** caveat, the fake-server test setup and how to run the live
  smoke test (`INWORLD_API_KEY=… npm run test:live`); extend the directory tree with `src/config/`,
  `src/realtime/`, `test/fakes/`, `test/live/`.
- `CLAUDE.md` — add `src/config/` and `src/realtime/` to the directory layout, a short "WebSocket edge"
  paragraph in the layer flow (gateway → `SessionRuntime` → `RealtimeSessionService`; upstream
  adapters behind interfaces), the new env vars, and the `createHttpServer` bootstrap.

## Critical files

**To create**

- `src/config/RealtimeConfig.ts`
- `src/enums/RealtimeSessionState.ts`
- `src/models/RealtimeSession.ts`, `src/models/RealtimeSessionMetrics.ts`
- `src/dtos/realtimeSession/responses/RealtimeSessionResponse.ts`,
  `src/dtos/realtimeSession/responses/RealtimeSessionDetailResponse.ts`
- `src/contexts/realtimeSession/{List,Find,Open,Update,Close}RealtimeSessionContext.ts`
- `src/repositories/interfaces/RealtimeSessionRepository.ts`,
  `src/repositories/InMemoryRealtimeSessionRepository.ts`
- `src/services/interfaces/IRealtimeSessionService.ts`, `src/services/RealtimeSessionService.ts`,
  `src/services/RealtimeSessionService.test.ts`
- `src/controllers/interfaces/IRealtimeSessionController.ts`, `src/controllers/RealtimeSessionController.ts`
- `src/realtime/protocol/{RealtimeErrorCodes,RealtimeError,ids,items,sessionConfig,clientEvents,serverEvents}.ts`
  (+ `sessionConfig.test.ts`, `clientEvents.test.ts`)
- `src/realtime/audio/{pcm,PcmResampler,SentenceSplitter,VoiceAliases}.ts`
  (+ `PcmResampler.test.ts`, `SentenceSplitter.test.ts`, `VoiceAliases.test.ts`)
- `src/realtime/upstream/interfaces/{SttClient,LlmClient,TtsClient}.ts`
- `src/realtime/upstream/inworld/{InworldSttClient,InworldLlmClient,InworldTtsClient}.ts`
  (+ `InworldLlmClient.test.ts`)
- `src/realtime/session/{InputAudioBuffer,Conversation,ResponseRunner,SessionRuntime}.ts`
  (+ `InputAudioBuffer.test.ts`, `Conversation.test.ts`, `ResponseRunner.test.ts`)
- `src/realtime/{RealtimeConnection,RealtimeGateway}.ts`
- `test/fakes/FakeInworldServer.ts`
- `test/functional/realtime/{RealtimeTestClient,BaseRealtimeTest}.ts`
- `test/functional/realtime/{SessionLifecycle,AutomaticTurn,ManualTurn,TextOnly,ResponseControl,FunctionCalling,Failures,Isolation}.test.ts`
- `test/functional/realtimeSession/{ListRealtimeSession,FindRealtimeSession}.test.ts`
- `test/live/RealtimeLiveSmoke.test.ts`

**To modify**

- `package.json` (add `ws`, `@types/ws`; add `test:live` script)
- `.env` (rename `API-KEY` → `INWORLD_API_KEY`; document the other `INWORLD_*` variables)
- `src/index.ts` (register `RealtimeSessionController`; add `createHttpServer(app, config)`; boot block
  loads `.env`, fails fast on config, attaches the gateway, handles shutdown signals)
- `test/functional/BaseFunctionalTest.ts` (clear `InMemoryRealtimeSessionRepository` in `resetStores()`)
- `README.md`, `CLAUDE.md` (document the WebSocket edge, env vars, no-auth caveat, live smoke test)

## Reuse map

- `AppError` — `src/common/errors/AppError.ts` (base of `RealtimeError`; `code`/`message` carried into
  `error` events)
- `NotFoundError` — `src/common/errors/NotFoundError.ts` (`RealtimeSessionService.find/update/close`,
  rendered as 404 by REST)
- `ValidationError` — `src/common/errors/ValidationError.ts` (thrown by `validateDto` for every client
  event; mapped to `invalid_request_error` with `param` by `toErrorEvent`)
- `BadRequestError` / `ConflictError` — `src/common/errors/` (available; the gateway prefers
  `RealtimeError` so the OpenAI `code` is explicit)
- `validateDto` — `src/common/http/validateDto.ts` (client event schemas, `session.update` patch,
  `response.create` overrides, `conversation.item.create` items)
- `ApiResult` / `ApiEnvelope` — `src/common/http/ApiResult.ts` (REST list/detail responses)
- `BaseBuilder` — `src/common/dto/BaseBuilder.ts` (the two response DTO builders)
- `ErrorHandlerMiddleware` — `src/common/middlewares/ErrorHandlerMiddleware.ts` (REST error rendering;
  untouched)
- `createApp()` — `src/index.ts` (REST app; wrapped by `createHttpServer`)
- `BaseFunctionalTest` — `test/functional/BaseFunctionalTest.ts` (base of `BaseRealtimeTest`; store reset)
- `Container` (typedi) — wiring of `RealtimeConfig`, adapters, gateway, service, repository
- `ws` (`WebSocketServer`, `WebSocket`) — gateway server socket, Inworld STT/TTS client sockets, fake
  servers, test client
- Node built-ins: `http.createServer`, `fetch` + `AbortController` (LLM Router), `crypto.randomUUID`
  (ids), `process.loadEnvFile` (boot)

## Verification

1. `npm install` — pulls `ws` and `@types/ws`.
2. `npm run build` — after each layer (the implement-plan gate) and at the end; `tsc` strict with
   decorators.
3. `npm test` — all unit + functional suites pass **without network access**; the live suite reports
   as skipped when `INWORLD_API_KEY` is unset.
4. Boot check: `INWORLD_API_KEY= npm start` (or unset in `.env`) exits non-zero with a message naming
   `INWORLD_API_KEY` before listening.
5. `npm run dev` with a real key; `curl -s localhost:3000/api/realtime/sessions` returns
   `{ "message": ..., "data": [], "errors": [] }`.
6. Connect a WebSocket client (e.g. `npx wscat -c ws://localhost:3000/v1/realtime`) → first frame is
   `session.created` with `type: "realtime"`, a `sess_` id, 24 kHz PCM formats, `server_vad`,
   `["audio"]`.
7. Send `{"type":"session.update","session":{"audio":{"input":{"format":{"type":"audio/pcm","rate":16000}}}}}`
   → `error` with `param: "session.audio.input.format"`; send `{"type":"nope"}` → `error`, socket stays open.
8. Send `{"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_text","text":"Say hello in one sentence."}]}}`
   then `{"type":"response.create"}` → `response.created` … transcript delta before the first
   `response.output_audio.delta` … `response.done` with `status: "completed"` and `rate_limits.updated`.
9. `curl -s localhost:3000/api/realtime/sessions/<sess_id>` → detail with metric fields; close the
   client; the same curl → 404 envelope.
10. `INWORLD_API_KEY=… npm run test:live` — one real audio turn completes.

## Open items the spec already calls out (no plan change needed)

- Should `conversation.item.truncate` use TTS word timestamps for an exact cut instead of the
  proportional estimate assumed here?
- Does Inworld STT accept 24 kHz LINEAR16 natively (which would remove the in-gateway sample-rate
  conversion), or must the gateway always convert to 16 kHz?
- What are the exact mappings from OpenAI `server_vad.threshold` / `silence_duration_ms` and
  `semantic_vad.eagerness` to Inworld's VAD threshold, end-of-turn confidence, and silence parameters?
  Defaults will be chosen empirically during implementation.
- Which Inworld voices should the ten OpenAI aliases resolve to?
- Should there be a maximum session duration and a maximum number of concurrent sessions, and what
  happens when the limit is reached (refuse upgrade vs. queue)?
- Should `rate_limits.updated` be omitted entirely rather than emitted with placeholder values?
- Should the sentence splitter be language-aware (CJK punctuation, no-space languages), or is
  English-style punctuation sufficient for v1?
- Should a beta-dialect compatibility mode, G.711 codecs, ephemeral client secrets, and a real
  client-auth scheme be scheduled as follow-up specs?

## Risks / things to watch during execution

- **Inworld wire formats are partly inferred.** STT (`transcribeConfig` / `audioChunk` / `endTurn` /
  `result.*`) is documented; the TTS bidirectional message names (`create`, `send_text`,
  `flush_context`, `close_context`, `result.audioChunk.audioContent`, `result.flushCompleted`) and the
  `audioEncoding` string (`LINEAR16` vs `PCM`) come from reference client code, and the LLM Router auth
  scheme (`Bearer` vs the `Basic` used by STT/TTS) must be confirmed. Keep every name in one place per
  adapter (`InworldSttClient`, `InworldTtsClient`, `InworldLlmClient`) and run the live smoke test
  early, before the functional fakes are frozen to the wrong shape.
- **Final transcript vs. `speechStopped` ordering.** Inworld may send the `isFinal` transcript before
  or after `speechStopped`; `SessionRuntime` pairs the two FIFOs (turns awaiting a final, finals
  awaiting a turn) so either order works — do not shortcut this with a single "current turn" field.
- **Exactly one `response.done`.** Completion (LLM done + last `flushCompleted`), `response.cancel`,
  barge-in, TTS/LLM errors and client disconnect all race in `ResponseRunner`; everything must funnel
  through the single `settle(status)` guard, and audio arriving after settle must be dropped.
- **Event handlers must not block on the response.** `createResponse` sets `activeResponse`
  synchronously and starts the runner without awaiting it (only the wait for the pending final
  transcript is deferred inside the runner start), otherwise `response.cancel` and audio frames would
  queue behind a running response.
- **Typedi singletons and per-file config.** Adapters and the gateway inject `RealtimeConfig`; tests
  must `Container.set(RealtimeConfig, …)` (via `createHttpServer`) *before* the first `Container.get`
  in that file. Vitest isolates each test file's module graph, so one config per file is safe; two
  configs in the same file are not.
- **`session.update` atomicity.** Validate the *merged* config and check the voice-change-during-
  response rule before assigning anything; the STT reconfigure must only run after the merge succeeds
  and must not drop audio queued in the adapter.
- **Sample-rate conversion state.** `PcmResampler` carries fractional position across chunks; reset it
  on `input_audio_buffer.clear` and on STT reconfigure, never mid-turn. Odd-length append payloads must
  be rejected before decoding into int16.
- **TTS context lifecycle on a shared socket.** Cancelling must close only the response's context
  (`close_context`), never the connection; a dropped TTS connection must fail the active response and be
  rebuilt lazily on the next audio response. Guard against `contextCreated`/`audioChunk` for a context
  that was already closed.
- **STT reconnect replay.** The adapter-owned replay buffer must be bounded and cleared at turn
  boundaries, and a reconnect during manual mode must not re-send audio that already produced a final.
- **Truncate math.** `audioDurationMs` on the assistant item is derived from bytes actually relayed
  (48 bytes/ms at 24 kHz); it must be updated before the delta is sent so a `truncate` racing the tail
  of a response sees a consistent length.
- **Live test fixture.** The smoke test synthesizes its own utterance through Inworld HTTP TTS; if that
  endpoint's output format differs (container vs raw PCM), strip the header before streaming or the STT
  transcript will be empty.
- **`ws` path filtering and upgrade handling.** With `path: '/v1/realtime'` the `WebSocketServer`
  rejects other upgrade paths itself; the fake Inworld server uses `noServer` and routes upgrades by
  path manually — keep the two patterns distinct.
- **Idle timeout in tests.** Only the idle-timeout test should use a short `sessionIdleTimeoutMs`;
  other suites must use a long one or slow CI will see spurious closes.
- **Repository convention deviations** (custom `sess_` id, `sessionId` field name, `update`/`delete`
  methods, `/realtime/sessions` controller path) are intentional and spec-driven; the implement-plan
  agents must not "correct" them back to the templates.
