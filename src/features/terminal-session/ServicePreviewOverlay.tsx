import { ArrowLeft, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/shared/i18n';
import { toErrorMessage } from '@/shared/lib/errors';
import './ServicePreviewOverlay.css';

interface ServicePreviewOverlayProps {
  port: number;
  url: string;
  isOnline: boolean;
  onDismiss: () => void;
}

const focusableSelector = '.service-preview-toolbar button:not([disabled]), .service-preview-toolbar a[href]';

export function ServicePreviewOverlay({ port, url, isOnline, onDismiss }: ServicePreviewOverlayProps) {
  const { t, format } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  const copyResetTimerRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  onDismissRef.current = onDismiss;
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(isOnline);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(isOnline);
    setCopied(false);
    setCopyError(null);
  }, [isOnline, url]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    closeButtonRef.current?.focus();

    // Push sentinel history state to trap history.back() and protect parent app from navigating away
    try {
      window.history.pushState({ servicePreviewOverlay: true, id: Date.now() }, '');
    } catch {
      // ignore
    }

    const handlePopState = (event: PopStateEvent) => {
      // If user backs past sentinel, restore sentinel by going forward to keep joint session history intact
      if (!event.state?.servicePreviewOverlay) {
        try {
          window.history.forward();
        } catch {
          // ignore
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const overlay = closeButtonRef.current?.closest('.service-preview-overlay');
      const focusable = overlay ? Array.from(overlay.querySelectorAll<HTMLElement>(focusableSelector)) : [];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('keydown', onKeyDown);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      if (root) root.inert = wasInert;
      previouslyFocused?.focus();

      // Clean up sentinel state if still on top
      try {
        if (window.history.state?.servicePreviewOverlay) {
          window.history.back();
        }
      } catch {
        // ignore
      }
    };
  }, []);

  const copyAddress = async () => {
    if (!isOnline) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyError(null);
      setCopied(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500);
    } catch (error) {
      setCopyError(`${t('services.copyFailed')}: ${toErrorMessage(error)}`);
    }
  };

  const reload = () => {
    if (!isOnline) return;
    setIsLoading(true);
    setReloadNonce((current) => current + 1);
  };

  const goBack = useCallback(() => {
    if (!isOnline || !iframeRef.current) return;

    // 1. Try same-origin contentWindow history access
    try {
      const win = iframeRef.current.contentWindow;
      if (win && win.history) {
        win.history.back();
        return;
      }
    } catch {
      // Cross-origin restriction prevented direct access to contentWindow.history
    }

    // 2. Focus iframe and send postMessage for embedded frames
    try {
      iframeRef.current.contentWindow?.focus();
      iframeRef.current.contentWindow?.postMessage({ type: 'sunam:go-back' }, '*');
    } catch {
      // ignore
    }

    // 3. Fallback: focus iframe and step joint session history
    try {
      iframeRef.current.contentWindow?.focus();
      window.history.back();
    } catch {
      // ignore
    }
  }, [isOnline]);

  return createPortal(
    <section className="service-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="service-preview-title">
      <header className="service-preview-toolbar">
        <button ref={closeButtonRef} type="button" className="service-preview-close" onClick={onDismiss} title={t('services.closePreview')} aria-label={t('services.closePreview')}><X size={20} /></button>
        <div className="service-preview-identity">
          <strong id="service-preview-title">{format('services.previewTitle', { port })}</strong>
          <span className={`service-preview-status ${isOnline ? 'is-online' : 'is-offline'}`}>{isOnline ? t('services.online') : t('services.offline')}</span>
        </div>
        <div className="service-preview-actions">
          <button type="button" className="icon-button" onClick={goBack} disabled={!isOnline} title={t('services.goBack')} aria-label={t('services.goBack')}><ArrowLeft size={18} /></button>
          <button type="button" className="icon-button" onClick={reload} disabled={!isOnline} title={t('services.reloadPreview')} aria-label={t('services.reloadPreview')}><RefreshCw size={18} /></button>
          <button type="button" className="icon-button" onClick={() => { void copyAddress(); }} disabled={!isOnline} title={t('services.copy')} aria-label={format('services.copyPort', { port })}>{copied ? <Check size={18} /> : <Copy size={18} />}</button>
        </div>
      </header>
      {copyError && <div className="service-preview-error" role="alert">{copyError}</div>}
      <div className="service-preview-stage">
        {isOnline ? <>
          {isLoading && <div className="service-preview-loading" role="status"><Loader2 className="lucide-spin" /><span>{t('services.loadingPreview')}</span></div>}
          <iframe ref={iframeRef} key={`${port}:${url}:${reloadNonce}`} className="service-preview-frame" src={url} title={format('services.previewFrameTitle', { port })} allow="clipboard-read; clipboard-write" onLoad={() => setIsLoading(false)} />
        </> : <div className="service-preview-offline" role="status"><span className="status-dot" /><h2>{t('services.serviceStopped')}</h2><p>{t('services.serviceStoppedHint')}</p></div>}
      </div>
    </section>,
    document.body,
  );
}
