import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { downloadWorkspaceArchive } from '@/features/file-manager/workspaceExport';

describe('downloadWorkspaceArchive', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exports the complete container root as a zip and releases the object URL', async () => {
    vi.useFakeTimers();
    try {
      const exportWorkspace = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));
      const wc = { export: exportWorkspace } as unknown as WebContainer;
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:workspace');
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      await downloadWorkspaceArchive(wc, '/containers/c-demo');

      expect(exportWorkspace).toHaveBeenCalledWith('/containers/c-demo', { format: 'zip' });
      expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/zip' }));
      expect(click).toHaveBeenCalledOnce();
      await vi.runAllTimersAsync();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:workspace');
      expect(document.querySelector('a[download="c-demo.zip"]')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
