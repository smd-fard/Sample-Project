import { CloseRealtimeSessionContext } from '../../contexts/realtimeSession/CloseRealtimeSessionContext';
import { FindRealtimeSessionContext } from '../../contexts/realtimeSession/FindRealtimeSessionContext';
import { ListRealtimeSessionContext } from '../../contexts/realtimeSession/ListRealtimeSessionContext';
import { OpenRealtimeSessionContext } from '../../contexts/realtimeSession/OpenRealtimeSessionContext';
import { UpdateRealtimeSessionContext } from '../../contexts/realtimeSession/UpdateRealtimeSessionContext';
import { RealtimeSession } from '../../models/RealtimeSession';

/** Contract for RealtimeSession orchestration: context in, model out. */
export interface IRealtimeSessionService {
  list(context: ListRealtimeSessionContext): Promise<RealtimeSession[]>;
  find(context: FindRealtimeSessionContext): Promise<RealtimeSession>;
  open(context: OpenRealtimeSessionContext): Promise<RealtimeSession>;
  update(context: UpdateRealtimeSessionContext): Promise<RealtimeSession>;
  close(context: CloseRealtimeSessionContext): Promise<RealtimeSession>;
}
