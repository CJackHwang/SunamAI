import { describe, expect, it } from 'vitest';
import { safeContainerLabel, toDisplayWorkspacePath } from '@/features/terminal-session/displayPaths';

describe('terminal display paths', () => {
  it.each([
    ['.sunam/workspaces/c-demo/src/index.ts', '/containers/演示/src/index.ts'],
    ['~/sunam/.sunam/workspaces/c-demo', '/containers/演示'],
    ['/home/sunam/.sunam/workspaces/c-demo/server.js', '/containers/演示/server.js'],
    ['/home/sunam/sunam/.sunam/workspaces/c-demo/server.js', '/containers/演示/server.js'],
  ])('maps %s without leaking or duplicating separators', (internal, expected) => {
    const displayed = toDisplayWorkspacePath(internal, '演示');
    expect(displayed).toBe(expected);
    expect(displayed).not.toContain('//containers');
    expect(displayed).not.toContain('.sunam/workspaces');
  });

  it('removes path separators and control characters from labels', () => {
    expect(safeContainerLabel('a/b\\c\n')).toBe('a-b-c-');
  });
});
