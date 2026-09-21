import { randomUUID } from 'crypto';

import { RealtimeConfig } from '../../config/RealtimeConfig';
import { CloseRealtimeSessionContextBuilder } from '../../contexts/realtimeSession/CloseRealtimeSessionContext';
import { UpdateRealtimeSessionContextBuilder } from '../../contexts/realtimeSession/UpdateRealtimeSessionContext';
import { RealtimeSessionState } from '../../enums/RealtimeSessionState';
import { RealtimeSession } from '../../models/RealtimeSession';
import { RealtimeSessionMetrics } from '../../models/RealtimeSessionMetrics';
import { RealtimeSessionService } from '../../services/RealtimeSessionService';
import { decodeBase64Pcm, PCM_SAMPLE_RATE } from '../audio/pcm';
import { PcmResampler } from '../audio/PcmResampler';
import { resolveVoice } from '../audio/VoiceAliases';
import {
  ClientEvent,
  ConversationItemCreateEvent,
  ResponseCreateEvent,
  SessionUpdateEvent,
} from '../protocol/clientEvents';
import { newItemId, newResponseId } from '../protocol/ids';
import { ConversationItem } from '../protocol/items';
import { RealtimeError } from '../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../protocol/RealtimeErrorCodes';
import { ServerEvents, SessionCreatedEvent, SessionObject } from '../protocol/serverEvents';
import { defaultSessionConfig, mergeSessionConfig, SessionConfig, TurnDetection } from '../protocol/sessionConfig';
import { LlmClient } from '../upstream/interfaces/LlmClient';
import { SttClient, SttStream, SttStreamOptions } from '../upstream/interfaces/SttClient';
import { TtsClient, TtsConnection } from '../upstream/interfaces/TtsClient';
import { Conversation } from './Conversation';
import { InputAudioBuffer } from './InputAudioBuffer';
import { EventSink, ResponseRunner } from './ResponseRunner';

/** Everything a `SessionRuntime` needs, supplied by the gateway. */
export interface SessionRuntimeDeps {
  session: RealtimeSession;
  config: RealtimeConfig;
  sessionService: RealtimeSessionService;
  stt: SttClient;
  llm: LlmClient;
  tts: TtsClient;
  emit: EventSink;
  closeSocket: (code: number, reason: string) => void;
  model: string;
}

/** A committed user turn still waiting for its final transcript. */
interface PendingTurn {
  itemId: string;
  committedAt: number;
  resolve: (text: string) => void;
  promise: Promise<string>;
}

/**
 * Per-connection orchestrator: owns the effective session config, the input
 * buffer, the conversation, the STT stream, the lazy TTS connection and the
 * active `ResponseRunner`. All client-event handlers are synchronous; long
 * work is started, never awaited.
 */
export class SessionRuntime {
  public readonly sessionId: string;

  private config: SessionConfig;
  private readonly buffer = new InputAudioBuffer();
  private readonly conversation = new Conversation();
  private resampler: PcmResampler;
  private stt: SttStream | null = null;
  private ttsConnection: TtsConnection | null = null;
  private activeResponse: ResponseRunner | null = null;
  private readonly turnsAwaitingFinal: PendingTurn[] = [];
  private readonly finalsAwaitingTurn: string[] = [];
  private newestTurn: PendingTurn | null = null;
  private pendingInterim = '';
  private closed = false;
  private readonly metrics: RealtimeSessionMetrics;

  constructor(private readonly deps: SessionRuntimeDeps) {
    this.sessionId = deps.session.sessionId;
    this.metrics = deps.session.metrics;
    this.config = defaultSessionConfig(deps.config, deps.model);
    this.resampler = new PcmResampler(PCM_SAMPLE_RATE, deps.config.sttSampleRate);
    this.openStt();
    // TODO: idle timer (sessionIdleTimeoutMs → close 1000 'session_idle_timeout').
  }

  /** The `session.created` payload for this session. */
  public sessionCreatedEvent(): SessionCreatedEvent {
    return ServerEvents.sessionCreated(this.sessionObject());
  }

