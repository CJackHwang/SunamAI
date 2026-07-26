import type { ChatAttachment } from '@/entities/message/types';
import type { AgentResource, AgentResourceKind, StoredAgentResource } from '@/entities/resource/types';
import { resourceKind } from '@/shared/contracts/resourcePolicy';
import { MAX_BINARY_RESOURCE_BYTES, MAX_CHAT_ATTACHMENTS, MAX_IMAGE_RESOURCE_BYTES, MAX_RESOURCE_BATCH_BYTES, MAX_TEXT_RESOURCE_BYTES } from '@/shared/contracts/resourcePolicy';
import { createId } from '@/shared/lib/ids';
import { v3Persistence, type V3PersistenceRepository } from '@/entities/persistence/v3Repository';

const MODEL_IMAGE_MAX_EDGE = 2048;
const MODEL_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 12));
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the model image copy.')), type, quality));
}

async function createModelImage(blob: Blob, mimeType: string): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new Error('Image decoding is unavailable in this browser, so the 2048px model-image limit cannot be verified safely.');
  const bitmap = await createImageBitmap(blob);
  try {
    if (blob.size <= MODEL_IMAGE_MAX_BYTES && mimeType !== 'image/gif' && Math.max(bitmap.width, bitmap.height) <= MODEL_IMAGE_MAX_EDGE) return blob;
    let scale = Math.min(1, MODEL_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    let quality = 0.86;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas image processing is unavailable.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encoded = await canvasBlob(canvas, 'image/webp', quality);
      if (encoded.size <= MODEL_IMAGE_MAX_BYTES) return encoded;
      scale *= 0.78;
      quality = Math.max(0.55, quality - 0.08);
    }
    throw new Error('The image could not be reduced below the 1.5 MiB model limit.');
  } finally {
    bitmap.close();
  }
}

function isTextPrefix(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return false; }
  if (!decoded) return true;
  let controls = 0;
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') controls += 1;
  }
  return controls / decoded.length <= 0.01;
}

export class ResourceProcessorRegistry {
  private readonly repository: V3PersistenceRepository;
  constructor(repository: V3PersistenceRepository = v3Persistence) { this.repository = repository; }

  async process(attachments: ChatAttachment[], sessionId: string, runId: string): Promise<AgentResource[]> {
    if (attachments.length > MAX_CHAT_ATTACHMENTS) throw new Error(`Choose at most ${MAX_CHAT_ATTACHMENTS} files.`);
    const incoming = attachments.flatMap((attachment) => attachment.file ? [attachment.file] : []);
    if (incoming.reduce((total, file) => total + file.size, 0) > MAX_RESOURCE_BATCH_BYTES) throw new Error('The selected resource batch is larger than 50 MiB.');
    for (const file of incoming) {
      const kind = resourceKind(file);
      const limit = kind === 'text' ? MAX_TEXT_RESOURCE_BYTES : kind === 'image' ? MAX_IMAGE_RESOURCE_BYTES : MAX_BINARY_RESOURCE_BYTES;
      if (file.size > limit) throw new Error(`${file.name} is larger than the ${limit / 1024 / 1024} MiB ${kind} resource limit.`);
    }
    const resources: AgentResource[] = [];
    const pending: StoredAgentResource[] = [];
    const byDigest = new Map<string, StoredAgentResource>();
    for (const attachment of attachments) {
      if (!attachment.file) {
        if (!attachment.resourceId) throw new Error(`${attachment.name} has no file or durable resource reference.`);
        const existing = await this.repository.loadResource(attachment.resourceId);
        if (!existing.value || existing.value.sessionId !== sessionId) throw new Error(`Resource ${attachment.resourceId} was not found in this session.`);
        resources.push(this.metadata(existing.value));
        continue;
      }
      const blob = attachment.file.slice(0, attachment.file.size, attachment.file.type || 'application/octet-stream');
      const digest = await sha256(blob);
      let duplicate;
      try { duplicate = await this.repository.findResourceBySha(sessionId, digest); }
      catch (error) { throw new Error(`Could not check resource deduplication for ${attachment.name}.`, { cause: error }); }
      if (duplicate.value) { resources.push(this.metadata(duplicate.value)); continue; }
      const pendingDuplicate = byDigest.get(digest);
      if (pendingDuplicate) { resources.push(this.metadata(pendingDuplicate)); continue; }
      const declaredKind = resourceKind(attachment.file);
      let kind: AgentResourceKind = declaredKind;
      let mimeType = attachment.file.type || 'application/octet-stream';
      let modelBlob: Blob | undefined;
      if (declaredKind === 'image') {
        const actualMime = sniffImageMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
        if (!actualMime || actualMime !== mimeType) throw new Error(`${attachment.name} does not match its declared image MIME type.`);
        mimeType = actualMime;
        modelBlob = await createModelImage(blob, mimeType);
      } else if (declaredKind === 'text') {
        const prefix = new Uint8Array(await blob.slice(0, Math.min(blob.size, 8_192)).arrayBuffer());
        if (!isTextPrefix(prefix)) throw new Error(`${attachment.name} was declared as text but contains binary data.`);
      } else {
        kind = 'binary';
      }
      const stored: StoredAgentResource = {
        id: createId('res'), sessionId, originatingRunId: runId, name: attachment.name, kind, mimeType, size: blob.size, sha256: digest, createdAt: Date.now(), blob,
        ...(modelBlob ? { modelBlob } : {}),
      };
      pending.push(stored);
      byDigest.set(digest, stored);
      resources.push(this.metadata(stored));
    }
    if (resources.reduce((total, resource) => total + resource.size, 0) > MAX_RESOURCE_BATCH_BYTES) throw new Error('The selected resource batch is larger than 50 MiB.');
    try { await this.repository.saveResources(pending); }
    catch (error) { throw new Error('Could not persist the resource batch.', { cause: error }); }
    return resources;
  }

  private metadata(resource: StoredAgentResource): AgentResource {
    const { blob: _blob, modelBlob: _modelBlob, ...metadata } = resource;
    return metadata;
  }
}
