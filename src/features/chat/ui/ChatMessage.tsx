import { memo } from 'react';
import { FileText, Terminal } from 'lucide-react';
import type { Message } from '@/entities/message/types';
import MarkdownRenderer from '@/shared/ui/MarkdownRenderer';
import { useI18n } from '@/shared/i18n';
import { extractChatContent } from '../lib/extractChatContent';
import { RenderErrorBoundary } from './RenderErrorBoundary';
import { ThinkingProcess } from './ThinkingProcess';

interface ChatMessageProps {
  message: Message;
  toolOutputs: Message[];
}

export const ChatMessage = memo(function ChatMessage({ message, toolOutputs }: ChatMessageProps) {
  const { t } = useI18n();
  if (message.role === 'tool' || (message.role === 'user' && message.content.startsWith('SYSTEM ERROR:'))) return null;
  return (
    <div className={`motion-fade-in chat-message ${message._ui_streaming ? 'streaming' : ''}`} data-role={message.role}>
      {message.reasoning_content && <ThinkingProcess content={message.reasoning_content} streaming={message._ui_streaming} />}
      {message.content.trim() && message.role !== 'user' && <div className="streaming-answer chat-answer" data-has-tools={Boolean(message.tool_calls)}><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={message.content} /></RenderErrorBoundary></div>}
      {message.role === 'user' && !message.tool_calls && <><div className="chat-user-content">{message._ui_displayContent ?? message.content}</div>{message._ui_attachments && message._ui_attachments.length > 0 && <div className="message-attachments">{message._ui_attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><FileText size={13} />{attachment.name}</span>)}</div>}</>}
      {message.tool_calls && <div className="chat-tool-list">{message.tool_calls.map((call) => {
        const output = toolOutputs.find((candidate) => candidate.tool_call_id === call.id);
        if (call.function.name === 'ask_user') return <div key={call.id} className="chat-ask-user"><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={extractChatContent(call.function.arguments)} /></RenderErrorBoundary></div>;
        return <div key={call.id} className="chat-tool">
          <div className="chat-tool-heading"><Terminal size={14} />{t('chat.running')} {call.function.name}</div>
          {call.function.arguments && <pre className="chat-tool-arguments">{call.function.arguments}</pre>}
          {output && <div className="chat-tool-result"><div className="chat-tool-result-label">{t('chat.result')}</div><div className="chat-tool-result-content">{output.content}</div></div>}
        </div>;
      })}</div>}
    </div>
  );
});
