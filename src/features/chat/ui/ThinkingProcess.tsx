import { useEffect, useRef } from 'react';
import { useI18n } from '@/shared/i18n';

export function ThinkingProcess({ content }: { content: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, [content]);
  return (
    <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: 'var(--color-gray-100)', borderRadius: 'var(--radius-small)', color: 'var(--color-text-secondary)', fontSize: '13px', fontStyle: 'italic', borderLeft: '3px solid var(--color-border)' }}>
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t('chat.thinkingProcess')}</div>
      <div ref={containerRef} style={{ whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>{content}</div>
    </div>
  );
}
