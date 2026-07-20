import type { ReactNode } from 'react';
import './AsyncState.css';

interface AsyncStateProps { children: ReactNode; className?: string }

export function LoadingState({ children, className = '' }: AsyncStateProps) {
  return <div role="status" className={`async-state async-loading-state motion-fade-in ${className}`}>{children}</div>;
}

export function EmptyState({ children, className = '' }: AsyncStateProps) {
  return <div className={`async-state async-empty-state motion-fade-in ${className}`}>{children}</div>;
}

export function ErrorState({ children, className = '' }: AsyncStateProps) {
  return <div role="alert" className={`async-state async-error-state motion-rise-in ${className}`}>{children}</div>;
}
