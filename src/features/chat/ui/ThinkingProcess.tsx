import { useEffect, useRef } from 'react';
import { useI18n } from '@/shared/i18n';

export function ThinkingProcess({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, [content]);
  return (
    <div className={`thinking-process ${streaming ? 'streaming' : ''}`}>
      <div className="thinking-title">{t('chat.thinkingProcess')}</div>
      <div ref={containerRef} className="thinking-content">{content}</div>
    </div>
  );
}
