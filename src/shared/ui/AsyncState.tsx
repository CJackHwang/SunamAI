import type { ReactNode } from 'react';

export function LoadingState({ children }: { children: ReactNode }) { return <div role="status" style={{ padding: '16px', color: 'var(--color-text-secondary)' }}>{children}</div>; }
export function EmptyState({ children }: { children: ReactNode }) { return <div style={{ padding: '16px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>{children}</div>; }
export function ErrorState({ children }: { children: ReactNode }) { return <div role="alert" style={{ padding: '12px', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px' }}>{children}</div>; }
