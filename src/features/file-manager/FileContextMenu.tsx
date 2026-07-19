import { Download, Eye, Pencil, Trash2 } from 'lucide-react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';

export interface FileContextMenuState { x: number; y: number; entry: FileEntry; }
interface FileContextMenuProps { menu: FileContextMenuState | null; onClose: () => void; onPreview: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; }

export function FileContextMenu({ menu, onClose, onPreview, onDownload, onRename, onDelete }: FileContextMenuProps) {
  const { t } = useI18n();
  if (!menu) return null;
  return <><div className="context-overlay" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} /><div className="context-menu motion-pop-in" style={{ left: `min(${menu.x}px, calc(100vw - 200px))`, top: `min(${menu.y}px, calc(100vh - 250px))` }}>{!menu.entry.isDirectory && <><button className="context-item" onClick={() => { onPreview(menu.entry); onClose(); }}><Eye size={16} className="context-item-icon" />{t('files.preview')}</button><button className="context-item" onClick={() => { onDownload(menu.entry); onClose(); }}><Download size={16} className="context-item-icon" />{t('files.download')}</button><div className="context-divider" /></>}<button className="context-item" onClick={() => onRename(menu.entry)}><Pencil size={16} className="context-item-icon" />{t('common.rename')}</button><button className="context-item danger" onClick={() => onDelete(menu.entry)}><Trash2 size={16} className="context-item-icon" />{t('common.delete')}</button></div></>;
}
