import { useState, type MouseEvent } from 'react';
import { ChevronRight, Download, FilePlus, FolderPlus, Loader2, MoreHorizontal, RefreshCw, Upload } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import { ActionMenu, type ActionMenuState } from '@/shared/ui/ActionMenu';

interface FileManagerToolbarProps {
  rootDir: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onUpload: () => void;
  onExport: () => void | Promise<void>;
  isExporting: boolean;
}

export function FileManagerToolbar({ rootDir, currentPath, onNavigate, onRefresh, onCreateFile, onCreateFolder, onUpload, onExport, isExporting }: FileManagerToolbarProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<ActionMenuState | null>(null);
  const isCurrentPathValid = rootDir === '/' || currentPath === rootDir || currentPath.startsWith(`${rootDir}/`);
  const relativePath = !isCurrentPathValid ? '' : rootDir !== '/' ? currentPath.slice(rootDir.length) : currentPath;
  const segments = relativePath === '' || relativePath === '/' ? ['/'] : ['/', ...relativePath.split('/').filter(Boolean)];
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right, y: rect.bottom });
  };
  return <div className="fm-toolbar">
    <div className="fm-breadcrumb">{segments.map((segment, index) => {
      const path = index === 0 ? rootDir : `${rootDir === '/' ? '' : rootDir}/${segments.slice(1, index + 1).join('/')}`;
      const isLast = index === segments.length - 1;
      return <span key={path}>{index > 0 && <ChevronRight size={12} className="fm-breadcrumb-sep" />}<button className={`fm-breadcrumb-segment ${isLast ? 'active' : ''}`} onClick={() => !isLast && onNavigate(path)}>{segment}</button></span>;
    })}</div>
    <button className="fm-toolbar-btn" onClick={onRefresh} title={t('common.refresh')}><RefreshCw size={16} /></button>
    <button className="fm-toolbar-btn" onClick={openMenu} title={isExporting ? t('files.exportingWorkspace') : t('files.moreActions')} aria-label={t('files.moreActions')}>{isExporting ? <Loader2 size={18} className="animate-spin" /> : <MoreHorizontal size={18} />}</button>
    <ActionMenu menu={menu} onClose={() => setMenu(null)} ariaLabel={t('files.moreActions')} className="fm-tools-menu" items={() => [
      { id: 'new-file', label: t('files.newFile'), icon: FilePlus, onSelect: onCreateFile },
      { id: 'new-folder', label: t('files.newFolder'), icon: FolderPlus, onSelect: onCreateFolder },
      { id: 'upload', label: t('files.upload'), icon: Upload, onSelect: onUpload },
      { id: 'export', label: isExporting ? t('files.exportingWorkspace') : t('files.exportWorkspace'), icon: isExporting ? Loader2 : Download, onSelect: onExport, disabled: isExporting, separatorBefore: true },
    ]} />
  </div>;
}
