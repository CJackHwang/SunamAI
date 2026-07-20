import type { PropsWithChildren, ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps extends PropsWithChildren {
  title: ReactNode;
  onDismiss?: () => void;
  labelledBy?: string;
  isExiting?: boolean;
}

export function Modal({ title, onDismiss, labelledBy = 'sunam-modal-title', isExiting = false, children }: ModalProps) {
  return <div className={`modal-backdrop motion-overlay-in ${isExiting ? 'is-exiting' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss?.(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`settings-modal-content motion-panel-in ${isExiting ? 'is-exiting' : ''}`}>
      <header className="modal-header"><h2 id={labelledBy}>{title}</h2>{onDismiss && <button type="button" className="modal-close" onClick={onDismiss} aria-label="Close"><X size={20} /></button>}</header>
      {children}
    </section>
  </div>;
}
