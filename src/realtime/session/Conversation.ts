import { ConversationItem, FunctionCallItem, MessageItem } from '../protocol/items';
import { RealtimeError } from '../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../protocol/RealtimeErrorCodes';
import { LlmChatMessage, LlmToolCall } from '../upstream/interfaces/LlmClient';

/** Sentinel `previous_item_id` meaning "insert at the very beginning". */
export const ROOT_ITEM_ID = 'root';

/** An item plus the server-side bookkeeping that never goes on the wire. */
export interface StoredItem {
  /** The conversation item as emitted to clients. */
  item: ConversationItem;
  /** Milliseconds of assistant audio synthesised for this item so far (assistant messages only). */
  audioDurationMs?: number;
}

/** Result of `Conversation.insert`: where the item landed. */
export interface InsertResult {
  /** Zero-based position of the inserted item. */
  index: number;
  /** Id of the item now immediately before it, or `null` when it is first. */
  previousItemId: string | null;
}

/**
 * Ordered, in-memory store of the session's conversation items.
 *
 * Owns insertion order, lookup by id / call id, deletion, assistant-audio
 * truncation and projection into OpenAI chat-completions messages. Every
 * public method that takes an `itemId` throws `RealtimeError item_not_found`
 * when the id is unknown.
 */
export class Conversation {
  private readonly stored: StoredItem[] = [];

  /**
   * Inserts `item` after `previousItemId`. `'root'` inserts at index 0,
   * `undefined` appends, and an unknown id throws `item_not_found`.
   */
  public insert(item: ConversationItem, previousItemId?: string): InsertResult {
    let index: number;
    if (previousItemId === undefined) {
      index = this.stored.length;
    } else if (previousItemId === ROOT_ITEM_ID) {
      index = 0;
    } else {
      index = this.indexOf(previousItemId, 'previous_item_id') + 1;
    }
    this.stored.splice(index, 0, { item });
    return { index, previousItemId: index === 0 ? null : this.stored[index - 1].item.id };
  }

  /** Returns the item with `itemId`, throwing `item_not_found` when absent. */
  public get(itemId: string): ConversationItem {
    return this.stored[this.indexOf(itemId)].item;
  }

  /** Returns the item with `itemId`, or `null` when absent. */
  public find(itemId: string): ConversationItem | null {
    const entry = this.stored.find((s) => s.item.id === itemId);
    return entry === undefined ? null : entry.item;
  }

