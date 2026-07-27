import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import FileManager from '@/features/file-manager/FileManager';
import { I18nProvider } from '@/shared/i18n';

function fixture(exportWorkspace: () => Promise<Uint8Array>): WebContainer {
  return {
    export: exportWorkspace,
    fs: {
      readdir: vi.fn(async () => []),
      watch: () => ({ close: () => undefined }),
    },
  } as unknown as WebContainer;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FileManager workspace export', () => {
  it('surfaces a native zip export failure in the existing error region', async () => {
    const wc = fixture(vi.fn(async () => { throw new Error('archive unavailable'); }));
    render(<I18nProvider><FileManager wc={wc} rootDir="c-demo" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '更多文件操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '导出完整工作区' }));
    expect(await screen.findByText('导出工作区失败：archive unavailable')).toBeInTheDocument();
  });

  it('shows export progress and disables a duplicate export action', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let resolveExport!: (archive: Uint8Array) => void;
    const exportWorkspace = vi.fn(() => new Promise<Uint8Array>((resolve) => { resolveExport = resolve; }));
    render(<I18nProvider><FileManager wc={fixture(exportWorkspace)} rootDir="c-demo" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '更多文件操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '导出完整工作区' }));

    const trigger = screen.getByRole('button', { name: '更多文件操作' });
    await waitFor(() => expect(trigger).toHaveAttribute('title', '正在导出工作区'));
    fireEvent.click(trigger);
    expect(within(screen.getByRole('menu', { name: '更多文件操作' })).getByRole('menuitem', { name: '正在导出工作区' })).toBeDisabled();

    resolveExport(new Uint8Array([80, 75, 3, 4]));
    await waitFor(() => expect(trigger).toHaveAttribute('title', '更多文件操作'));
  });
});
