import { Inject, Service } from 'typedi';

import { NotFoundError } from '../common/errors/NotFoundError';
import { CloseRealtimeSessionContext } from '../contexts/realtimeSession/CloseRealtimeSessionContext';
import { FindRealtimeSessionContext } from '../contexts/realtimeSession/FindRealtimeSessionContext';
import { ListRealtimeSessionContext } from '../contexts/realtimeSession/ListRealtimeSessionContext';
import { OpenRealtimeSessionContext } from '../contexts/realtimeSession/OpenRealtimeSessionContext';
import { UpdateRealtimeSessionContext } from '../contexts/realtimeSession/UpdateRealtimeSessionContext';
import { RealtimeSessionState } from '../enums/RealtimeSessionState';
import { RealtimeSession } from '../models/RealtimeSession';
import { RealtimeSessionMetrics } from '../models/RealtimeSessionMetrics';
import { InMemoryRealtimeSessionRepository } from '../repositories/InMemoryRealtimeSessionRepository';
import { IRealtimeSessionService } from './interfaces/IRealtimeSessionService';

/**
 * RealtimeSession orchestration: enforces business rules, maps contexts to models,
 * and delegates persistence to the repository. Throws `AppError` subclasses,
 * which `ErrorHandlerMiddleware` maps to HTTP responses.
 */
@Service()
export class RealtimeSessionService implements IRealtimeSessionService {
  constructor(@Inject() private readonly realtimeSessionRepository: InMemoryRealtimeSessionRepository) {}

  /**
   * Lists every open realtime session. No business rules apply to a list call;
   * the repository already excludes `CLOSED` sessions from its default query.
   */
  public async list(_context: ListRealtimeSessionContext): Promise<RealtimeSession[]> {
    return this.realtimeSessionRepository.findAll();
  }

  /**
   * Finds a single live realtime session by id. Throws `NotFoundError` when no
   * open session exists for the given id (closed sessions are excluded by the repository).
   */
  public async find(context: FindRealtimeSessionContext): Promise<RealtimeSession> {
    const session = await this.realtimeSessionRepository.findById(context.sessionId);
    if (!session) {
      throw new NotFoundError('Realtime session not found').addError('sessionId', 'no live session with this id');
    }
    return session;
  }

  /**
   * Opens a new realtime session for a freshly connected socket. No business-rule
   * checks apply: the context carries already-validated session options. Builds the
   * model with `state = IDLE`, `itemCount = 0` and zeroed metrics, then delegates to
   * the repository, which assigns `sessionId` + `createdAt`. The returned record's
   * `sessionId` is what the gateway sends in `session.created`.
   */
  public async open(context: OpenRealtimeSessionContext): Promise<RealtimeSession> {
    const metrics = new RealtimeSessionMetrics();
    metrics.turns = 0;
    metrics.lastTimeToFirstTranscriptMs = null;
    metrics.lastTimeToFirstAudioMs = null;
    metrics.lastLlmTimeToFirstTokenMs = null;
    metrics.transcribedAudioMs = 0;
    metrics.synthesizedCharacters = 0;

    const session = new RealtimeSession();
    session.state = RealtimeSessionState.IDLE;
    session.itemCount = 0;
    session.model = context.model;
    session.turnDetectionType = context.turnDetectionType;
    session.outputModalities = [...context.outputModalities];
    session.voice = context.voice;
    session.metrics = metrics;

    return this.realtimeSessionRepository.create(session);
  }

  /**
   * Updates the stored snapshot of a live realtime session. Loads by id (`NotFoundError`
   * if absent), shallow-merges the snapshot fields that the context carries and
   * deep-merges `metrics`, then saves through the repository. Fields are tested with
   * `!== undefined` (not truthiness) because `turnDetectionType` and the `last*Ms`
   * metrics may legitimately be `null`.
   */
  public async update(context: UpdateRealtimeSessionContext): Promise<RealtimeSession> {
    const session = await this.realtimeSessionRepository.findById(context.sessionId);
    if (!session) {
      throw new NotFoundError('Realtime session not found').addError('sessionId', 'no live session with this id');
    }

    if (context.state !== undefined) {
      session.state = context.state;
    }
    if (context.itemCount !== undefined) {
      session.itemCount = context.itemCount;
    }
    if (context.turnDetectionType !== undefined) {
      session.turnDetectionType = context.turnDetectionType;
    }
    if (context.outputModalities !== undefined) {
      session.outputModalities = [...context.outputModalities];
    }
    if (context.voice !== undefined) {
      session.voice = context.voice;
    }
    if (context.metrics !== undefined) {
      const definedMetrics = Object.fromEntries(
        Object.entries(context.metrics).filter(([, value]) => value !== undefined),
      ) as Partial<RealtimeSessionMetrics>;
      Object.assign(session.metrics, definedMetrics);
    }

    const saved = await this.realtimeSessionRepository.update(session);
    if (!saved) {
      throw new NotFoundError('Realtime session not found').addError('sessionId', 'no live session with this id');
    }
    return saved;
  }

  /**
   * Closes a live realtime session. Loads by id (`NotFoundError` if absent), marks the
   * snapshot `state = CLOSED`, removes the record from the repository, and returns the
   * final snapshot so the caller can emit a closing event with the last-known state.
   */
  public async close(context: CloseRealtimeSessionContext): Promise<RealtimeSession> {
    const session = await this.realtimeSessionRepository.findById(context.sessionId);
    if (!session) {
      throw new NotFoundError('Realtime session not found').addError('sessionId', 'no live session with this id');
    }

    session.state = RealtimeSessionState.CLOSED;
    await this.realtimeSessionRepository.delete(context.sessionId);
    return session;
  }
}
