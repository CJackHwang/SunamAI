import { Download, Eye, Pencil, Trash2 } from 'lucide-react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { isPreviewableFile } from './fileUtils';

export interface FileContextMenuState { x: number; y: number; entry: FileEntry; }
interface FileContextMenuProps { menu: FileContextMenuState | null; onClose: () => void; onPreview: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; }

export function FileContextMenu({ menu, onClose, onPreview, onDownload, onRename, onDelete }: FileContextMenuProps) {
  const { t } = useI18n();
  return <ActionMenu menu={menu} onClose={onClose} ariaLabel={t('files.actions')} items={(presentMenu) => [
    ...(!presentMenu.entry.isDirectory && isPreviewableFile(presentMenu.entry.name) ? [{ id: 'preview', label: t('files.preview'), icon: Eye, onSelect: () => onPreview(presentMenu.entry) }] : []),
    ...(!presentMenu.entry.isDirectory ? [{ id: 'download', label: t('files.download'), icon: Download, onSelect: () => onDownload(presentMenu.entry) }] : []),
    { id: 'rename', label: t('common.rename'), icon: Pencil, onSelect: () => onRename(presentMenu.entry), separatorBefore: !presentMenu.entry.isDirectory },
    { id: 'delete', label: t('common.delete'), icon: Trash2, onSelect: () => onDelete(presentMenu.entry), danger: true },
  ]} />;
}