  /** Dispatches one validated client event. Throws `RealtimeError`/`ValidationError` upward. */
  public handle(event: ClientEvent): void {
    switch (event.type) {
      case 'session.update':
        return this.updateSession(event);
      case 'input_audio_buffer.append':
        return this.appendAudio(event.audio);
      case 'input_audio_buffer.clear':
        this.buffer.clear();
        this.deps.emit(ServerEvents.cleared());
        return;
      case 'input_audio_buffer.commit':
        return this.commitAudio();
      case 'conversation.item.create':
        return this.createItem(event);
      case 'conversation.item.retrieve':
        this.deps.emit(ServerEvents.itemRetrieved(this.conversation.get(event.item_id)));
        return;
      case 'conversation.item.truncate': {
        this.conversation.truncateAssistantAudio(event.item_id, event.content_index, event.audio_end_ms);
        this.deps.emit(ServerEvents.itemTruncated(event.item_id, event.content_index, event.audio_end_ms));
        return;
      }
      case 'conversation.item.delete':
        this.conversation.delete(event.item_id, this.activeResponse?.writingItemId ?? null);
        this.deps.emit(ServerEvents.itemDeleted(event.item_id));
        this.snapshot();
        return;
      case 'response.create':
        return this.createResponse(event);
      case 'response.cancel':
        if (this.activeResponse === null) {
          throw RealtimeError.invalidRequest(
            RealtimeErrorCodes.RESPONSE_CANCEL_NOT_ACTIVE,
            'There is no active response to cancel',
          );
        }
        this.activeResponse.cancel('client_cancelled');
        return;
    }
  }

