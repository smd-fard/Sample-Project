/**
 * Every `error.code` the realtime gateway can emit on the wire, in one place.
 * Codes are lower-snake-case strings in the OpenAI Realtime GA dialect.
 */
export const RealtimeErrorCodes = {
  INVALID_JSON: 'invalid_json',
  UNKNOWN_EVENT_TYPE: 'unknown_event_type',
  INVALID_VALUE: 'invalid_value',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  INVALID_BASE64: 'invalid_base64',
  UNSUPPORTED_AUDIO_FORMAT: 'unsupported_audio_format',
  INPUT_AUDIO_BUFFER_COMMIT_EMPTY: 'input_audio_buffer_commit_empty',
  CONVERSATION_ALREADY_HAS_ACTIVE_RESPONSE: 'conversation_already_has_active_response',
  RESPONSE_CANCEL_NOT_ACTIVE: 'response_cancel_not_active',
  ITEM_NOT_FOUND: 'item_not_found',
  ITEM_IN_USE: 'item_in_use',
  ITEM_TRUNCATE_INVALID: 'item_truncate_invalid',
  CALL_ID_NOT_FOUND: 'call_id_not_found',
  VOICE_CHANGE_DURING_RESPONSE: 'voice_change_during_response',
  STT_UNAVAILABLE: 'stt_unavailable',
  LLM_REQUEST_FAILED: 'llm_request_failed',
  TTS_UNAVAILABLE: 'tts_unavailable',
  UPSTREAM_AUTH_FAILED: 'upstream_auth_failed',
  INTERNAL_ERROR: 'internal_error',
} as const;

/** Union of every wire-level realtime error code. */
export type RealtimeErrorCode = (typeof RealtimeErrorCodes)[keyof typeof RealtimeErrorCodes];
