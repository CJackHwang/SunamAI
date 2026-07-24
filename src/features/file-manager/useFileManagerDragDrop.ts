import { type DragEvent, useRef, useState } from 'react';

export function useFileManagerDragDrop(fs: {
  currentPath: string;
  parentPath: string | null;
  uploadFiles: (files: FileList) => Promise<void>;
  moveFile: (source: string, destination: string) => Promise<void>;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current += 1;
    if (event.dataTransfer.types.includes('Files')) setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (event.dataTransfer.files.length) await fs.uploadFiles(event.dataTransfer.files);
  };

  const handleFolderDrop = async (event: DragEvent, folderName: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolder(null);
    const source = event.dataTransfer.getData('text/plain');
    if (source && source !== folderName) {
      await fs.moveFile(source, fs.currentPath === '/' ? `/${folderName}` : `${fs.currentPath}/${folderName}`);
    }
  };

  const handleParentDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolder(null);
    const source = event.dataTransfer.getData('text/plain');
    if (source && fs.parentPath) await fs.moveFile(source, fs.parentPath);
  };

  return {
    isDragOver,
    dragOverFolder,
    setDragOverFolder,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFolderDrop,
    handleParentDrop,
  };
}
