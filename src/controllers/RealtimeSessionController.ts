import { randomUUID } from 'crypto';
import { Get, JsonController, Param } from 'routing-controllers';
import { Service } from 'typedi';

import { ApiEnvelope, ApiResult } from '../common/http/ApiResult';
import { FindRealtimeSessionContextBuilder } from '../contexts/realtimeSession/FindRealtimeSessionContext';
import { ListRealtimeSessionContextBuilder } from '../contexts/realtimeSession/ListRealtimeSessionContext';
import { RealtimeSessionDetailResponse } from '../dtos/realtimeSession/responses/RealtimeSessionDetailResponse';
import { RealtimeSessionResponse } from '../dtos/realtimeSession/responses/RealtimeSessionResponse';
import { RealtimeSession } from '../models/RealtimeSession';
import { RealtimeSessionService } from '../services/RealtimeSessionService';
import { IRealtimeSessionController } from './interfaces/IRealtimeSessionController';

/**
 * HTTP layer for realtime sessions. Builds a context, delegates to the service,
 * then maps the model to a response DTO inside the uniform envelope.
 * Mounted at `/realtime/sessions` (full path `/api/realtime/sessions`) because the
 * spec fixes that path rather than the plural-resource default.
 */
@Service()
@JsonController('/realtime/sessions')
export class RealtimeSessionController implements IRealtimeSessionController {
  constructor(private readonly realtimeSessionService: RealtimeSessionService) {}

  @Get()
  public async list(): Promise<ApiEnvelope<RealtimeSessionResponse[]>> {
    const context = new ListRealtimeSessionContextBuilder().setTraceId(randomUUID()).build();
    const sessions = await this.realtimeSessionService.list(context);
    return ApiResult.data(
      'Realtime sessions listed',
      sessions.map((session) => this.toResponse(session)),
    );
  }

  @Get('/:sessionId')
  public async find(
    @Param('sessionId') sessionId: string,
  ): Promise<ApiEnvelope<RealtimeSessionDetailResponse>> {
    const context = new FindRealtimeSessionContextBuilder()
      .setTraceId(randomUUID())
      .setSessionId(sessionId)
      .build();
    const session = await this.realtimeSessionService.find(context);
    return ApiResult.data('Realtime session found', this.toDetailResponse(session));
  }

  private toResponse(session: RealtimeSession): RealtimeSessionResponse {
    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      state: session.state,
      itemCount: session.itemCount,
      turnDetection: session.turnDetectionType,
      outputModalities: [...session.outputModalities],
      voice: session.voice,
    };
  }

  private toDetailResponse(session: RealtimeSession): RealtimeSessionDetailResponse {
    return {
      ...this.toResponse(session),
      metrics: { ...session.metrics },
    };
  }
}
