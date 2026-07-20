import { Download, Eye, Pencil, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { isPreviewableFile } from './fileUtils';

export interface FileContextMenuState { x: number; y: number; entry: FileEntry; }
interface FileContextMenuProps { menu: FileContextMenuState | null; onClose: () => void; onPreview: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; }

export function FileContextMenu({ menu, onClose, onPreview, onDownload, onRename, onDelete }: FileContextMenuProps) {
  const { t } = useI18n();
  if (!menu) return null;
  const position = { '--context-menu-x': `${menu.x}px`, '--context-menu-y': `${menu.y}px` } as CSSProperties;
  return <><div className="context-overlay" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} /><div className="context-menu context-menu-positioned motion-pop-in" style={position}>{!menu.entry.isDirectory && <>{isPreviewableFile(menu.entry.name) && <button className="context-item" onClick={() => { onPreview(menu.entry); onClose(); }}><Eye size={16} className="context-item-icon" />{t('files.preview')}</button>}<button className="context-item" onClick={() => { onDownload(menu.entry); onClose(); }}><Download size={16} className="context-item-icon" />{t('files.download')}</button><div className="context-divider" /></>}<button className="context-item" onClick={() => onRename(menu.entry)}><Pencil size={16} className="context-item-icon" />{t('common.rename')}</button><button className="context-item danger" onClick={() => onDelete(menu.entry)}><Trash2 size={16} className="context-item-icon" />{t('common.delete')}</button></div></>;
}
