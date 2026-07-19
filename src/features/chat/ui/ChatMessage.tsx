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
    <div className={`motion-fade-in chat-message ${message._ui_streaming ? 'streaming' : ''}`} style={{
      alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', backgroundColor: message.role === 'user' ? 'var(--color-black)' : 'var(--color-surface)', color: message.role === 'user' ? 'var(--color-white)' : 'var(--color-text)', padding: '16px 20px', borderRadius: 'var(--radius-large)', maxWidth: message.role === 'user' ? '80%' : '100%', border: message.role === 'user' ? 'none' : '1px solid var(--color-border)', wordBreak: 'break-word', whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal', lineHeight: '1.6',
    }}>
      {message.reasoning_content && <ThinkingProcess content={message.reasoning_content} streaming={message._ui_streaming} />}
      {message.content.trim() && message.role !== 'user' && <div className="streaming-answer" style={{ fontSize: '14.5px', marginBottom: message.tool_calls ? '12px' : '0' }}><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={message.content} /></RenderErrorBoundary></div>}
      {message.role === 'user' && !message.tool_calls && <><div style={{ fontSize: '14.5px' }}>{message._ui_displayContent ?? message.content}</div>{message._ui_attachments && message._ui_attachments.length > 0 && <div className="message-attachments">{message._ui_attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><FileText size={13} />{attachment.name}</span>)}</div>}</>}
      {message.tool_calls && <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{message.tool_calls.map((call) => {
        const output = toolOutputs.find((candidate) => candidate.tool_call_id === call.id);
        if (call.function.name === 'ask_user') return <div key={call.id} style={{ fontSize: '14.5px' }}><RenderErrorBoundary label={t('common.error')}><MarkdownRenderer content={extractChatContent(call.function.arguments)} /></RenderErrorBoundary></div>;
        return <div key={call.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '13px', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}><Terminal size={14} />{t('chat.running')} {call.function.name}</div>
          {call.function.arguments && <pre style={{ fontSize: '12px', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: 0 }}>{call.function.arguments}</pre>}
          {output && <div style={{ marginTop: '4px', fontSize: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}><div style={{ color: 'var(--color-text-secondary)', fontWeight: 600, marginBottom: '4px' }}>{t('chat.result')}</div><div style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto', backgroundColor: 'var(--color-gray-100)', padding: '8px', borderRadius: '4px' }}>{output.content}</div></div>}
        </div>;
      })}</div>}
    </div>
  );
});