  /** Tears everything down (idempotent; safe from either side). */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeResponse?.cancel('client_cancelled');
    try {
      this.stt?.close();
    } catch {
      // ignore
    }
    try {
      this.ttsConnection?.close();
    } catch {
      // ignore
    }
    this.deps.sessionService
      .close(new CloseRealtimeSessionContextBuilder().setTraceId(randomUUID()).setSessionId(this.sessionId).build())
      .catch(() => {});
  }

  private sessionObject(): SessionObject {
    return { id: this.sessionId, object: 'realtime.session', ...structuredClone(this.config) };
  }

  private updateSession(event: SessionUpdateEvent): void {
    const requestedVoice = event.session.audio?.output?.voice;
    if (
      requestedVoice !== undefined &&
      requestedVoice !== this.config.audio.output.voice &&
      this.activeResponse !== null
    ) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.VOICE_CHANGE_DURING_RESPONSE,
        'Cannot change the voice while a response is in progress',
        'session.audio.output.voice',
      );
    }
    const previous = this.config;
    this.config = mergeSessionConfig(previous, event.session);
    this.deps.emit(ServerEvents.sessionUpdated(this.sessionObject()));
    if (JSON.stringify(previous.audio.input.turn_detection) !== JSON.stringify(this.config.audio.input.turn_detection)) {
      this.stt?.reconfigure(this.sttOptions());
    }
    this.snapshot();
  }

  private appendAudio(audio: string): void {
    const pcm = decodeBase64Pcm(audio);
    this.buffer.append(pcm);
    this.stt?.sendAudio(this.resampler.process(pcm));
  }

  private commitAudio(): void {
    if (this.buffer.isEmpty) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.INPUT_AUDIO_BUFFER_COMMIT_EMPTY,
        'The input audio buffer is empty',
      );
    }
    this.stt?.endTurn();
    this.commitTurn();
  }

  private createItem(event: ConversationItemCreateEvent): void {
    const draft = event.item;
    if (draft.type === 'function_call_output' && this.conversation.findFunctionCall(draft.call_id) === null) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.CALL_ID_NOT_FOUND,
        `No function_call with call_id '${draft.call_id}'`,
        'item.call_id',
      );
    }
    const id = draft.id ?? newItemId();
    let item: ConversationItem;
    if (draft.type === 'message') {
      item = {
        id,
        object: 'realtime.item',
        type: 'message',
        role: draft.role,
        status: 'completed',
        content: draft.content.map((p) =>
          p.type === 'input_audio' ? { type: 'input_audio' as const, transcript: p.transcript ?? null } : p,
        ),
      };
    } else if (draft.type === 'function_call') {
      item = { id, object: 'realtime.item', type: 'function_call', status: 'completed', name: draft.name, call_id: draft.call_id, arguments: draft.arguments };
    } else {
      item = { id, object: 'realtime.item', type: 'function_call_output', status: 'completed', call_id: draft.call_id, output: draft.output };
    }
    const { previousItemId } = this.conversation.insert(item, event.previous_item_id ?? undefined);
    this.deps.emit(ServerEvents.itemCreated(item, previousItemId));
    this.deps.emit(ServerEvents.itemAdded(item, previousItemId));
    this.deps.emit(ServerEvents.itemDone(item, previousItemId));
    this.snapshot();
  }

  private createResponse(event: ResponseCreateEvent): void {
    if (this.activeResponse !== null) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.CONVERSATION_ALREADY_HAS_ACTIVE_RESPONSE,
        'A response is already in progress',
      );
    }
    const r = event.response ?? {};
    const outOfBand = r.conversation === 'none';
    const instructions = r.instructions ?? this.config.instructions;
    const conversation = outOfBand ? null : this.conversation;
    const runner = new ResponseRunner({
      responseId: newResponseId(),
      settings: {
        instructions,
        outputModalities: r.output_modalities ?? this.config.output_modalities,
        voice: resolveVoice(r.voice ?? this.config.audio.output.voice, this.deps.config.ttsVoice),
        tools: r.tools ?? this.config.tools,
        toolChoice: r.tool_choice ?? this.config.tool_choice,
        temperature: r.temperature ?? this.config.temperature,
        maxOutputTokens: r.max_output_tokens ?? this.config.max_output_tokens,
        speed: this.config.audio.output.speed,
        metadata: r.metadata ?? null,
      },
      messages: [],
      conversation,
      emit: this.deps.emit,
      llm: this.deps.llm,
      llmModel: this.config.model,
      ttsContextFactory: (contextId, handlers) => this.ttsConn().createContext(contextId, {
        voiceId: resolveVoice(r.voice ?? this.config.audio.output.voice, this.deps.config.ttsVoice),
        modelId: this.deps.config.ttsModel,
        sampleRate: PCM_SAMPLE_RATE,
        speakingRate: this.config.audio.output.speed,
      }, handlers),
      inputAudioMs: 0,
      onMetrics: {
        onFirstToken: (ms) => { this.metrics.lastLlmTimeToFirstTokenMs = ms; },
        onFirstAudio: (ms) => { this.metrics.lastTimeToFirstAudioMs = ms; },
        onSynthesized: (chars) => { this.metrics.synthesizedCharacters += chars; },
      },
    });
    this.startRunner(runner, () => {
      if (outOfBand) {
        const inputConv = new Conversation();
        for (const draft of r.input ?? []) {
          inputConv.insert(SessionRuntime.materialize(draft));
        }
        return inputConv.toLlmMessages(instructions);
      }
      return this.conversation.toLlmMessages(instructions);
    });
  }

  /** Sets `activeResponse` synchronously and starts the runner once the newest turn's final transcript resolves. */
  private startRunner(runner: ResponseRunner, buildMessages: () => ReturnType<Conversation['toLlmMessages']>): void {
    this.activeResponse = runner;
    runner.onSettled = () => {
      if (this.activeResponse === runner) this.activeResponse = null;
      this.snapshot();
    };
    this.snapshot();
    const wait = this.newestTurn?.promise ?? Promise.resolve('');
    wait.then(() => {
      if (runner.isSettled) return;
      runner.setMessages(buildMessages());
      void runner.start();
    });
  }

  private static materialize(draft: ConversationItemCreateEvent['item']): ConversationItem {
    const id = draft.id ?? newItemId();
    if (draft.type === 'message') {
      return {
        id, type: 'message', role: draft.role, status: 'completed',
        content: draft.content.map((p) =>
          p.type === 'input_audio' ? { type: 'input_audio' as const, transcript: p.transcript ?? null } : p,
        ),
      };
    }
    if (draft.type === 'function_call') {
      return { id, type: 'function_call', status: 'completed', name: draft.name, call_id: draft.call_id, arguments: draft.arguments };
    }
    return { id, type: 'function_call_output', status: 'completed', call_id: draft.call_id, output: draft.output };
  }

  private ttsConn(): TtsConnection {
    if (this.ttsConnection === null) this.ttsConnection = this.deps.tts.connect();
    return this.ttsConnection;
  }

  // ---- STT -------------------------------------------------------------

  private get turnDetection(): TurnDetection | null {
    return this.config.audio.input.turn_detection;
  }

  private sttOptions(): SttStreamOptions {
    const td = this.turnDetection;
    const base = { model: this.deps.config.sttModel, sampleRate: this.deps.config.sttSampleRate, language: this.config.audio.input.transcription?.language };
    if (td === null) {
      return { ...base, vadThreshold: 0, maxTurnSilenceMs: 60000, endOfTurnConfidenceThreshold: 1, minEndOfTurnSilenceWhenConfidentMs: 160 };
    }
    if (td.type === 'server_vad') {
      return { ...base, vadThreshold: td.threshold * 0.3, maxTurnSilenceMs: td.silence_duration_ms, endOfTurnConfidenceThreshold: 0.5, minEndOfTurnSilenceWhenConfidentMs: 160 };
    }
    const eot = { low: 0.8, medium: 0.6, high: 0.4, auto: 0.6 }[td.eagerness];
    return { ...base, vadThreshold: 0.15, maxTurnSilenceMs: 1200, endOfTurnConfidenceThreshold: eot, minEndOfTurnSilenceWhenConfidentMs: 160 };
  }

  private openStt(): void {
    try {
      this.stt = this.deps.stt.open(this.sttOptions(), {
        onSpeechStarted: () => this.onSpeechStarted(),
        onSpeechStopped: () => this.onSpeechStopped(),
        onTranscript: (text, isFinal) => this.onTranscript(text, isFinal),
        onUsage: (ms) => { this.metrics.transcribedAudioMs += ms; },
        onError: (err) => this.onSttError(err),
        onClosed: () => { this.stt = null; },
      });
    } catch (err) {
      this.stt = null;
      this.onSttError(err instanceof RealtimeError ? err : RealtimeError.serverError(RealtimeErrorCodes.STT_UNAVAILABLE, 'STT unavailable'));
    }
  }

  private onSpeechStarted(): void {
    const td = this.turnDetection;
    if (td === null) return;
    this.deps.emit(ServerEvents.speechStarted(Math.round(this.buffer.totalAppendedMs), newItemId()));
    if (td.interrupt_response && this.activeResponse !== null) this.activeResponse.cancel('turn_detected');
  }

  private onSpeechStopped(): void {
    const td = this.turnDetection;
    if (td === null) return;
    const itemId = newItemId();
    this.deps.emit(ServerEvents.speechStopped(Math.round(this.buffer.totalAppendedMs), itemId));
    if (this.buffer.isEmpty) return;
    const turn = this.commitTurn(itemId);
    if (td.create_response && this.activeResponse === null) {
      turn.promise.then((text) => {
        if (text.trim() !== '' && this.activeResponse === null && !this.closed) {
          this.createResponse({ type: 'response.create' });
        }
      });
    }
  }

  private onTranscript(text: string, isFinal: boolean): void {
    if (!isFinal) {
      this.pendingInterim = text;
      const turn = this.turnsAwaitingFinal[0];
      if (turn !== undefined) this.deps.emit(ServerEvents.inputAudioTranscriptionDelta(turn.itemId, 0, text));
      return;
    }
    this.finalsAwaitingTurn.push(text);
    this.pairFinals();
  }

  private pairFinals(): void {
    while (this.turnsAwaitingFinal.length > 0 && this.finalsAwaitingTurn.length > 0) {
      const turn = this.turnsAwaitingFinal.shift() as PendingTurn;
      const text = this.finalsAwaitingTurn.shift() as string;
      const item = this.conversation.find(turn.itemId);
      if (item !== null && item.type === 'message') {
        this.conversation.replace({ ...item, content: [{ type: 'input_audio', transcript: text }] });
      }
      this.deps.emit(ServerEvents.inputAudioTranscriptionCompleted(turn.itemId, 0, text));
      this.metrics.lastTimeToFirstTranscriptMs = Date.now() - turn.committedAt;
      turn.resolve(text);
    }
    this.snapshot();
  }

  private onSttError(err: RealtimeError): void {
    this.deps.emit(ServerEvents.error(err.toPayload()));
    if (err.code === RealtimeErrorCodes.UPSTREAM_AUTH_FAILED) {
      this.deps.closeSocket(1011, 'upstream_auth_failed');
      return;
    }
    // TODO: STT reconnect handling.
  }

  /** Turns the buffered audio into a committed user `input_audio` item awaiting its transcript. */
  private commitTurn(itemId: string = newItemId()): PendingTurn {
    const { durationMs } = this.buffer.take();
    const item: ConversationItem = {
      id: itemId, object: 'realtime.item', type: 'message', role: 'user', status: 'completed',
      content: [{ type: 'input_audio', transcript: null }],
    };
    const { previousItemId } = this.conversation.insert(item);
    this.deps.emit(ServerEvents.committed(previousItemId, itemId));
    this.deps.emit(ServerEvents.itemAdded(item, previousItemId));
    this.deps.emit(ServerEvents.itemDone(item, previousItemId));
    let resolve: (text: string) => void = () => {};
    const promise = new Promise<string>((res) => { resolve = res; });
    const turn: PendingTurn = { itemId, committedAt: Date.now(), resolve, promise };
    this.turnsAwaitingFinal.push(turn);
    this.newestTurn = turn;
    this.metrics.turns += 1;
    this.metrics.transcribedAudioMs += durationMs;
    this.pendingInterim = '';
    this.pairFinals();
    return turn;
  }

  /** Fire-and-forget snapshot of the session record through the service. */
  private snapshot(): void {
    if (this.closed) return;
    this.deps.sessionService
      .update(
        new UpdateRealtimeSessionContextBuilder()
          .setTraceId(randomUUID())
          .setSessionId(this.sessionId)
          .setState(this.activeResponse === null ? RealtimeSessionState.IDLE : RealtimeSessionState.RESPONDING)
          .setItemCount(this.conversation.count)
          .setTurnDetectionType(this.turnDetection?.type ?? null)
          .setOutputModalities([...this.config.output_modalities])
          .setVoice(this.config.audio.output.voice)
          .setMetrics({ ...this.metrics })
          .build(),
      )
      .catch(() => {});
  }
}
