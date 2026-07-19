import type { ReactNode, SyntheticEvent } from 'react';
import { ArrowDown, Send, Square } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

interface ChatComposerProps {
  input: string;
  isRunning: boolean;
  isTerminalReady: boolean;
  isAtBottom: boolean;
  taskList?: ReactNode;
  onInputChange: (value: string, element: HTMLTextAreaElement) => void;
  onSubmit: (event?: SyntheticEvent) => void;
  onStop: () => void;
  onScrollToBottom: () => void;
}

export function ChatComposer({ input, isRunning, isTerminalReady, isAtBottom, taskList, onInputChange, onSubmit, onStop, onScrollToBottom }: ChatComposerProps) {
  const { t } = useI18n();
  const resetHeight = (element: HTMLTextAreaElement | null) => { if (element) element.style.height = '44px'; };
  return (
    <div className="chat-composer-shell">
      {!isAtBottom && <button onClick={onScrollToBottom} className="glass-input" style={{ pointerEvents: 'auto', width: '44px', height: '44px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--color-text)', transition: 'filter 0.2s' }} title={t('chat.backToBottom')}><ArrowDown size={16} /></button>}
      {taskList}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', pointerEvents: 'auto', width: '100%' }}>
        <textarea className="input-field glass-input" rows={1} style={{ flex: 1, borderRadius: '22px', padding: '10px 20px', minHeight: '44px', height: '44px', maxHeight: '120px', resize: 'none', overflowY: 'auto', lineHeight: '24px', fontFamily: 'inherit', boxSizing: 'border-box' }} value={input} onChange={(event) => onInputChange(event.target.value, event.target)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(event); setTimeout(onScrollToBottom, 50); resetHeight(event.currentTarget); } }} disabled={isRunning || !isTerminalReady} placeholder={isTerminalReady ? t('chat.askAnything') : t('chat.booting')} />
        <button type="button" onClick={(event) => { if (isRunning) onStop(); else { onSubmit(event); setTimeout(onScrollToBottom, 50); resetHeight(event.currentTarget.previousElementSibling as HTMLTextAreaElement); } }} disabled={!isRunning && (!isTerminalReady || !input.trim())} className="btn btn-primary glass-btn" style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 0 }}>{isRunning ? <Square size={16} fill="currentColor" /> : <Send size={20} style={{ marginLeft: '-2px' }} />}</button>
      </div>
    </div>
  );
}
