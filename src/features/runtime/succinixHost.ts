import type { FileSystemAPI, WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { SuccinixClient } from './succinixClient';

// Succinix TerminalExecutor host 守护进程的注入/拉起（H1-1）。
// 参考 ~/Desktop/MyProject/WebUnix/src/engine/index.ts 的 bootEngineHost：
// 浏览器侧把构建产物 host.js / lifo-core.js / pyodide 资产写入容器（wc.fs 根 == host 进程 cwd），
// spawn `node host.js` 常驻进程，ping 探活后客户端才可消费 /cmd.json。
// 资产来源：scripts/sync-succinix-assets.mjs 从 WebUnix public/ 同步到 SunamAI public/succinix/
//（dev/build 均以 /succinix/* 静态路径提供，Vite publicDir 机制；产物 gitignored）。

// 资产基址：可经 VITE_SUCCINIX_ASSET_BASE 覆盖（部署时资产可挂到其他前缀）。
const ASSET_BASE = import.meta.env.VITE_SUCCINIX_ASSET_BASE ?? '/succinix';
const HOST_JS = '/host.js';
const LIFO_CORE_JS = '/lifo-core.js';
// host 侧 python 运行时约定目录（host.ts：PYTHON_DAEMON_JS = process.cwd()/usr/lib/succinix/python/python-daemon.js）。
const PYTHON_RUNTIME_DIR = '/usr/lib/succinix/python';

const PYTHON_ASSETS: ReadonlyArray<{ path: string; url: string }> = [
  { path: `${PYTHON_RUNTIME_DIR}/python-daemon.js`, url: 'pyodide/python-daemon.js' },
  { path: `${PYTHON_RUNTIME_DIR}/pyodide.mjs`, url: 'pyodide/pyodide.mjs' },
  { path: `${PYTHON_RUNTIME_DIR}/pyodide.asm.mjs`, url: 'pyodide/pyodide.asm.mjs' },
  { path: `${PYTHON_RUNTIME_DIR}/pyodide.asm.wasm`, url: 'pyodide/pyodide.asm.wasm' },
  { path: `${PYTHON_RUNTIME_DIR}/python_stdlib.zip`, url: 'pyodide/python_stdlib.zip' },
  { path: `${PYTHON_RUNTIME_DIR}/pyodide-lock.json`, url: 'pyodide/pyodide-lock.json' },
];

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 幂等拉取资产文本（404 等网络错误向上抛，调用方决定是否致命）。 */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Succinix asset fetch failed: ${url} (HTTP ${response.status})`);
  return response.text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Succinix asset fetch failed: ${url} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** 确保容器内已有某个文本资产（host.js / lifo-core.js）；缺失则从构建产物拉取并写入。 */
async function ensureAsset(webcontainer: WebContainer, containerPath: string, assetUrl: string): Promise<void> {
  try {
    await webcontainer.fs.readFile(containerPath, 'utf-8');
    return;
  } catch {
    // 容器内缺失：注入
  }
  await webcontainer.fs.writeFile(containerPath, await fetchText(`${ASSET_BASE}/${assetUrl}`));
}

/** 等待 host 就绪：命令轮询循环可响应（ping → pong）。 */
async function waitForHostReady(client: SuccinixClient, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await client.ping()) return;
    await sleep(100);
  }
  throw new Error('Succinix host did not become ready.');
}

export interface SuccinixHostHandle {
  /** host 进程句柄（dispose 时 kill）。 */
  readonly hostProcess: WebContainerProcess;
}

/**
 * 注入 host.js → spawn `node host.js` 常驻进程 → ping 探活 → 注入 lifo-core.js。
 * lifo-core.js 同步等待完成（run 的 cd 前缀依赖 Lifo 内核，首条命令即可用）；
 * python 资产后台懒注入（首个 python 命令前由 ensurePythonRuntime 兜底 await）。
 */
export async function bootSuccinixHost(webcontainer: WebContainer, client: SuccinixClient): Promise<SuccinixHostHandle> {
  await ensureAsset(webcontainer, HOST_JS, 'host.js');
  const hostProcess = await webcontainer.spawn('node', ['host.js']);
  await waitForHostReady(client);
  await ensureAsset(webcontainer, LIFO_CORE_JS, 'lifo-core.js');
  // python 运行时约 13MB，首用前懒注入；此处后台预热，失败不影响 host 拉起。
  void ensurePythonRuntime(webcontainer.fs).catch(() => {});
  return { hostProcess };
}

// ─── python 运行时懒注入（首用幂等）───

let pythonReady: Promise<void> | null = null;

/**
 * 确保 python 运行时资产已注入（幂等）。并发调用复用同一注入 Promise；
 * 注入失败清空缓存，下次调用重试。
 */
export function ensurePythonRuntime(fs: FileSystemAPI): Promise<void> {
  if (!pythonReady) {
    pythonReady = doInjectPython(fs).finally(() => {
      pythonReady = null;
    });
  }
  return pythonReady;
}

async function doInjectPython(fs: FileSystemAPI): Promise<void> {
  for (const asset of PYTHON_ASSETS) {
    const bytes = await fetchBytes(`${ASSET_BASE}/${asset.url}`);
    const parent = asset.path.slice(0, asset.path.lastIndexOf('/'));
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(asset.path, bytes);
  }
}

/** 宽松判定命令是否涉及 python/pip（首用前需注入运行时资产）。 */
export function mentionsPython(command: string): boolean {
  return /(^|\s)(python|python3|pip|pip3)(\s|$)/.test(command.trim());
}
