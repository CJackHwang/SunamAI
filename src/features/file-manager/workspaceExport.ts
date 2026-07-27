import type { WebContainer } from '@webcontainer/api';

export async function downloadWorkspaceArchive(wc: WebContainer, rootDir: string): Promise<void> {
  const archive = await wc.export(rootDir, { format: 'zip' });
  const url = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  const rootName = rootDir.split('/').filter(Boolean).at(-1) || 'sunam-workspace';
  anchor.href = url;
  anchor.download = `${rootName}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
