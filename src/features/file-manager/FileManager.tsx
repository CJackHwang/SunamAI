import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { createPortal } from 'react-dom';
import { AlertCircle, FileText, Folder, Upload, X } from 'lucide-react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { IMAGE_EXTENSIONS, getExtension, isPreviewableFile, TEXT_EXTENSIONS } from './fileUtils';
import { useFileSystem } from './useFileSystem';
import { FileManagerToolbar } from './FileManagerToolbar';
import { FileEntryList } from './FileEntryList';
import { FileContextMenu, type FileContextMenuState } from './FileContextMenu';
import { useFileManagerDragDrop } from './useFileManagerDragDrop';
import { useFileManagerTouch } from './useFileManagerTouch';
import './FileManager.css';

interface FileManagerProps { wc: WebContainer | null; rootDir?: string; rootLabel?: string; }

export default function FileManager({ wc, rootDir = '/', rootLabel }: FileManagerProps) {
  const { t, format } = useI18n();
  const fs = useFileSystem(wc, rootDir);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [operationError, setOperationError] = useState<string | null>(null);
  
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);

  const { isDragOver, dragOverFolder, setDragOverFolder, handleDragEnter, handleDragLeave, handleDrop, handleFolderDrop, handleParentDrop } = useFileManagerDragDrop(fs);
  const { touchDrag, isLongPressing, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel } = useFileManagerTouch(fs, (entry, x, y) => setContextMenu({ x, y, entry }), setDragOverFolder);

  useEffect(() => {
    if (!renamingEntry || !renameInputRef.current) return;
    renameInputRef.current.focus();
    const dotIndex = renameValue.lastIndexOf('.');
    renameInputRef.current.setSelectionRange(0, dotIndex > 0 ? dotIndex : renameValue.length);
  }, [renamingEntry, renameValue]);
  useEffect(() => { if (newItemType) newItemInputRef.current?.focus(); }, [newItemType]);

  const handleDownload = useCallback(async (entry: FileEntry) => {
    try {
      const url = URL.createObjectURL(new Blob([new Uint8Array(await fs.readFileRaw(entry.name))]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = entry.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setOperationError(`Download failed: ${error instanceof Error ? error.message : String(error)}`); }
  }, [fs]);
  const handlePreview = useCallback(async (entry: FileEntry) => {
    const extension = getExtension(entry.name);
    try {
      if (TEXT_EXTENSIONS.has(extension) || entry.name.startsWith('.')) {
        const url = URL.createObjectURL(new Blob([await fs.readFile(entry.name)], { type: 'text/plain;charset=utf-8' }));
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
      if (IMAGE_EXTENSIONS.has(extension)) {
        const type = extension === 'svg' ? 'image/svg+xml' : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
        const url = URL.createObjectURL(new Blob([new Uint8Array(await fs.readFileRaw(entry.name))], { type }));
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
    } catch (error) {
      setOperationError(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (window.confirm(format('files.previewUnsupported', { name: entry.name }))) await handleDownload(entry);
  }, [format, fs, handleDownload]);
  
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const startRename = useCallback((entry: FileEntry) => { setRenamingEntry(entry.name); setRenameValue(entry.name); closeContextMenu(); }, [closeContextMenu]);
  const confirmRename = useCallback(async () => {
    if (renamingEntry && renameValue.trim() && renameValue !== renamingEntry) await fs.rename(renamingEntry, renameValue.trim());
    setRenamingEntry(null);
    setRenameValue('');
  }, [fs, renameValue, renamingEntry]);
  const cancelRename = () => { setRenamingEntry(null); setRenameValue(''); };
  const handleDelete = useCallback(async (entry: FileEntry) => {
    closeContextMenu();
    const type = entry.isDirectory ? t('files.folder') : t('files.file');
    if (window.confirm(format('files.confirmDelete', { type, name: entry.name }))) await fs.remove(entry.name);
  }, [closeContextMenu, format, fs, t]);
  const confirmNewItem = useCallback(async () => {
    if (!newItemName.trim()) { setNewItemType(null); return; }
    if (newItemType === 'file') await fs.createFile(newItemName.trim());
    if (newItemType === 'folder') await fs.createDir(newItemName.trim());
    setNewItemType(null);
    setNewItemName('');
  }, [fs, newItemName, newItemType]);
  const cancelNewItem = () => { setNewItemType(null); setNewItemName(''); };
  
  const handleItemClick = (event: MouseEvent, entry: FileEntry) => {
    event.stopPropagation();
    if (isLongPressing.current) { isLongPressing.current = false; return; }
    if (!renamingEntry) setSelectedItem(entry.name);
  };
  const handleItemDoubleClick = (event: MouseEvent, entry: FileEntry) => {
    event.stopPropagation();
    if (renamingEntry) return;
    if (entry.isDirectory) { void fs.navigateTo(fs.currentPath === '/' ? `/${entry.name}` : `${fs.currentPath}/${entry.name}`); setSelectedItem(null); }
    else if (isPreviewableFile(entry.name)) void handlePreview(entry);
    else void handleDownload(entry);
  };
  const openContextMenu = (entry: FileEntry, x: number, y: number) => setContextMenu({ x, y, entry });
  
  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files?.length) { await fs.uploadFiles(event.target.files); event.target.value = ''; } };

  return <div className={`fm-container ${isDragOver ? 'fm-drop-active' : ''} ${touchDrag ? 'fm-touch-dragging' : ''}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
    <input ref={fileInputRef} type="file" multiple className="fm-hidden-input" onChange={handleFileInputChange} />
    <FileManagerToolbar rootDir={rootDir} {...(rootLabel ? { rootLabel } : {})} currentPath={fs.currentPath} onNavigate={(path) => { void fs.navigateTo(path); }} onRefresh={fs.refresh} onCreateFile={() => { setNewItemType('file'); setNewItemName(''); }} onCreateFolder={() => { setNewItemType('folder'); setNewItemName(''); }} onUpload={() => fileInputRef.current?.click()} />
    {(fs.error || operationError) && <div className="fm-error motion-notice-in"><AlertCircle size={14} />{fs.error || operationError}<button className="fm-error-dismiss" onClick={() => { fs.clearError(); setOperationError(null); }}><X size={14} /></button></div>}
    {isDragOver && <div className="fm-drop-label motion-pop-in"><Upload size={24} className="fm-drop-icon" />{t('files.dropToUpload')}</div>}
    <FileEntryList entries={fs.entries} isLoading={fs.isLoading} selectedItem={selectedItem} dragOverFolder={dragOverFolder} renamingEntry={renamingEntry} renameValue={renameValue} newItemType={newItemType} newItemName={newItemName} showParentEntry={Boolean(fs.parentPath)} isParentDragOver={dragOverFolder === '..'} listRef={listRef} renameInputRef={renameInputRef} newItemInputRef={newItemInputRef} onClearSelection={() => setSelectedItem(null)} onGoUp={fs.goUp} onParentDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOverFolder('..'); }} onParentDrop={(event) => { void handleParentDrop(event); }} onItemClick={handleItemClick} onItemDoubleClick={handleItemDoubleClick} onOpenContextMenu={openContextMenu} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel} onDragStart={(event, entry) => { event.dataTransfer.setData('text/plain', entry.name); event.dataTransfer.effectAllowed = 'move'; }} onFolderDragOver={(event, name) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOverFolder(name); }} onFolderDragLeave={() => setDragOverFolder(null)} onFolderDrop={handleFolderDrop} onRenameChange={setRenameValue} onRenameConfirm={() => { void confirmRename(); }} onRenameCancel={cancelRename} onNewNameChange={setNewItemName} onNewConfirm={() => { void confirmNewItem(); }} onNewCancel={cancelNewItem} />
    <FileContextMenu menu={contextMenu} onClose={closeContextMenu} onPreview={(entry) => { void handlePreview(entry); }} onDownload={(entry) => { void handleDownload(entry); }} onRename={startRename} onDelete={(entry) => { void handleDelete(entry); }} />
    {touchDrag && createPortal(<div className="fm-touch-drag-preview" style={{ left: touchDrag.x, top: touchDrag.y }}>{touchDrag.entry.isDirectory ? <Folder size={18} /> : <FileText size={18} />}<span>{touchDrag.entry.name}</span></div>, document.body)}
  </div>;
}
