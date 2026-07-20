import { Download, Eye, Pencil, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { usePresence } from '@/shared/ui/usePresence';
import { isPreviewableFile } from './fileUtils';

export interface FileContextMenuState { x: number; y: number; entry: FileEntry; }
interface FileContextMenuProps { menu: FileContextMenuState | null; onClose: () => void; onPreview: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; }

export function FileContextMenu({ menu, onClose, onPreview, onDownload, onRename, onDelete }: FileContextMenuProps) {
  const { t } = useI18n();
  const { presentValue: presentMenu, isExiting } = usePresence(menu);
  if (!presentMenu) return null;
  const position = { '--context-menu-x': `${presentMenu.x}px`, '--context-menu-y': `${presentMenu.y}px` } as CSSProperties;
  return <><div className={`context-overlay ${isExiting ? 'is-exiting' : ''}`} onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} /><div className={`context-menu context-menu-positioned ${isExiting ? 'is-exiting' : ''}`} style={position}>{!presentMenu.entry.isDirectory && <>{isPreviewableFile(presentMenu.entry.name) && <button className="context-item" onClick={() => { onPreview(presentMenu.entry); onClose(); }}><Eye size={16} className="context-item-icon" />{t('files.preview')}</button>}<button className="context-item" onClick={() => { onDownload(presentMenu.entry); onClose(); }}><Download size={16} className="context-item-icon" />{t('files.download')}</button><div className="context-divider" /></>}<button className="context-item" onClick={() => onRename(presentMenu.entry)}><Pencil size={16} className="context-item-icon" />{t('common.rename')}</button><button className="context-item danger" onClick={() => onDelete(presentMenu.entry)}><Trash2 size={16} className="context-item-icon" />{t('common.delete')}</button></div></>;
}
