export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
  _ui_streaming?: boolean;
  _ui_retryCount?: number;
  _ui_displayContent?: string;
  _ui_attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  name: string;
  size: number;
  content: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
