type Role = 'system' | 'user' | 'assistant' | 'tool';

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_resource'; resourceId: string }
  | { type: 'file_resource'; resourceId: string };

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
  _ui_streaming?: boolean;
  _ui_displayContent?: string;
  _ui_attachments?: ChatAttachment[];
  contentParts?: MessageContentPart[];
  resourceIds?: string[];
}

export interface ChatAttachment {
  name: string;
  size: number;
  type?: string;
  file?: File;
  resourceId?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Canonical internal content view. Legacy string-only messages are normalized at boundaries. */
export function canonicalContentParts(message: Pick<Message, 'content' | 'contentParts'>): MessageContentPart[] {
  if (message.contentParts) return message.contentParts.map((part) => ({ ...part }));
  return message.content ? [{ type: 'text', text: message.content }] : [];
}

export function messageText(message: Pick<Message, 'content' | 'contentParts'>): string {
  const text = canonicalContentParts(message).flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
  return text || message.content;
}

export function canonicalizeMessage(message: Message): Message {
  return { ...message, contentParts: canonicalContentParts(message) };
}
