import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';

interface ThinkingProcessProps {
  content: string;
  streaming?: boolean;
}

export function ThinkingProcess({ content, streaming = false }: ThinkingProcessProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { disclosureRef, setDisclosureExpanded, toggleDisclosure } = useIntrinsicDisclosure({ contentSelector: '.thinking-content', scrollContainerSelector: '.chat-message-list' });
  useLayoutEffect(() => {
    setDisclosureExpanded(streaming, { animate: false, followScroll: false });
  }, [setDisclosureExpanded, streaming]);
  useEffect(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, [content]);
  return (
    <details ref={disclosureRef} className={`thinking-process ${streaming ? 'streaming' : ''}`} data-expanded="false">
      <summary className="thinking-title" onClick={toggleDisclosure}><span>{t('chat.thinkingProcess')}</span><ChevronDown size={14} className="thinking-chevron" /></summary>
      <div ref={containerRef} className="thinking-content">{content}</div>
    </details>
  );
}
