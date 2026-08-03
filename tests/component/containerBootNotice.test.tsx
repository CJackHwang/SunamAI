import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/shared/i18n';
import { ContainerBootNotice } from '@/shared/ui/ContainerBootNotice';

afterEach(() => cleanup());

function renderNotice(props: { message?: string; onDismiss: () => void; onRetry?: () => void }) {
  return render(<I18nProvider><ContainerBootNotice message={props.message ?? ''} onDismiss={props.onDismiss} {...(props.onRetry ? { onRetry: props.onRetry } : {})} /></I18nProvider>);
}

describe('ContainerBootNotice', () => {
  it('renders the title, body, and the dismiss/continue action', () => {
    const onDismiss = vi.fn();
    renderNotice({ onDismiss });
    expect(screen.getByText('容器初始化失败')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '放弃容器，继续纯聊天' })).toBeInTheDocument();
  });

  it('renders a retry action when provided and dismisses on continue', () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    renderNotice({ onDismiss, onRetry });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '放弃容器，继续纯聊天' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('omits the retry action when not provided', () => {
    renderNotice({ onDismiss: vi.fn() });
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });
});
