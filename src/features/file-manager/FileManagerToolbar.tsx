import { ArrowLeft, ChevronRight, FilePlus, FolderPlus, RefreshCw, Upload } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

interface FileManagerToolbarProps {
  rootDir: string;
  rootLabel?: string;
  currentPath: string;
  onGoUp: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onUpload: () => void;
}

export function FileManagerToolbar({ rootDir, rootLabel, currentPath, onGoUp, onNavigate, onRefresh, onCreateFile, onCreateFolder, onUpload }: FileManagerToolbarProps) {
  const { t } = useI18n();
  const rootName = rootLabel ?? (rootDir !== '/' ? rootDir.replace(/^\//, '') : 'sunam');
  const relativePath = currentPath.startsWith(rootDir) && rootDir !== '/' ? currentPath.slice(rootDir.length) : currentPath;
  const segments = relativePath === '' || relativePath === '/' ? ['/'] : ['/', ...relativePath.split('/').filter(Boolean)];
  return <div className="fm-toolbar">
    <button className="fm-toolbar-btn" onClick={onGoUp} disabled={currentPath === rootDir || currentPath === '/'} title={t('files.goUp')}><ArrowLeft size={18} /></button>
    <div className="fm-breadcrumb">{segments.map((segment, index) => {
      const path = index === 0 ? rootDir : `${rootDir === '/' ? '' : rootDir}/${segments.slice(1, index + 1).join('/')}`;
      const isLast = index === segments.length - 1;
      return <span key={path}>{index > 0 && <ChevronRight size={12} className="fm-breadcrumb-sep" />}<button className={`fm-breadcrumb-segment ${isLast ? 'active' : ''}`} onClick={() => !isLast && onNavigate(path)}>{segment === '/' ? rootName : segment}</button></span>;
    })}</div>
    <button className="fm-toolbar-btn" onClick={onRefresh} title={t('common.refresh')}><RefreshCw size={16} /></button>
    <button className="fm-toolbar-btn" onClick={onCreateFile} title={t('files.newFile')}><FilePlus size={18} /></button>
    <button className="fm-toolbar-btn" onClick={onCreateFolder} title={t('files.newFolder')}><FolderPlus size={18} /></button>
    <button className="fm-toolbar-btn" onClick={onUpload} title={t('files.upload')}><Upload size={18} /></button>
  </div>;
}
