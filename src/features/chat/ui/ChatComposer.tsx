import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { ArrowDown, FileText, Plus, Send, Square, X } from 'lucide-react';
import type { ChatAttachment } from '@/entities/message/types';
import { useI18n } from '@/shared/i18n';

interface ChatComposerProps {
  input: string;
  isRunning: boolean;
  isTerminalReady: boolean;
  isAtBottom: boolean;
  taskList?: ReactNode;
  attachments?: ChatAttachment[];
  attachmentError?: string | null;
  onFilesSelected?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onInputChange: (value: string, element: HTMLTextAreaElement) => void;
  onSubmit: (event?: SyntheticEvent) => void;
  onStop: () => void;
  onScrollToBottom: () => void;
  onHeightChange?: (height: number) => void;
}

export function ChatComposer({ input, isRunning, isTerminalReady, isAtBottom, taskList, attachments = [], attachmentError, onFilesSelected, onRemoveAttachment, onInputChange, onSubmit, onStop, onScrollToBottom, onHeightChange }: ChatComposerProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const resetHeight = (element: HTMLTextAreaElement | null) => { if (element) element.style.height = '44px'; };
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !onHeightChange) return;
    const report = () => {
      // Measure only explicit flow rows. Never derive this from the shell height:
      // the animated task body lives inside that box and must remain an overlay.
      const rows = [
        shell.querySelector<HTMLElement>('.chat-attachment-tray'),
        shell.querySelector<HTMLElement>('.chat-attachment-error'),
        shell.querySelector<HTMLElement>('.task-list-summary'),
        shell.querySelector<HTMLElement>('.chat-input-row'),
      ].filter((row): row is HTMLElement => Boolean(row));
      const style = getComputedStyle(shell);
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
      const reservedHeight = rows.reduce((height, row) => height + row.getBoundingClientRect().height, padding) + Math.max(0, rows.length - 1) * gap;
      onHeightChange(Math.ceil(Math.max(reservedHeight, 124)));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [onHeightChange]);
  return (
    <div ref={shellRef} className="chat-composer-shell">
      {!isAtBottom && <button onClick={onScrollToBottom} className="chat-scroll-bottom-btn glass-input" title={t('chat.backToBottom')} aria-label={t('chat.backToBottom')}><ArrowDown size={16} /></button>}
      <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files?.length) onFilesSelected?.(Array.from(event.target.files)); event.target.value = ''; }} />
      {attachments.length > 0 && <div className="chat-attachment-tray">{attachments.map((attachment, index) => <div className="chat-attachment-chip" key={`${attachment.name}-${index}`}><FileText size={14} /><span>{attachment.name}</span><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small><button type="button" onClick={() => onRemoveAttachment?.(index)} aria-label={`${t('chat.removeAttachment')} ${attachment.name}`}><X size={13} /></button></div>)}</div>}
      {attachmentError && <div className="chat-attachment-error" role="alert">{attachmentError}</div>}
      <div className="chat-composer-upper-row">
        <div className="chat-task-list-slot">{taskList}</div>
        <button type="button" className="chat-attach-btn glass-input" onClick={() => fileInputRef.current?.click()} disabled={isRunning || !isTerminalReady} title={t('chat.attachFiles')} aria-label={t('chat.attachFiles')}><Plus size={20} /></button>
      </div>
      <div className="chat-input-row" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', pointerEvents: 'auto', width: '100%' }}>
        <textarea className="input-field glass-input" rows={1} style={{ flex: 1, borderRadius: '22px', padding: '10px 20px', minHeight: '44px', height: '44px', maxHeight: '120px', resize: 'none', overflowY: 'auto', lineHeight: '24px', fontFamily: 'inherit', boxSizing: 'border-box' }} value={input} onChange={(event) => onInputChange(event.target.value, event.target)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(event); setTimeout(onScrollToBottom, 50); resetHeight(event.currentTarget); } }} disabled={isRunning || !isTerminalReady} placeholder={isTerminalReady ? t('chat.askAnything') : t('chat.booting')} />
        <button type="button" onClick={(event) => { if (isRunning) onStop(); else { onSubmit(event); setTimeout(onScrollToBottom, 50); resetHeight(event.currentTarget.previousElementSibling as HTMLTextAreaElement); } }} disabled={!isRunning && (!isTerminalReady || (!input.trim() && attachments.length === 0))} className="btn btn-primary glass-btn" style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 0 }}>{isRunning ? <Square size={16} fill="currentColor" /> : <Send size={20} style={{ marginLeft: '-2px' }} />}</button>
      </div>
    </div>
  );
}
