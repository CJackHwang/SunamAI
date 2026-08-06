import type { FileSystemAPI } from '@webcontainer/api';

// M3 快照双层协调 —— Succinix 文件快照层（SunamAI 侧驱动）。
//
// 背景：容器内现在有两套持久化。SunamAI 的 v3 快照（snapshotCoordinator + v3Repository）
// 只管工作区文件树（getContainerRoot(containerId)，750ms debounce，boot 时 ensure() mount）。
// Succinix 的文件快照（WebUnix persist.ts 同构，IndexedDB 库 succinix-persist）本应覆盖整个
// 容器 FS 的系统层（/etc 状态、.pyodide pip 包、日志、motd 等）。但 WebUnix 的自动快照循环在
// 其 main.ts（浏览器入口）里，SunamAI 只注入 host.js / lifo-core.js / pyodide 运行时资产，
// 从不加载 main.ts —— 因此系统层从未被持久化，刷新后 /etc 与 pip 包丢失。
//
// 本模块在 SunamAI 侧补齐这层：与 WebUnix persist.ts 同构（同一 IndexedDB 库/存储/键、同一
// 排除规则、同一签名门控），但按 R2 职责分离新增一条排除 —— SunamAI 工作区容器目录（c-*）
// 归属 v3 快照，本层不碰，避免对同一批工作区文件双写。恢复/保存时机由
// WebContainerAgentRuntime 协调（R1：先恢复系统层 → 再拉起 host → ensure() mount 工作区）。
//
// 排除规则与 WebUnix persist.ts 对齐（可对照 ~/Desktop/MyProject/WebUnix/src/persist.ts）：
//   - 任意层级 node_modules / dist / .git（依赖与构建产物，量大且可重建）
//   - host.js / lifo-core.js（boot 重新注入的 host 进程脚本）
//   - cmd.json / result-*.json（文件 RPC 通道与临时结果文件）
//   - succinix.engine.json（引擎配置，随 boot 重写）
//   - /usr/lib/succinix 前缀（python 运行时系统资产，懒注入重建，非用户数据）
//   - .tinbase 任意层级（PGlite wasm 二进制数据，文本快照无法忠实收录）
//   - M3 新增：顶层 c-*（SunamAI 工作区容器目录，v3 snapshotCoordinator 负责）
// 二进制启发（utf8 解码出现 U+FFFD）同样跳过并计数 —— 与 WebUnix 边界一致（R4）。
import { toErrorMessage } from '@/shared/lib/errors';

export interface SuccinixFileSnapshotMeta {
  version: 1;
  savedAt: number;
  fileCount: number;
  totalBytes: number;
  /** 签名用文件数/总字节（不含 /var/log/succinix.log —— 日志每条命令都在增长，计入会让自动快照每次全量重写） */
  sigFileCount?: number;
  sigTotalBytes?: number;
}

interface SnapshotRecord {
  meta: SuccinixFileSnapshotMeta;
  files: Array<{ path: string; content: string }>;
  /** 空目录路径（空目录不产生文件，不收录则刷新后丢失） */
  emptyDirs?: string[];
}

export interface SuccinixSaveResult {
  meta: SuccinixFileSnapshotMeta;
  skipped: boolean;
}

const DB_NAME = 'succinix-persist';
const STORE_NAME = 'snapshots';
const KEY = 'current';

// 与 WebUnix persist.ts 相同的 POC 上限（~50MB）。
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

// 日志文件：参与遍历（随快照持久），但不参与签名计算（日志持续增长，计入会让每次自动快照全量重写）。
const LOG_FILE = '/var/log/succinix.log';

const EMPTY_META: SuccinixFileSnapshotMeta = { version: 1, savedAt: 0, fileCount: 0, totalBytes: 0 };

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXCLUDED_FILES = new Set(['host.js', 'lifo-core.js', 'cmd.json', 'succinix.engine.json']);
const EXCLUDED_PREFIXES = ['/usr/lib/succinix'];
// M3 R2 职责分离：SunamAI 工作区容器根（c-*）由 v3 snapshotCoordinator 负责，本层排除，
// 避免对同一批工作区文件双写。与 getContainerRoot 的 CONTAINER_ID_PATTERN 对齐。
const CONTAINER_ROOT_PATTERN = /^c-[a-z0-9_-]+$/i;

