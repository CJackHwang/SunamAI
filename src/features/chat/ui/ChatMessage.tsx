import { memo } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { Message } from '@/entities/message/types';
import MarkdownRenderer from '@/shared/ui/MarkdownRenderer';
import { useI18n } from '@/shared/i18n';
import { extractChatContent } from '../lib/extractChatContent';
import { RenderErrorBoundary } from './RenderErrorBoundary';
import { ThinkingProcess } from './ThinkingProcess';
import { ToolDisclosure } from './ToolDisclosure';

interface ChatMessageProps {
  message: Message;
  toolOutputs: Message[];
}

export const ChatMessage = memo(function ChatMessage({ message, toolOutputs }: ChatMessageProps) {
  const { t } = useI18n();
  if (message.role === 'tool' || (message.role === 'user' && message.content.startsWith('SYSTEM ERROR:'))) return null;
  return (
    <div className={`motion-fade-in chat-message ${message._ui_streaming ? 'streaming' : ''}`} data-role={message.role} data-has-tools={Boolean(message.tool_calls)}>
      {message.reasoning_content && <ThinkingProcess content={message.reasoning_content} {...(message._ui_streaming !== undefined ? { streaming: message._ui_streaming } : {})} />}
      {message.content.trim() && message.role !== 'user' && <div className="streaming-answer chat-answer" data-has-tools={Boolean(message.tool_calls)}><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={message.content} /></RenderErrorBoundary></div>}
      {message.role === 'user' && !message.tool_calls && <><div className="chat-user-content">{message._ui_displayContent ?? message.content}</div>{message._ui_attachments && message._ui_attachments.length > 0 && <div className="message-attachments">{message._ui_attachments.map((attachment, index) => {
        const isImage = attachment.type?.startsWith('image/');
        return <span className={isImage ? 'image-resource' : 'file-resource'} key={`${attachment.name}-${index}`} title={`${attachment.type ?? 'application/octet-stream'} · ${attachment.size} bytes`}>{isImage ? <ImageIcon size={13} /> : <FileText size={13} />}<span>{attachment.name}</span></span>;
      })}</div>}</>}
      {message.tool_calls && <div className="chat-tool-list">{message.tool_calls.map((call) => {
        const output = toolOutputs.find((candidate) => candidate.tool_call_id === call.id);
        if (call.function.name === 'ask_user') return <div key={call.id} className="chat-ask-user"><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={extractChatContent(call.function.arguments)} /></RenderErrorBoundary></div>;
        return <ToolDisclosure key={call.id} name={call.function.name} argumentsText={call.function.arguments} {...(output ? { output } : {})} runningLabel={t('chat.running')} completedLabel={t('chat.completed')} resultLabel={t('chat.result')} />;
      })}</div>}
    </div>
  );
});
