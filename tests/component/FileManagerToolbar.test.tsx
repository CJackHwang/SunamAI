import { render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileManagerToolbar } from '@/features/file-manager/FileManagerToolbar';
import { I18nProvider } from '@/shared/i18n';

const actions = { onNavigate: vi.fn(), onRefresh: vi.fn(), onCreateFile: vi.fn(), onCreateFolder: vi.fn(), onUpload: vi.fn() };

describe('FileManagerToolbar', () => {
  it('shows only the active container label when a stale path is outside its root', () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir=".sunam/workspaces/c-new" rootLabel="Demo" currentPath="/home/sunam/.sunam/workspaces/c-old" {...actions} /></I18nProvider>);
    const toolbar = within(view.container);
    expect(toolbar.getByRole('button', { name: 'Demo' })).toBeInTheDocument();
    expect(toolbar.queryByText('home')).not.toBeInTheDocument();
    expect(toolbar.queryByText('.sunam')).not.toBeInTheDocument();
  });

  it('renders only root-relative child segments', () => {
    const view = render(<I18nProvider><FileManagerToolbar rootDir=".sunam/workspaces/c-demo" rootLabel="Demo" currentPath=".sunam/workspaces/c-demo/src/components" {...actions} /></I18nProvider>);
    const toolbar = within(view.container);
    expect(toolbar.getByRole('button', { name: 'Demo' })).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'src' })).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'components' })).toBeInTheDocument();
    expect(toolbar.queryByText('.sunam')).not.toBeInTheDocument();
  });
});