function isResultFile(name: string): boolean {
  return /^result-\d+\.json$/.test(name);
}

function isLogFile(path: string): boolean {
  return path === LOG_FILE;
}

/** 命中排除即剪枝：node_modules/dist/.git/.tinbase 任意层级整体跳过；
 *  顶层 c-*（SunamAI 工作区容器目录）跳过；文件按名跳过 host/lifo/cmd/succinix.engine.json/result-*.json。 */
function isExcludedPath(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;
  const segments = path.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    if (EXCLUDED_DIRS.has(segment)) return true;
    if (segment === '.tinbase') return true;
    // M3：顶层容器目录（c-*）归属 v3 工作区快照，本层只读不写。
    if (i === 0 && CONTAINER_ROOT_PATTERN.test(segment)) return true;
  }
  const base = segments[segments.length - 1] ?? '';
  return EXCLUDED_FILES.has(base) || isResultFile(base);
}

interface Collected {
  files: Array<{ path: string; content: string }>;
  totalBytes: number;
  sigFileCount: number;
  sigTotalBytes: number;
  skipped: number;
  emptyDirs: string[];
}

const EMPTY_COLLECT: Collected = { files: [], totalBytes: 0, sigFileCount: 0, sigTotalBytes: 0, skipped: 0, emptyDirs: [] };

async function collectDir(fs: FileSystemAPI, dir: string): Promise<Collected> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return EMPTY_COLLECT; // 目录被并发删除：跳过该分支而非整批 reject
  }
  if (entries.length === 0) {
    return { files: [], totalBytes: 0, sigFileCount: 0, sigTotalBytes: 0, skipped: 0, emptyDirs: [dir] };
  }
  const parts = await Promise.all(
    entries.map(async (ent): Promise<Collected> => {
      const name = String(ent.name);
      const path = dir === '/' ? `/${name}` : `${dir}/${name}`;
      if (isExcludedPath(path)) return EMPTY_COLLECT;
      if (ent.isDirectory()) return collectDir(fs, path);
      if (!ent.isFile()) return EMPTY_COLLECT; // symlink/未知类型不收集，避免死循环
      let content: string;
      try {
        content = await fs.readFile(path, 'utf8');
      } catch {
        return { files: [], totalBytes: 0, sigFileCount: 0, sigTotalBytes: 0, skipped: 1, emptyDirs: [] };
      }
      // 二进制启发：utf8 解码出现 U+FFFD 替换字符即视为二进制，跳过并计数（与 WebUnix 一致）。
      if (content.includes('�')) return { files: [], totalBytes: 0, sigFileCount: 0, sigTotalBytes: 0, skipped: 1, emptyDirs: [] };
      const excludedFromSig = isLogFile(path);
      return {
        files: [{ path, content }],
        totalBytes: content.length,
        sigFileCount: excludedFromSig ? 0 : 1,
        sigTotalBytes: excludedFromSig ? 0 : content.length,
        skipped: 0,
        emptyDirs: [],
      };
    })
  );
  return parts.reduce(
    (acc, part) => ({
      files: acc.files.concat(part.files),
      totalBytes: acc.totalBytes + part.totalBytes,
      sigFileCount: acc.sigFileCount + part.sigFileCount,
      sigTotalBytes: acc.sigTotalBytes + part.sigTotalBytes,
      skipped: acc.skipped + part.skipped,
      emptyDirs: acc.emptyDirs.concat(part.emptyDirs),
    }),
    { files: [], totalBytes: 0, sigFileCount: 0, sigTotalBytes: 0, skipped: 0, emptyDirs: [] }
  );
}

// 遍历前门控：目录列表签名（与 WebUnix persist.ts 同构）。
// 自动快照每 ~2.5s 全量遍历系统层是无谓开销，这里加 readdir 层面的轻量签名：
// 签名与上次一致则直接复用上次结果。覆盖范围说明：readdir 结果不含文件大小，
// 只捕捉目录结构变化（增/删/改名）；纯内容级修改由 force 保存收录（pagehide 兜底）。
interface ListingGate {
  lastListingSig: string | null;
  lastCollected: Collected | null;
}

