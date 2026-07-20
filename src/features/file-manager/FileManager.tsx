import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent, type TouchEvent } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { AlertCircle, Upload, X } from 'lucide-react';
import type { FileEntry } from '@/entities/file/types';
import { useI18n } from '@/shared/i18n';
import { IMAGE_EXTENSIONS, getExtension, isPreviewableFile, TEXT_EXTENSIONS } from './fileUtils';
import { useFileSystem } from './useFileSystem';
import { FileManagerToolbar } from './FileManagerToolbar';
import { FileEntryList } from './FileEntryList';
import { FileContextMenu, type FileContextMenuState } from './FileContextMenu';
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const isLongPressing = useRef(false);

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
  const handleLongPressStart = (event: TouchEvent, entry: FileEntry) => {
    isLongPressing.current = false;
    longPressTimer.current = setTimeout(() => { isLongPressing.current = true; const touch = event.touches[0]; setContextMenu({ x: touch.clientX, y: touch.clientY, entry }); }, 400);
  };
  const handleLongPressEnd = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); longPressTimer.current = null; };
  const handleDragEnter = (event: DragEvent) => { event.preventDefault(); dragCounter.current += 1; if (event.dataTransfer.types.includes('Files')) setIsDragOver(true); };
  const handleDragLeave = (event: DragEvent) => { event.preventDefault(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragOver(false); };
  const handleDrop = async (event: DragEvent) => { event.preventDefault(); dragCounter.current = 0; setIsDragOver(false); if (event.dataTransfer.files.length) await fs.uploadFiles(event.dataTransfer.files); };
  const handleFolderDrop = async (event: DragEvent, folderName: string) => { event.preventDefault(); event.stopPropagation(); setDragOverFolder(null); const source = event.dataTransfer.getData('text/plain'); if (source && source !== folderName) await fs.moveFile(source, fs.currentPath === '/' ? `/${folderName}` : `${fs.currentPath}/${folderName}`); };
  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files?.length) { await fs.uploadFiles(event.target.files); event.target.value = ''; } };

  return <div className={`fm-container ${isDragOver ? 'fm-drop-active' : ''}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
    <input ref={fileInputRef} type="file" multiple className="fm-hidden-input" onChange={handleFileInputChange} />
    <FileManagerToolbar rootDir={rootDir} rootLabel={rootLabel} currentPath={fs.currentPath} onGoUp={fs.goUp} onNavigate={(path) => { void fs.navigateTo(path); }} onRefresh={fs.refresh} onCreateFile={() => { setNewItemType('file'); setNewItemName(''); }} onCreateFolder={() => { setNewItemType('folder'); setNewItemName(''); }} onUpload={() => fileInputRef.current?.click()} />
    {(fs.error || operationError) && <div className="fm-error motion-notice-in"><AlertCircle size={14} />{fs.error || operationError}<button className="fm-error-dismiss" onClick={() => { fs.clearError(); setOperationError(null); }}><X size={14} /></button></div>}
    {isDragOver && <div className="fm-drop-label motion-pop-in"><Upload size={24} className="fm-drop-icon" />{t('files.dropToUpload')}</div>}
    <FileEntryList entries={fs.entries} isLoading={fs.isLoading} selectedItem={selectedItem} dragOverFolder={dragOverFolder} renamingEntry={renamingEntry} renameValue={renameValue} newItemType={newItemType} newItemName={newItemName} listRef={listRef} renameInputRef={renameInputRef} newItemInputRef={newItemInputRef} onClearSelection={() => setSelectedItem(null)} onItemClick={handleItemClick} onItemDoubleClick={handleItemDoubleClick} onOpenContextMenu={openContextMenu} onLongPressStart={handleLongPressStart} onLongPressEnd={handleLongPressEnd} onDragStart={(event, entry) => { event.dataTransfer.setData('text/plain', entry.name); event.dataTransfer.effectAllowed = 'move'; }} onFolderDragOver={(event, name) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOverFolder(name); }} onFolderDragLeave={() => setDragOverFolder(null)} onFolderDrop={handleFolderDrop} onRenameChange={setRenameValue} onRenameConfirm={() => { void confirmRename(); }} onRenameCancel={cancelRename} onNewNameChange={setNewItemName} onNewConfirm={() => { void confirmNewItem(); }} onNewCancel={cancelNewItem} />
    <FileContextMenu menu={contextMenu} onClose={closeContextMenu} onPreview={(entry) => { void handlePreview(entry); }} onDownload={(entry) => { void handleDownload(entry); }} onRename={startRename} onDelete={(entry) => { void handleDelete(entry); }} />
  </div>;
}
