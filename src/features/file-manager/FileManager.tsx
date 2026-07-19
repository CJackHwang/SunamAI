import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import {
  Folder, FileText, ChevronRight, ArrowUp, RefreshCw,
  FilePlus, FolderPlus, Trash2, Pencil, Download, Eye,
  Upload, MoreVertical, X, AlertCircle, FolderOpen
} from 'lucide-react';
import { useFileSystem, type FileEntry } from './useFileSystem.ts';
import './FileManager.css';

interface FileManagerProps {
  wc: WebContainer | null;
  rootDir?: string;
}

// File extensions that can be previewed
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'swift', 'kt', 'php', 'sql', 'graphql', 'vue', 'svelte',
  'env', 'gitignore', 'dockerignore', 'editorconfig', 'prettierrc',
  'eslintrc', 'babelrc', 'lock', 'log',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

function getExtension(name: string): string {
  const parts = name.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FileManager: React.FC<FileManagerProps> = ({ wc, rootDir = '/' }) => {
  const fs = useFileSystem(wc, rootDir);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const isLongPressing = useRef(false);

  // Initial load is now handled inside useFileSystem when rootDir changes

  // Focus rename input when renaming
  useEffect(() => {
    if (renamingEntry && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select filename without extension
      const dotIdx = renameValue.lastIndexOf('.');
      renameInputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : renameValue.length);
    }
  }, [renamingEntry, renameValue]);

  // Focus new item input
  useEffect(() => {
    if (newItemType && newItemInputRef.current) {
      newItemInputRef.current.focus();
    }
  }, [newItemType]);

  // ===== Event Handlers =====

  const handleDownload = useCallback(async (entry: FileEntry) => {
    try {
      const data = await fs.readFileRaw(entry.name);
      const blob = new Blob([new Uint8Array(data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [fs]);

  const handlePreview = useCallback(async (entry: FileEntry) => {
    const ext = getExtension(entry.name);

    if (TEXT_EXTENSIONS.has(ext) || entry.name.startsWith('.')) {
      // Preview text files
      try {
        const content = await fs.readFile(entry.name);
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch {
        handleDownload(entry);
      }
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      // Preview images
      try {
        const data = await fs.readFileRaw(entry.name);
        const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const blob = new Blob([new Uint8Array(data)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch {
        handleDownload(entry);
      }
    } else {
      // Unsupported format — ask to download
      if (confirm(`无法预览 "${entry.name}"，是否下载此文件？`)) {
        handleDownload(entry);
      }
    }
  }, [fs, handleDownload]);

  const handleItemClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.stopPropagation();
    if (isLongPressing.current) {
      isLongPressing.current = false;
      return;
    }
    if (renamingEntry) return;
    setSelectedItem(entry.name);
  }, [renamingEntry]);

  const handleItemDoubleClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.stopPropagation();
    if (renamingEntry) return;

    if (entry.isDirectory) {
      const newPath = fs.currentPath === '/' ? `/${entry.name}` : `${fs.currentPath}/${entry.name}`;
      fs.navigateTo(newPath);
      setSelectedItem(null);
    } else {
      handlePreview(entry);
    }
  }, [fs, renamingEntry, handlePreview]);

  // Context menu (right-click or long-press)
  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleLongPressStart = useCallback((e: React.TouchEvent, entry: FileEntry) => {
    isLongPressing.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPressing.current = true;
      const touch = e.touches[0];
      setContextMenu({ x: touch.clientX, y: touch.clientY, entry });
    }, 400);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Rename
  const startRename = useCallback((entry: FileEntry) => {
    setRenamingEntry(entry.name);
    setRenameValue(entry.name);
    closeContextMenu();
  }, [closeContextMenu]);

  const confirmRename = useCallback(async () => {
    if (renamingEntry && renameValue.trim() && renameValue !== renamingEntry) {
      await fs.rename(renamingEntry, renameValue.trim());
    }
    setRenamingEntry(null);
    setRenameValue('');
  }, [renamingEntry, renameValue, fs]);

  // Delete
  const handleDelete = useCallback(async (entry: FileEntry) => {
    closeContextMenu();
    const type = entry.isDirectory ? '文件夹' : '文件';
    if (confirm(`确定删除${type} "${entry.name}" 吗？`)) {
      await fs.remove(entry.name);
    }
  }, [fs, closeContextMenu]);

  // New file/folder
  const confirmNewItem = useCallback(async () => {
    if (!newItemName.trim()) {
      setNewItemType(null);
      return;
    }
    if (newItemType === 'file') {
      await fs.createFile(newItemName.trim());
    } else if (newItemType === 'folder') {
      await fs.createDir(newItemName.trim());
    }
    setNewItemType(null);
    setNewItemName('');
  }, [newItemType, newItemName, fs]);

  // Drag & Drop — external files upload
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      await fs.uploadFiles(e.dataTransfer.files);
    }
  }, [fs]);

  // Internal drag: move file into folder
  const handleInternalDragStart = useCallback((e: React.DragEvent, entry: FileEntry) => {
    e.dataTransfer.setData('text/plain', entry.name);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderName: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderName);
  }, []);

  const handleFolderDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  const handleFolderDrop = useCallback(async (e: React.DragEvent, folderName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);

    const sourceName = e.dataTransfer.getData('text/plain');
    if (sourceName && sourceName !== folderName) {
      const destDir = fs.currentPath === '/' ? `/${folderName}` : `${fs.currentPath}/${folderName}`;
      await fs.moveFile(sourceName, destDir);
    }
  }, [fs]);

  // Upload button (mobile)
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await fs.uploadFiles(e.target.files);
      e.target.value = '';
    }
  }, [fs]);

  // ===== Breadcrumb =====
  const rootName = rootDir !== '/' ? rootDir.replace(/^\//, '') : 'sunam';
  const relativePath = fs.currentPath.startsWith(rootDir) && rootDir !== '/' ? fs.currentPath.slice(rootDir.length) : fs.currentPath;
  const breadcrumbSegments = relativePath === '' || relativePath === '/'
    ? ['/']
    : ['/', ...relativePath.split('/').filter(Boolean)];

  // ===== Render =====
  return (
    <div
      className={`fm-container ${isDragOver ? 'fm-drop-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Toolbar */}
      <div className="fm-toolbar">
        <button
          className="fm-toolbar-btn"
          onClick={fs.goUp}
          disabled={fs.currentPath === '/'}
          title="返回上级"
        >
          <ArrowUp size={18} />
        </button>

        {/* Breadcrumb */}
        <div className="fm-breadcrumb">
          {breadcrumbSegments.map((segment, idx) => {
            const path = idx === 0 ? rootDir : (rootDir === '/' ? '' : rootDir) + '/' + breadcrumbSegments.slice(1, idx + 1).join('/');
            const isLast = idx === breadcrumbSegments.length - 1;

            return (
              <React.Fragment key={path}>
                {idx > 0 && <ChevronRight size={12} className="fm-breadcrumb-sep" />}
                <button
                  className={`fm-breadcrumb-segment ${isLast ? 'active' : ''}`}
                  onClick={() => !isLast && fs.navigateTo(path)}
                >
                  {segment === '/' ? rootName : segment}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <button className="fm-toolbar-btn" onClick={fs.refresh} title="刷新">
          <RefreshCw size={16} />
        </button>
        <button className="fm-toolbar-btn" onClick={() => { setNewItemType('file'); setNewItemName(''); }} title="新建文件">
          <FilePlus size={18} />
        </button>
        <button className="fm-toolbar-btn" onClick={() => { setNewItemType('folder'); setNewItemName(''); }} title="新建文件夹">
          <FolderPlus size={18} />
        </button>
        <button className="fm-toolbar-btn" onClick={handleUploadClick} title="上传文件">
          <Upload size={18} />
        </button>
      </div>

      {/* Error banner */}
      {fs.error && (
        <div className="fm-error">
          <AlertCircle size={14} />
          {fs.error}
          <button style={{ marginLeft: 'auto' }} onClick={() => {}}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="fm-drop-label">
          <Upload size={24} style={{ marginRight: 8 }} />
          释放文件以上传到当前目录
        </div>
      )}

      {/* File list */}
      <div className="fm-list" ref={listRef} onClick={() => setSelectedItem(null)}>
        {/* New item inline form */}
        {newItemType && (
          <div className="fm-new-dialog">
            {newItemType === 'folder' ? <Folder size={20} color="var(--color-black)" /> : <FileText size={20} color="var(--color-black)" />}
            <input
              ref={newItemInputRef}
              className="input-field"
              style={{ flex: 1, minWidth: 0, height: '36px', padding: '0 12px' }}
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmNewItem();
                if (e.key === 'Escape') { setNewItemType(null); setNewItemName(''); }
              }}
              placeholder={newItemType === 'folder' ? '文件夹名称' : '文件名称'}
            />
            <button className="btn btn-primary" style={{ height: '36px', padding: '0 16px' }} onClick={confirmNewItem}>创建</button>
            <button className="btn btn-secondary" style={{ height: '36px', padding: '0 16px' }} onClick={() => { setNewItemType(null); setNewItemName(''); }}>取消</button>
          </div>
        )}

        {/* Loading state */}
        {fs.isLoading && fs.entries.length === 0 && (
          <>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="fm-skeleton">
                <div className="fm-skeleton-icon" />
                <div className="fm-skeleton-text" style={{ width: `${40 + Math.random() * 40}%` }} />
              </div>
            ))}
          </>
        )}

        {/* Empty state */}
        {!fs.isLoading && fs.entries.length === 0 && (
          <div className="fm-empty">
            <FolderOpen size={40} color="var(--color-black)" />
            <span>空文件夹</span>
            <span style={{ fontSize: 12 }}>拖拽文件到此处上传，或点击工具栏按钮新建</span>
          </div>
        )}

        {/* File entries */}
        {fs.entries.map(entry => (
          <div
            key={entry.name}
            className={`fm-item ${dragOverFolder === entry.name ? 'drag-over' : ''} ${selectedItem === entry.name ? 'selected' : ''}`}
            onClick={(e) => handleItemClick(e, entry)}
            onDoubleClick={(e) => handleItemDoubleClick(e, entry)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
            onTouchStart={(e) => handleLongPressStart(e, entry)}
            onTouchEnd={handleLongPressEnd}
            onTouchMove={handleLongPressEnd}
            draggable={!renamingEntry}
            onDragStart={(e) => handleInternalDragStart(e, entry)}
            {...(entry.isDirectory ? {
              onDragOver: (e: React.DragEvent) => handleFolderDragOver(e, entry.name),
              onDragLeave: handleFolderDragLeave,
              onDrop: (e: React.DragEvent) => handleFolderDrop(e, entry.name),
            } : {})}
          >
            {/* Icon */}
            <div className={`fm-item-icon ${entry.isDirectory ? 'folder' : ''}`}>
              {entry.isDirectory ? <Folder size={22} /> : <FileText size={22} />}
            </div>

            {/* Name (or rename input) */}
            {renamingEntry === entry.name ? (
              <input
                ref={renameInputRef}
                className="input-field"
                style={{ flex: 1, minWidth: 0, height: '32px', padding: '0 10px' }}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmRename();
                  if (e.key === 'Escape') { setRenamingEntry(null); setRenameValue(''); }
                }}
                onBlur={confirmRename}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="fm-item-name">{entry.name}</span>
            )}

            {/* Size */}
            {!entry.isDirectory && (
              <span className="fm-item-size">{formatSize(entry.size)}</span>
            )}

            {/* Mobile: more button */}
            <button
              className="fm-toolbar-btn"
              style={{ width: 32, height: 32, display: 'none' }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                setContextMenu({ x: rect.right, y: rect.bottom, entry });
              }}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="context-overlay" onClick={closeContextMenu} onContextMenu={e => { e.preventDefault(); closeContextMenu(); }} />
          <div
            className="context-menu"
            style={{
              left: `min(${contextMenu.x}px, calc(100vw - 200px))`,
              top: `min(${contextMenu.y}px, calc(100vh - 250px))`,
            }}
          >
            {!contextMenu.entry.isDirectory && (
              <>
                <button className="context-item" onClick={() => { handlePreview(contextMenu.entry); closeContextMenu(); }}>
                  <Eye size={16} className="context-item-icon" />
                  预览
                </button>
                <button className="context-item" onClick={() => { handleDownload(contextMenu.entry); closeContextMenu(); }}>
                  <Download size={16} className="context-item-icon" />
                  下载
                </button>
                <div className="context-divider" />
              </>
            )}
            <button className="context-item" onClick={() => startRename(contextMenu.entry)}>
              <Pencil size={16} className="context-item-icon" />
              重命名
            </button>
            <button className="context-item danger" onClick={() => handleDelete(contextMenu.entry)}>
              <Trash2 size={16} className="context-item-icon" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default FileManager;