async function computeListingSignature(fs: FileSystemAPI, dir: string): Promise<string> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return `${dir}=ERR;`;
  }
  const list: Array<{ name: string; path: string; isDir: boolean }> = [];
  for (const ent of entries) {
    const name = String(ent.name);
    const path = dir === '/' ? `/${name}` : `${dir}/${name}`;
    if (isExcludedPath(path)) continue;
    list.push({ name, path, isDir: ent.isDirectory() });
  }
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const self = list.map((entry) => `${entry.name}:${entry.isDir ? 'd' : 'f'}`).join(',');
  const childSigs = await Promise.all(list.filter((entry) => entry.isDir).map((entry) => computeListingSignature(fs, entry.path)));
  return `${dir}=${self};${childSigs.join('')}`;
}

async function collectWithGate(fs: FileSystemAPI, force: boolean, gate: ListingGate): Promise<Collected> {
  let sig: string | null;
  try {
    sig = await computeListingSignature(fs, '/');
  } catch {
    sig = null;
  }
  if (!force && gate.lastListingSig !== null && gate.lastCollected && sig !== null && sig === gate.lastListingSig) {
    return gate.lastCollected;
  }
  const collected = await collectDir(fs, '/');
  gate.lastListingSig = sig;
  gate.lastCollected = collected;
  return collected;
}

// ─── IndexedDB：原生 API + 轻量 promise 封装（不新增依赖）───
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('indexeddb open failed'));
      };
    });
  }
  return dbPromise;
}

function idbReq<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return getDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const txn = db.transaction(STORE_NAME, mode);
        const req = fn(txn.objectStore(STORE_NAME));
        txn.oncomplete = () => resolve(req.result);
        txn.onerror = () => reject(txn.error ?? new Error('indexeddb transaction error'));
        txn.onabort = () => reject(txn.error ?? new Error('indexeddb transaction aborted'));
      })
  );
}

/** SunamAI 侧驱动的 Succinix 文件快照协调器（M3）。 */
export class SuccinixFileSnapshotCoordinator {
  private readonly fs: FileSystemAPI;
  private readonly onError: (error: string) => void;
  private readonly autoIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly state: SaveState;
  private inflight: Promise<SuccinixSaveResult> | null = null;
  private disposed = false;
  private readonly pagehideFlush = (): void => {
    void this.save(true).catch(() => undefined);
  };

  constructor(fs: FileSystemAPI, autoIntervalMs = 2_500, onError: (error: string) => void = () => undefined) {
    this.fs = fs;
    this.autoIntervalMs = autoIntervalMs;
    this.onError = onError;
    this.state = {
      listingGate: { lastListingSig: null, lastCollected: null },
      lastSignature: { fileCount: -1, totalBytes: -1, emptyDirsKey: '' },
      lastSavedMeta: null,
      overLimitWarned: false,
      cleared: false,
    };
  }

  /** 恢复系统层快照（/etc、.pyodide、日志等）到容器 FS。无快照/失败静默（全新系统或恢复失败继续）。 */
  async restore(): Promise<SuccinixFileSnapshotMeta | null> {
    if (this.disposed) return null;
    try {
      const meta = await loadFileSnapshot(this.fs, this.state);
      // 恢复写回了整树：目录列表签名缓存已过期，置空让下一次保存重新全量遍历。
      this.state.listingGate.lastListingSig = null;
      this.state.listingGate.lastCollected = null;
      return meta;
    } catch (error) {
      this.onError(`Succinix file snapshot restore failed: ${toErrorMessage(error)}`);
      return null;
    }
  }

  /** 启动自动快照循环（~2.5s + pagehide/beforeunload 兜底）。幂等。 */
  start(): void {
    if (this.disposed || this.timer) return;
    this.timer = setInterval(() => {
      void this.snapshot().catch((error) => this.onError(`Succinix file snapshot failed: ${toErrorMessage(error)}`));
    }, this.autoIntervalMs);
    window.addEventListener('pagehide', this.pagehideFlush);
    window.addEventListener('beforeunload', this.pagehideFlush);
  }

  /** 非 force 保存一次：内容/结构未变则复用上次结果（自动快照的去重语义）。 */
  async snapshot(): Promise<SuccinixSaveResult> {
    return this.save(false);
  }

