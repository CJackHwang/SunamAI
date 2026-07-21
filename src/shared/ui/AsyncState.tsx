import type { ReactNode } from 'react';
import './AsyncState.css';

interface AsyncStateProps { children: ReactNode; className?: string }

export function LoadingState({ className = '' }: AsyncStateProps) {
  // Reuse the native boot-screen styles from index.html for a seamless transition
  return (
    <div role="status" className={`boot-screen ${className}`}>
      <div className="boot-screen__content">
        <img className="boot-screen__mark" src="/sunam-booticon.png" width={72} height={72} alt="" />
        <div className="boot-screen__bar" aria-hidden="true"></div>
      </div>
    </div>
  );
}

export function EmptyState({ children, className = '' }: AsyncStateProps) {
  return <div className={`async-state async-empty-state motion-fade-in ${className}`}>{children}</div>;
}

export function ErrorState({ children, className = '' }: AsyncStateProps) {
  return <div role="alert" className={`async-state async-error-state motion-rise-in ${className}`}>{children}</div>;
}
