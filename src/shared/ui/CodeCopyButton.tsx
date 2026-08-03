import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

interface CodeCopyButtonProps {
  code: string;
}

/** Floating "copy" button for code blocks. Overlay is styled in MarkdownRenderer.css. */
export default function CodeCopyButton({ code }: CodeCopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard unavailable (non-secure context); selection remains the fallback.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className={`code-copy-btn icon-button${copied ? ' is-copied' : ''}`}
      onClick={() => { void copy(); }}
      aria-label={copied ? t('common.copied') : t('common.copy')}
      title={copied ? t('common.copied') : t('common.copy')}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
