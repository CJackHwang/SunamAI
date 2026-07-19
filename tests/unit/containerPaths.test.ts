import { describe, expect, it } from 'vitest';
import { getContainerRoot, relativeContainerPath, resolveContainerPath } from '@/shared/lib/containerPaths';

describe('container path boundary', () => {
  it('uses one v2 root and refuses traversal from every consumer path', () => {
    expect(getContainerRoot('c-1')).toBe('.sunam/workspaces/c-1');
    expect(resolveContainerPath('c-1', 'src/main.ts')).toBe('.sunam/workspaces/c-1/src/main.ts');
    expect(relativeContainerPath('c-1', '.sunam/workspaces/c-1/src/main.ts')).toBe('src/main.ts');
    expect(() => resolveContainerPath('c-1', '../secret')).toThrow('escapes');
    expect(() => getContainerRoot('old-container')).toThrow('Invalid');
  });
});
