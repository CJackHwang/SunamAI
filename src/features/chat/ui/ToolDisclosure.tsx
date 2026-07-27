import { ChevronDown, Terminal } from 'lucide-react';
import type { Message } from '@/entities/message/types';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';

interface ToolDisclosureProps {
  name: string;
  argumentsText: string;
  output?: Message;
  runningLabel: string;
  completedLabel: string;
  resultLabel: string;
}

export function ToolDisclosure({ name, argumentsText, output, runningLabel, completedLabel, resultLabel }: ToolDisclosureProps) {
  const { disclosureRef, toggleDisclosure } = useIntrinsicDisclosure({ contentSelector: '.chat-tool-body', scrollContainerSelector: '.chat-message-list' });

  return <details ref={disclosureRef} className="chat-tool" data-expanded="false">
    <summary className="chat-tool-heading" onClick={toggleDisclosure}><Terminal size={14} /><span>{output ? completedLabel : runningLabel} {name}</span><ChevronDown size={15} className="chat-tool-chevron" /></summary>
    <div className="chat-tool-body">
      {argumentsText && <pre className="chat-tool-arguments">{argumentsText}</pre>}
      {output && <div className="chat-tool-result"><div className="chat-tool-result-label">{resultLabel}</div><div className="chat-tool-result-content">{output.content}</div></div>}
    </div>
  </details>;
}
