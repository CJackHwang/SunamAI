import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { ResourceProcessorRegistry } from '@/features/agent-core/resourceProcessor';
import { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { clearV3Database } from '../helpers/persistenceDatabase';

describe('ResourceProcessorRegistry', () => {
  let repository: V3PersistenceRepository;
  let processor: ResourceProcessorRegistry;
  beforeEach(async () => { await clearV3Database(); repository = new V3PersistenceRepository(); processor = new ResourceProcessorRegistry(repository); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('persists text as a deduplicated session blob without returning its body', async () => {
    const file = new NodeFile(['secret body'], 'notes.txt', { type: 'text/plain' }) as unknown as File;
    const firstPromise = processor.process([{ name: file.name, size: file.size, type: file.type, file }], 's-1', 'r-1');
    await expect(firstPromise).resolves.toHaveLength(1);
    const first = await firstPromise;
    const second = await processor.process([{ name: file.name, size: file.size, type: file.type, file }], 's-1', 'r-2');
    expect(first).toEqual([expect.objectContaining({ kind: 'text', name: 'notes.txt', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(first[0]).not.toHaveProperty('blob');
    expect(second[0]?.id).toBe(first[0]?.id);
    expect((await repository.listResources('s-1')).value).toHaveLength(1);
    expect(await (await repository.loadResource(first[0]!.id)).value?.blob.text()).toBe('secret body');
  });

  it('rejects image MIME spoofing and accepts a genuine small PNG signature', async () => {
    const spoofed = new NodeFile(['not a png'], 'fake.png', { type: 'image/png' }) as unknown as File;
    await expect(processor.process([{ name: spoofed.name, size: spoofed.size, type: spoofed.type, file: spoofed }], 's-1', 'r-1')).rejects.toThrow('does not match');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
    const png = new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'real.png', { type: 'image/png' }) as unknown as File;
    await expect(processor.process([{ name: png.name, size: png.size, type: png.type, file: png }], 's-1', 'r-1')).resolves.toEqual([expect.objectContaining({ kind: 'image', mimeType: 'image/png' })]);
    vi.unstubAllGlobals();
  });

  it('rejects a binary body disguised as text', async () => {
    const binary = new NodeFile([new Uint8Array([65, 0, 66])], 'bad.txt', { type: 'text/plain' }) as unknown as File;
    await expect(processor.process([{ name: binary.name, size: binary.size, type: binary.type, file: binary }], 's-1', 'r-1')).rejects.toThrow('contains binary data');
    const invalidUtf8 = new NodeFile([new Uint8Array([0xff, 0xfe, 0xfd])], 'invalid.txt', { type: 'text/plain' }) as unknown as File;
    await expect(processor.process([{ name: invalidUtf8.name, size: invalidUtf8.size, type: invalidUtf8.type, file: invalidUtf8 }], 's-1', 'r-1')).rejects.toThrow('contains binary data');
  });

  it('fails closed when image dimensions cannot be verified', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const png = new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'real.png', { type: 'image/png' }) as unknown as File;
    await expect(processor.process([{ name: png.name, size: png.size, type: png.type, file: png }], 's-1', 'r-1')).rejects.toThrow('cannot be verified safely');
    vi.unstubAllGlobals();
  });

  it('commits a batch only after every resource passes validation', async () => {
    const valid = new NodeFile(['valid'], 'valid.txt', { type: 'text/plain' }) as unknown as File;
    const invalid = new NodeFile([new Uint8Array([65, 0, 66])], 'invalid.txt', { type: 'text/plain' }) as unknown as File;
    await expect(processor.process([
      { name: valid.name, size: valid.size, type: valid.type, file: valid },
      { name: invalid.name, size: invalid.size, type: invalid.type, file: invalid },
    ], 's-1', 'r-1')).rejects.toThrow('contains binary data');
    expect((await repository.listResources('s-1')).value).toEqual([]);
  });

  it('enforces resource count and byte limits inside the processor boundary', async () => {
    const files = Array.from({ length: 9 }, (_, index) => new NodeFile(['x'], `${index}.txt`, { type: 'text/plain' }) as unknown as File);
    await expect(processor.process(files.map((file) => ({ name: file.name, size: file.size, type: file.type, file })), 's-limit', 'r-limit')).rejects.toThrow('at most 8');
    const oversized = new NodeFile([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' }) as unknown as File;
    await expect(processor.process([{ name: oversized.name, size: oversized.size, type: oversized.type, file: oversized }], 's-limit', 'r-limit')).rejects.toThrow('2 MiB text resource limit');
    expect((await repository.listResources('s-limit')).value).toEqual([]);
  });

  it('applies count and session ownership checks to durable resource references', async () => {
    await repository.saveResource({ id: 'stored', sessionId: 's-1', originatingRunId: 'r-1', name: 'stored.txt', kind: 'text', mimeType: 'text/plain', size: 1, sha256: 'stored', createdAt: 1, blob: new NodeBlob(['x']) as unknown as Blob });
    const references = Array.from({ length: 9 }, () => ({ name: 'stored.txt', size: 1, type: 'text/plain', resourceId: 'stored' }));
    await expect(processor.process(references, 's-1', 'r-2')).rejects.toThrow('at most 8');
    await expect(processor.process([{ name: 'missing.txt', size: 1, resourceId: 'missing' }], 's-1', 'r-2')).rejects.toThrow('was not found in this session');
    await expect(processor.process([{ name: 'invalid.txt', size: 1 }], 's-1', 'r-2')).rejects.toThrow('no file or durable resource reference');
  });

  it('deduplicates repeated files within the same batch', async () => {
    const first = new NodeFile(['same'], 'first.txt', { type: 'text/plain' }) as unknown as File;
    const second = new NodeFile(['same'], 'second.txt', { type: 'text/plain' }) as unknown as File;
    const resources = await processor.process([
      { name: first.name, size: first.size, type: first.type, file: first },
      { name: second.name, size: second.size, type: second.type, file: second },
    ], 's-1', 'r-1');
    expect(resources[0]?.id).toBe(resources[1]?.id);
    expect((await repository.listResources('s-1')).value).toHaveLength(1);
  });

  it('creates a bounded model copy for images that require transcoding', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4096, height: 1024, close })));
    const originalCreateElement = document.createElement.bind(document);
    let encodes = 0;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob | null) => void) => {
          encodes += 1;
          const size = encodes === 1 ? 1_600_000 : 900_000;
          callback(new NodeBlob([new Uint8Array(size)], { type: 'image/webp' }) as unknown as Blob);
        },
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    const gif = new NodeFile(['GIF89a-image'], 'large.gif', { type: 'image/gif' }) as unknown as File;
    const [resource] = await processor.process([{ name: gif.name, size: gif.size, type: gif.type, file: gif }], 's-image', 'r-image');
    const stored = await repository.loadResource(resource!.id);
    expect(stored.value?.blob.type).toBe('image/gif');
    expect(stored.value?.modelBlob).toMatchObject({ type: 'image/webp', size: 900_000 });
    expect(encodes).toBe(2);
    expect(close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downscales a low-byte image when its decoded edge still exceeds 2048px', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4096, height: 1024, close })));
    const originalCreateElement = document.createElement.bind(document);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob | null) => void) => callback(new NodeBlob(['model'], { type: 'image/webp' }) as unknown as Blob) } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => tagName === 'canvas' ? canvas : originalCreateElement(tagName)) as typeof document.createElement);
    const png = new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'wide.png', { type: 'image/png' }) as unknown as File;
    const [resource] = await processor.process([{ name: png.name, size: png.size, type: png.type, file: png }], 's-wide', 'r-wide');
    const stored = await repository.loadResource(resource!.id);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(512);
    expect(stored.value?.modelBlob?.type).toBe('image/webp');
    expect(close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
