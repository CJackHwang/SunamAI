import { ArrowDown, ArrowLeft, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/shared/i18n';

interface SubagentFooterProps {
  isRunning: boolean;
  isAtBottom: boolean;
  taskList?: ReactNode;
  onStop: () => void;
  onReturn: () => void;
  onScrollToBottom: () => void;
}

export function SubagentFooter({ isRunning, isAtBottom, taskList, onStop, onReturn, onScrollToBottom }: SubagentFooterProps) {
  const { t } = useI18n();
  const label = isRunning ? t('chat.stopSubagent') : t('chat.returnToParent');
  return <div className="subagent-footer">
    {!isAtBottom && <button onClick={onScrollToBottom} className="chat-scroll-bottom-btn glass-input motion-pop-in" title={t('chat.backToBottom')} aria-label={t('chat.backToBottom')}><ArrowDown size={16} /></button>}
    {taskList && <div className="subagent-task-list-slot">{taskList}</div>}
    <button onClick={isRunning ? onStop : onReturn} className="btn btn-primary glass-btn chat-submit subagent-action" title={label} aria-label={label}>{isRunning ? <Square size={16} fill="currentColor" /> : <ArrowLeft size={19} />}</button>
  </div>;
}
