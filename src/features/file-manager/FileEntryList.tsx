import type { DragEvent, MouseEvent, RefObject, TouchEvent } from 'react';
import { FileText, Folder, FolderOpen, MoreVertical } from 'lucide-react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { formatSize } from './fileUtils';

interface FileEntryListProps {
  entries: FileEntry[];
  isLoading: boolean;
  selectedItem: string | null;
  dragOverFolder: string | null;
  renamingEntry: string | null;
  renameValue: string;
  newItemType: 'file' | 'folder' | null;
  newItemName: string;
  listRef: RefObject<HTMLDivElement | null>;
  renameInputRef: RefObject<HTMLInputElement | null>;
  newItemInputRef: RefObject<HTMLInputElement | null>;
  onClearSelection: () => void;
  onItemClick: (event: MouseEvent, entry: FileEntry) => void;
  onItemDoubleClick: (event: MouseEvent, entry: FileEntry) => void;
  onContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onLongPressStart: (event: TouchEvent, entry: FileEntry) => void;
  onLongPressEnd: () => void;
  onDragStart: (event: DragEvent, entry: FileEntry) => void;
  onFolderDragOver: (event: DragEvent, name: string) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (event: DragEvent, name: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onNewNameChange: (value: string) => void;
  onNewConfirm: () => void;
  onNewCancel: () => void;
}

export function FileEntryList(props: FileEntryListProps) {
  const { t } = useI18n();
  return <div className="fm-list" ref={props.listRef} onClick={props.onClearSelection}>
    {props.newItemType && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px' }}><input ref={props.newItemInputRef} className="input-field" style={{ flex: 1, minWidth: 0, height: '36px', padding: '0 12px' }} value={props.newItemName} onChange={(event) => props.onNewNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onNewConfirm(); if (event.key === 'Escape') props.onNewCancel(); }} placeholder={props.newItemType === 'folder' ? t('files.folderName') : t('files.fileName')} /><button className="btn btn-primary" style={{ height: '36px', padding: '0 16px' }} onClick={props.onNewConfirm}>{t('common.create')}</button><button className="btn btn-secondary" style={{ height: '36px', padding: '0 16px' }} onClick={props.onNewCancel}>{t('common.cancel')}</button></div>}
    {props.isLoading && props.entries.length === 0 && [1, 2, 3, 4, 5].map((item) => <div key={item} className="fm-skeleton"><div className="fm-skeleton-icon" /><div className="fm-skeleton-text" style={{ width: `${40 + item * 8}%` }} /></div>)}
    {!props.isLoading && props.entries.length === 0 && <div className="fm-empty"><FolderOpen size={40} color="var(--color-black)" /><span>{t('files.empty')}</span><span style={{ fontSize: 12 }}>{t('files.emptyHint')}</span></div>}
    {props.entries.map((entry) => <div key={entry.name} className={`fm-item ${props.dragOverFolder === entry.name ? 'drag-over' : ''} ${props.selectedItem === entry.name ? 'selected' : ''}`} onClick={(event) => props.onItemClick(event, entry)} onDoubleClick={(event) => props.onItemDoubleClick(event, entry)} onContextMenu={(event) => props.onContextMenu(event, entry)} onTouchStart={(event) => props.onLongPressStart(event, entry)} onTouchEnd={props.onLongPressEnd} onTouchMove={props.onLongPressEnd} draggable={!props.renamingEntry} onDragStart={(event) => props.onDragStart(event, entry)} {...(entry.isDirectory ? { onDragOver: (event: DragEvent) => props.onFolderDragOver(event, entry.name), onDragLeave: props.onFolderDragLeave, onDrop: (event: DragEvent) => props.onFolderDrop(event, entry.name) } : {})}>
      <div className={`fm-item-icon ${entry.isDirectory ? 'folder' : ''}`}>{entry.isDirectory ? <Folder size={22} /> : <FileText size={22} />}</div>
      {props.renamingEntry === entry.name ? <input ref={props.renameInputRef} className="input-field" style={{ flex: 1, minWidth: 0, height: '32px', padding: '0 10px' }} value={props.renameValue} onChange={(event) => props.onRenameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onRenameConfirm(); if (event.key === 'Escape') props.onRenameCancel(); }} onBlur={props.onRenameConfirm} onClick={(event) => event.stopPropagation()} /> : <span className="fm-item-name">{entry.name}</span>}
      {!entry.isDirectory && <span className="fm-item-size">{formatSize(entry.size)}</span>}
      <button className="fm-toolbar-btn" style={{ width: 32, height: 32, display: 'none' }} onClick={(event) => { event.stopPropagation(); const rect = (event.target as HTMLElement).getBoundingClientRect(); props.onContextMenu({ ...event, clientX: rect.right, clientY: rect.bottom } as MouseEvent, entry); }}><MoreVertical size={16} /></button>
    </div>)}
  </div>;
}
