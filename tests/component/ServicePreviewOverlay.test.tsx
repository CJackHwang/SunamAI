import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicePreviewOverlay } from '@/features/terminal-session/ServicePreviewOverlay';
import { I18nProvider } from '@/shared/i18n';

afterEach(cleanup);

function PreviewHarness() {
  const [open, setOpen] = useState(false);
  return <I18nProvider>
    <button type="button" onClick={() => setOpen(true)}>Open preview</button>
    {open && <ServicePreviewOverlay port={5173} url="https://5173.example.test" isOnline onDismiss={() => setOpen(false)} />}
  </I18nProvider>;
}

describe('ServicePreviewOverlay', () => {
  it('renders an unsandboxed live iframe and rebuilds it on reload', () => {
    render(<I18nProvider><ServicePreviewOverlay port={5173} url="https://5173.example.test" isOnline onDismiss={vi.fn()} /></I18nProvider>);
    const frame = screen.getByTitle('端口 5173 页面预览');
    expect(frame).toHaveAttribute('src', 'https://5173.example.test');
    expect(frame).not.toHaveAttribute('sandbox');
    expect(frame).toHaveAttribute('allow', 'clipboard-read; clipboard-write');
    fireEvent.load(frame);
    expect(screen.queryByText('正在加载预览…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));
    expect(screen.getByTitle('端口 5173 页面预览')).not.toBe(frame);
    expect(screen.getByText('正在加载预览…')).toBeInTheDocument();
  });

  it('closes with Escape and restores focus to the trigger', () => {
    render(<PreviewHarness />);
    const trigger = screen.getByRole('button', { name: 'Open preview' });
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: '返回服务列表' });
    const copy = screen.getByRole('button', { name: '复制端口 5173 地址' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(copy).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps the shell when offline and restores a reopened port with its new URL', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<I18nProvider><ServicePreviewOverlay port={3457} url="https://old.example.test" isOnline onDismiss={onDismiss} /></I18nProvider>);
    rerender(<I18nProvider><ServicePreviewOverlay port={3457} url="https://old.example.test" isOnline={false} onDismiss={onDismiss} /></I18nProvider>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('服务已停止')).toBeInTheDocument();
    expect(screen.queryByTitle('端口 3457 页面预览')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新预览' })).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<I18nProvider><ServicePreviewOverlay port={3457} url="https://new.example.test" isOnline onDismiss={onDismiss} /></I18nProvider>);
    expect(screen.getByTitle('端口 3457 页面预览')).toHaveAttribute('src', 'https://new.example.test');
    expect(screen.queryByText('服务已停止')).not.toBeInTheDocument();
  });

  it('reports clipboard errors without closing the preview', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('permission denied'); }) } });
    const onDismiss = vi.fn();
    render(<I18nProvider><ServicePreviewOverlay port={3000} url="https://3000.example.test" isOnline onDismiss={onDismiss} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: '复制端口 3000 地址' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
