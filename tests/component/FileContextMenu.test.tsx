import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { FileContextMenu } from '@/features/file-manager/FileContextMenu';
import { FileEntryList } from '@/features/file-manager/FileEntryList';

const entry = { name: 'notes.txt', isDirectory: false, size: 12 };

describe('desktop file actions', () => {
  it('opens the context menu with desktop pointer coordinates', () => {
    const onOpenContextMenu = vi.fn();
    render(<I18nProvider><FileEntryList entries={[entry]} isLoading={false} selectedItem={null} dragOverFolder={null} renamingEntry={null} renameValue="" newItemType={null} newItemName="" listRef={createRef()} renameInputRef={createRef()} newItemInputRef={createRef()} onClearSelection={vi.fn()} onItemClick={vi.fn()} onItemDoubleClick={vi.fn()} onOpenContextMenu={onOpenContextMenu} onLongPressStart={vi.fn()} onLongPressEnd={vi.fn()} onDragStart={vi.fn()} onFolderDragOver={vi.fn()} onFolderDragLeave={vi.fn()} onFolderDrop={vi.fn()} onRenameChange={vi.fn()} onRenameConfirm={vi.fn()} onRenameCancel={vi.fn()} onNewNameChange={vi.fn()} onNewConfirm={vi.fn()} onNewCancel={vi.fn()} /></I18nProvider>);
    fireEvent.contextMenu(screen.getByText('notes.txt').closest('.fm-item')!, { clientX: 640, clientY: 320 });
    expect(onOpenContextMenu).toHaveBeenCalledWith(entry, 640, 320);
  });

  it('portals the menu outside transformed terminal ancestors', () => {
    render(<div style={{ transform: 'translateY(0)', overflow: 'hidden' }}><I18nProvider><FileContextMenu menu={{ x: 640, y: 320, entry }} onClose={vi.fn()} onPreview={vi.fn()} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} /></I18nProvider></div>);
    expect(screen.getByText('重命名').closest('.context-menu')?.parentElement).toBe(document.body);
  });
});
