import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileManagerToolbar } from '@/features/file-manager/FileManagerToolbar';
import { I18nProvider } from '@/shared/i18n';

const actions = { onNavigate: vi.fn(), onRefresh: vi.fn(), onCreateFile: vi.fn(), onCreateFolder: vi.fn(), onUpload: vi.fn(), onExport: vi.fn(), isExporting: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FileManagerToolbar', () => {
  it('shows only the logical root when a stale path is outside its container', () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir="c-new" currentPath="c-old" {...actions} /></I18nProvider>);
    const toolbar = within(view.container);
    expect(toolbar.getByRole('button', { name: '/' })).toBeInTheDocument();
    expect(toolbar.queryByText('c-old')).not.toBeInTheDocument();
    expect(toolbar.queryByText('/home/workspace/c-new')).not.toBeInTheDocument();
  });

  it('renders only root-relative child segments', () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir="c-demo" currentPath="c-demo/src/components" {...actions} /></I18nProvider>);
    const toolbar = within(view.container);
    expect(toolbar.getByRole('button', { name: '/' })).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'src' })).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'components' })).toBeInTheDocument();
    expect(toolbar.queryByText('/containers/demo')).not.toBeInTheDocument();
  });

  it('groups file creation, upload and full export under one responsive action menu', async () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir="c-demo" currentPath="c-demo" {...actions} /></I18nProvider>);
    const toolbar = within(view.container);
    expect(toolbar.queryByTitle('新建文件')).not.toBeInTheDocument();
    expect(toolbar.queryByTitle('新建文件夹')).not.toBeInTheDocument();
    expect(toolbar.queryByTitle('上传文件')).not.toBeInTheDocument();

    fireEvent.click(toolbar.getByRole('button', { name: '更多文件操作' }));
    const menu = within(document.body).getByRole('menu', { name: '更多文件操作' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['新建文件', '新建文件夹', '上传文件', '导出完整工作区']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导出完整工作区' }));
    expect(actions.onExport).toHaveBeenCalledOnce();
  });

  it('shows and disables the export action while an export is running', () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir="c-demo" currentPath="c-demo" {...actions} isExporting /></I18nProvider>);
    fireEvent.click(within(view.container).getByRole('button', { name: '更多文件操作' }));
    expect(within(document.body).getByRole('menuitem', { name: '正在导出工作区' })).toBeDisabled();
  });
});
