import { describe, expect, it } from 'vitest';
import { getContainerPublicPath, getContainerRoot, relativeContainerPath, resolveContainerPath, WEB_CONTAINER_HOME, WEB_CONTAINER_WORKDIR_NAME } from '@/shared/lib/containerPaths';

describe('container path boundary', () => {
  it('uses one real public workspace root for relative and canonical absolute paths', () => {
    expect(WEB_CONTAINER_WORKDIR_NAME).toBe('workspace');
    expect(WEB_CONTAINER_HOME).toBe('/home/workspace');
    expect(getContainerRoot('c-1')).toBe('c-1');
    expect(getContainerPublicPath('c-1')).toBe('/home/workspace/c-1');
    expect(resolveContainerPath('c-1')).toBe('c-1');
    expect(resolveContainerPath('c-1', 'src/main.ts')).toBe('c-1/src/main.ts');
    expect(resolveContainerPath('c-1', '/home/workspace/c-1/src/main.ts')).toBe('c-1/src/main.ts');
    expect(resolveContainerPath('c-1', '/home/workspace/c-1')).toBe('c-1');
    expect(relativeContainerPath('c-1', 'c-1/src/main.ts')).toBe('src/main.ts');
  });

  it.each([
    '../secret',
    'src/../secret',
    './src/main.ts',
    'src//main.ts',
    'home/user/story-project',
    '/home/user/story-project',
    'home/workspace/c-1/story-project',
    '.sunam/workspaces/c-1/story-project',
    '/home/sunam/.sunam/workspaces/c-1/story-project',
    'containers/demo/story-project',
    '/containers/demo/story-project',
    'c-1/story-project',
    'c-2/story-project',
    '/home/workspace/c-2/story-project',
    'src\\main.ts',
  ])('rejects ambiguous, legacy, foreign, or escaping path %s', (path) => {
    expect(() => resolveContainerPath('c-1', path)).toThrow(/Invalid workspace path.*\/home\/workspace\/c-1/);
  });

  it('rejects invalid identifiers and paths outside the active relative root', () => {
    expect(() => getContainerRoot('old-container')).toThrow('Invalid');
    expect(() => relativeContainerPath('c-1', 'c-2/src/main.ts')).toThrow('outside');
    expect(() => resolveContainerPath('c-1', `src${String.fromCharCode(0)}main.ts`)).toThrow('control characters');
  });
});
