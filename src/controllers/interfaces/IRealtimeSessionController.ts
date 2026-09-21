import { ApiEnvelope } from '../../common/http/ApiResult';
import { RealtimeSessionDetailResponse } from '../../dtos/realtimeSession/responses/RealtimeSessionDetailResponse';
import { RealtimeSessionResponse } from '../../dtos/realtimeSession/responses/RealtimeSessionResponse';

/** HTTP contract for the realtime-session endpoints under `/api/realtime/sessions`. */
export interface IRealtimeSessionController {
  list(): Promise<ApiEnvelope<RealtimeSessionResponse[]>>;
  find(sessionId: string): Promise<ApiEnvelope<RealtimeSessionDetailResponse>>;
}