  /** 立即强制保存一次（刷新/关闭前兜底；force 跳过内容缓存与签名门控）。 */
  async flush(): Promise<SuccinixSaveResult> {
    return this.save(true);
  }

  private async save(force = false): Promise<SuccinixSaveResult> {
    if (this.disposed) return { meta: this.state.lastSavedMeta ?? EMPTY_META, skipped: false };
    if (this.inflight) {
      if (!force) return this.inflight;
      return this.inflight.then(() => this.save(true));
    }
    const work = doSave(this.fs, this.state, force);
    this.inflight = work.finally(() => { this.inflight = null; });
    return this.inflight;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    window.removeEventListener('pagehide', this.pagehideFlush);
    window.removeEventListener('beforeunload', this.pagehideFlush);
  }
}

// ─── 内部保存/恢复（经 SaveState 读写去重/门控状态）───
interface SaveState {
  listingGate: ListingGate;
  lastSignature: { fileCount: number; totalBytes: number; emptyDirsKey: string };
  lastSavedMeta: SuccinixFileSnapshotMeta | null;
  overLimitWarned: boolean;
  cleared: boolean;
}

async function doSave(fs: FileSystemAPI, state: SaveState, force: boolean): Promise<SuccinixSaveResult> {
  const collected = await collectWithGate(fs, force, state.listingGate);
  if (collected.totalBytes > MAX_SNAPSHOT_BYTES) {
    if (!state.overLimitWarned) {
      console.warn(`[succinix-persist] snapshot skipped: ${collected.totalBytes} bytes exceeds ${MAX_SNAPSHOT_BYTES} limit`);
      state.overLimitWarned = true;
    }
    return { meta: state.lastSavedMeta ?? EMPTY_META, skipped: true };
  }
  state.overLimitWarned = false;

  const sigFileCount = collected.sigFileCount;
  const sigTotalBytes = collected.sigTotalBytes;
  const emptyDirsKey = collected.emptyDirs.slice().sort().join(' ');
  if (!force && state.lastSavedMeta && state.lastSignature.fileCount === sigFileCount && state.lastSignature.totalBytes === sigTotalBytes && state.lastSignature.emptyDirsKey === emptyDirsKey) {
    return { meta: state.lastSavedMeta, skipped: false };
  }
  if (state.cleared) return { meta: state.lastSavedMeta ?? EMPTY_META, skipped: false };

  const meta: SuccinixFileSnapshotMeta = { version: 1, savedAt: Date.now(), fileCount: collected.files.length, totalBytes: collected.totalBytes, sigFileCount, sigTotalBytes };
  const record: SnapshotRecord = { meta, files: collected.files, emptyDirs: collected.emptyDirs };
  await idbReq('readwrite', (store) => store.put(record, KEY));
  state.lastSignature = { fileCount: sigFileCount, totalBytes: sigTotalBytes, emptyDirsKey };
  state.lastSavedMeta = meta;
  if (collected.skipped > 0) {
    console.warn(`[succinix-persist] snapshot saved: ${record.files.length} files, ${meta.totalBytes} bytes (skipped ${collected.skipped} binary/unreadable)`);
  }
  return { meta, skipped: false };
}

async function loadFileSnapshot(fs: FileSystemAPI, state: SaveState): Promise<SuccinixFileSnapshotMeta | null> {
  const record = await idbReq<SnapshotRecord | undefined>('readonly', (store) => store.get(KEY));
  if (!record) return null;
  for (const file of record.files) {
    await ensureParentDir(fs, file.path);
    await fs.writeFile(file.path, file.content);
  }
  for (const dir of record.emptyDirs ?? []) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      /* 目录已存在等，恢复继续 */
    }
  }
  state.lastSavedMeta = record.meta;
  state.lastSignature = {
    fileCount: record.meta.sigFileCount ?? record.meta.fileCount,
    totalBytes: record.meta.sigTotalBytes ?? record.meta.totalBytes,
    emptyDirsKey: (record.emptyDirs ?? []).slice().sort().join(' '),
  };
  return record.meta;
}

async function ensureParentDir(fs: FileSystemAPI, path: string): Promise<void> {
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return;
  try {
    await fs.mkdir(path.slice(0, idx), { recursive: true });
  } catch {
    /* 目录已存在等，恢复继续 */
  }
}