  /**
   * Removes the item with `itemId`. Throws `item_not_found` when absent and
   * `item_in_use` when it is the item the active response is writing.
   */
  public delete(itemId: string, writingItemId: string | null): void {
    const index = this.indexOf(itemId);
    if (writingItemId !== null && writingItemId === itemId) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.ITEM_IN_USE,
        `Item '${itemId}' is in use by the active response and cannot be deleted`,
        'item_id',
      );
    }
    this.stored.splice(index, 1);
  }

  /** Replaces the stored item that shares `item.id`, keeping its audio bookkeeping. */
  public replace(item: ConversationItem): void {
    this.stored[this.indexOf(item.id)].item = item;
  }

  /** Adds `ms` of synthesised audio to the item's running duration. */
  public addAudioDuration(itemId: string, ms: number): void {
    const entry = this.stored[this.indexOf(itemId)];
    entry.audioDurationMs = (entry.audioDurationMs ?? 0) + ms;
  }

  /** Milliseconds of synthesised audio recorded for the item (0 when none). */
  public getAudioDurationMs(itemId: string): number {
    return this.stored[this.indexOf(itemId)].audioDurationMs ?? 0;
  }

  /**
   * Truncates an assistant `output_audio` part's transcript to what the client
   * heard: keeps `floor(len * audioEndMs / audioDurationMs)` characters backed
   * off to a word boundary (0 → empty). Throws `item_truncate_invalid` when the
   * item is not an assistant message, `contentIndex` is not an `output_audio`
   * part, or `audioEndMs` exceeds the recorded audio duration. Returns the
   * updated item.
   */
  public truncateAssistantAudio(itemId: string, contentIndex: number, audioEndMs: number): ConversationItem {
    const entry = this.stored[this.indexOf(itemId)];
    const item = entry.item;
    if (item.type !== 'message' || item.role !== 'assistant') {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.ITEM_TRUNCATE_INVALID,
        `Item '${itemId}' is not an assistant message and cannot be truncated`,
        'item_id',
      );
    }
    const part = item.content[contentIndex];
    if (part === undefined || part.type !== 'output_audio') {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.ITEM_TRUNCATE_INVALID,
        `Content part ${contentIndex} of item '${itemId}' is not output_audio`,
        'item_id',
      );
    }
    const durationMs = entry.audioDurationMs ?? 0;
    if (!Number.isFinite(audioEndMs) || audioEndMs < 0 || audioEndMs > durationMs) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.ITEM_TRUNCATE_INVALID,
        `audio_end_ms (${audioEndMs}) exceeds the item's audio duration (${durationMs} ms)`,
        'audio_end_ms',
      );
    }
    const transcript = Conversation.truncateTranscript(part.transcript, audioEndMs, durationMs);
    const content = item.content.map((p, i) => (i === contentIndex ? { ...part, transcript } : p));
    const updated: MessageItem = { ...item, content };
    entry.item = updated;
    entry.audioDurationMs = audioEndMs;
    return updated;
  }

  /** Finds the `function_call` item with `callId`, or `null`. */
  public findFunctionCall(callId: string): ConversationItem | null {
    const entry = this.stored.find((s) => s.item.type === 'function_call' && s.item.call_id === callId);
    return entry === undefined ? null : entry.item;
  }

  /** Number of stored items. */
  public get count(): number {
    return this.stored.length;
  }

  /** An ordered copy of the items. */
  public items(): ConversationItem[] {
    return this.stored.map((s) => s.item);
  }

  /** Id of the item immediately before `itemId`, or `null` when it is first. */
  public previousItemIdOf(itemId: string): string | null {
    const index = this.indexOf(itemId);
    return index === 0 ? null : this.stored[index - 1].item.id;
  }

  /** Id of the last item, or `null` when empty. */
  public lastItemId(): string | null {
    const last = this.stored[this.stored.length - 1];
    return last === undefined ? null : last.item.id;
  }

  /**
   * Projects the conversation into OpenAI chat-completions messages:
   * `instructions` as a leading system message (when non-empty), message text
   * from `input_text` / `text` / transcripts, `function_call` items as assistant
   * `tool_calls`, and `function_call_output` items as `tool` messages. User
   * messages whose text is empty/whitespace are omitted.
   */
  public toLlmMessages(instructions: string): LlmChatMessage[] {
    const messages: LlmChatMessage[] = [];
    if (instructions.trim() !== '') {
      messages.push({ role: 'system', content: instructions });
    }
    for (const { item } of this.stored) {
      switch (item.type) {
        case 'message': {
          const text = Conversation.messageText(item);
          if (item.role === 'user') {
            if (text.trim() !== '') {
              messages.push({ role: 'user', content: text });
            }
          } else if (item.role === 'system') {
            messages.push({ role: 'system', content: text });
          } else {
            messages.push({ role: 'assistant', content: text });
          }
          break;
        }
        case 'function_call':
          messages.push({ role: 'assistant', content: null, tool_calls: [Conversation.toToolCall(item)] });
          break;
        case 'function_call_output':
          messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
          break;
      }
    }
    return messages;
  }

  private indexOf(itemId: string, param: string = 'item_id'): number {
    const index = this.stored.findIndex((s) => s.item.id === itemId);
    if (index === -1) {
      throw RealtimeError.invalidRequest(RealtimeErrorCodes.ITEM_NOT_FOUND, `Item '${itemId}' does not exist`, param);
    }
    return index;
  }

  private static messageText(item: MessageItem): string {
    const parts: string[] = [];
    for (const part of item.content) {
      switch (part.type) {
        case 'input_text':
        case 'text':
          parts.push(part.text);
          break;
        case 'input_audio':
        case 'output_audio':
          if (part.transcript !== null && part.transcript !== '') {
            parts.push(part.transcript);
          }
          break;
      }
    }
    return parts.join('\n');
  }

  private static toToolCall(item: FunctionCallItem): LlmToolCall {
    return { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
  }

  private static truncateTranscript(transcript: string, audioEndMs: number, durationMs: number): string {
    if (audioEndMs <= 0 || durationMs <= 0 || transcript.length === 0) {
      return '';
    }
    if (audioEndMs >= durationMs) {
      return transcript;
    }
    let keep = Math.floor((transcript.length * audioEndMs) / durationMs);
    if (keep <= 0) {
      return '';
    }
    if (keep < transcript.length && !/\s/.test(transcript[keep])) {
      const lastSpace = transcript.lastIndexOf(' ', keep);
      const lastBreak = Math.max(lastSpace, transcript.lastIndexOf('\n', keep));
      keep = lastBreak > 0 ? lastBreak : 0;
    }
    return transcript.slice(0, keep).trimEnd();
  }
}
