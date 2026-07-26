import type { WebContainer } from '@webcontainer/api';
import type { RuntimePortStatus, RuntimeServiceSource } from '@/shared/contracts/terminal';
import { createId } from '@/shared/lib/ids';

type WebContainerProcess = Awaited<ReturnType<WebContainer['spawn']>>;

const RUNTIME_DIRECTORY = '.sunam/runtime';
const SERVICE_HOOK_PATH = `${RUNTIME_DIRECTORY}/service-hook.cjs`;
const SERVICE_EVENT_PATH = `${RUNTIME_DIRECTORY}/service-events.jsonl`;
const ORPHAN_RECONCILIATION_MS = 1_500;
const STOP_WAIT_MS = 3_000;
const MAX_EVENT_FILE_BYTES = 256 * 1024;

interface ListenerRecord {
  action: 'listening' | 'closed';
  launchId: string;
  containerId: string;
  pid: number;
  port: number;
  timestamp: number;
}

function isListenerRecord(value: unknown): value is ListenerRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (record.action === 'listening' || record.action === 'closed')
    && typeof record.launchId === 'string' && record.launchId.length > 0
    && typeof record.containerId === 'string' && record.containerId.length > 0
    && typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
    && typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65_535
    && typeof record.timestamp === 'number' && Number.isInteger(record.timestamp) && record.timestamp >= 0;
}

interface ManagedLaunch {
  id: string;
  source: RuntimeServiceSource;
  containerId: string;
  command: string;
  process: WebContainerProcess;
  processId?: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  status: 'running' | 'stopping' | 'exited';
}

export interface ManagedSpawnRequest {
  source: RuntimeServiceSource;
  containerId: string;
  command: string;
  args?: string[];
  cwd?: string;
  processId?: string;
  sessionId?: string;
  runId?: string;
  env?: Record<string, string>;
}

export interface ManagedSpawnResult {
  launchId: string;
  process: WebContainerProcess;
}

const SERVICE_HOOK_SOURCE = String.raw`
'use strict';
const fs = require('node:fs');
const net = require('node:net');
const marker = Symbol.for('sunam.service-listener-hook');
if (!net.Server.prototype[marker]) {
  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const server = this;
    let listeningPort = 0;
    server.once('listening', () => {
      const address = server.address();
      listeningPort = address && typeof address === 'object' ? address.port : 0;
      record('listening', listeningPort);
    });
    server.once('close', () => record('closed', listeningPort));
    return originalListen.apply(server, args);
  };
  Object.defineProperty(net.Server.prototype, marker, { value: true });
}
function record(action, port) {
  try {
    const eventFile = process.env.SUNAM_SERVICE_EVENT_FILE;
    const launchId = process.env.SUNAM_LAUNCH_ID;
    const containerId = process.env.SUNAM_CONTAINER_ID;
    if (!eventFile || !launchId || !containerId || !Number.isInteger(port) || port < 1) return;
    fs.appendFileSync(eventFile, JSON.stringify({ action, launchId, containerId, pid: process.pid, port, timestamp: Date.now() }) + '\n');
  } catch {}
}
`;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class RuntimeServiceRegistry {
  private readonly webcontainer: WebContainer;
  private readonly onError: (error: unknown) => void;
  private readonly launches = new Map<string, ManagedLaunch>();
  private readonly ports = new Map<number, RuntimePortStatus>();
  private readonly listenersByPort = new Map<number, ListenerRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly orphanTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly launchStopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processedRecords = new Set<string>();
  private initializePromise: Promise<void> | null = null;
  private eventWatcher: { close(): void } | null = null;
  private unsubscribePort: (() => void) | null = null;
  private unsubscribeReady: (() => void) | null = null;
  private readQueued = false;

  constructor(webcontainer: WebContainer, onError: (error: unknown) => void) {
    this.webcontainer = webcontainer;
    this.onError = onError;
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.initializeInternal();
    return this.initializePromise;
  }

  private async initializeInternal(): Promise<void> {
    await this.webcontainer.fs.mkdir(RUNTIME_DIRECTORY, { recursive: true });
    await this.webcontainer.fs.writeFile(SERVICE_HOOK_PATH, SERVICE_HOOK_SOURCE);
    await this.webcontainer.fs.writeFile(SERVICE_EVENT_PATH, '');
    this.eventWatcher = this.webcontainer.fs.watch(RUNTIME_DIRECTORY, () => this.queueReadEvents());
    this.unsubscribeReady = this.webcontainer.on('server-ready', (port, url) => this.openPort(port, url));
    this.unsubscribePort = this.webcontainer.on('port', (port, type, url) => {
      if (type === 'close') this.closePort(port);
      else this.openPort(port, url);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPorts(): RuntimePortStatus[] {
    return [...this.ports.values()].sort((left, right) => left.port - right.port).map((port) => ({ ...port }));
  }

  async spawn(request: ManagedSpawnRequest): Promise<ManagedSpawnResult> {
    await this.initialize();
    const launchId = createId('launch');
    const hookPath = `${this.webcontainer.workdir}/${SERVICE_HOOK_PATH}`;
    const eventPath = `${this.webcontainer.workdir}/${SERVICE_EVENT_PATH}`;
    const env = {
      ...request.env,
      NODE_OPTIONS: `--require ${hookPath}`,
      SUNAM_LAUNCH_ID: launchId,
      SUNAM_CONTAINER_ID: request.containerId,
      SUNAM_SERVICE_EVENT_FILE: eventPath,
    };
    const process = await this.webcontainer.spawn(request.command, request.args ?? [], {
      env,
      ...(request.cwd ? { cwd: request.cwd } : {}),
    });
    const launch: ManagedLaunch = {
      id: launchId,
      source: request.source,
      containerId: request.containerId,
      command: request.command,
      process,
      startedAt: Date.now(),
      status: 'running',
      ...(request.processId ? { processId: request.processId } : {}),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.runId ? { runId: request.runId } : {}),
    };
    this.launches.set(launchId, launch);
    this.reconcileLaunch(launchId);
    void process.exit.then(() => this.markLaunchExited(launchId), (error) => { this.onError(error); this.markLaunchExited(launchId); });
    return { launchId, process };
  }

  stopLaunch(launchId: string): boolean {
    const launch = this.launches.get(launchId);
    if (!launch || launch.status !== 'running') return false;
    launch.status = 'stopping';
    this.markPortsStopping(launchId);
    launch.process.kill();
    this.scheduleLaunchStopFallback(launchId);
    return true;
  }

  async stopPort(portNumber: number): Promise<boolean> {
    const port = this.ports.get(portNumber);
    if (!port || port.state !== 'managed' || !port.launchId) return false;
    const launch = this.launches.get(port.launchId);
    if (!launch || launch.status === 'stopping') {
      this.updatePort(portNumber, { ...port, state: 'orphaned' });
      return false;
    }
    this.updatePort(portNumber, { ...port, state: 'stopping' });
    try {
      if (launch.status === 'running' && launch.source === 'agent') {
        launch.status = 'stopping';
        this.markPortsStopping(launch.id);
        launch.process.kill();
        this.scheduleLaunchStopFallback(launch.id);
      } else if (port.pid) await this.killPid(port.pid);
      else launch.process.kill();
    } catch (error) {
      this.onError(error);
      this.updatePort(portNumber, { ...port, state: 'orphaned' });
      return false;
    }
    const deadline = Date.now() + STOP_WAIT_MS;
    while (this.ports.has(portNumber) && Date.now() < deadline) await sleep(50);
    if (!this.ports.has(portNumber)) return true;
    this.updatePort(portNumber, { ...port, state: 'orphaned' });
    return false;
  }

  dispose(): void {
    this.unsubscribePort?.();
    this.unsubscribeReady?.();
    this.eventWatcher?.close();
    this.orphanTimers.forEach((timer) => clearTimeout(timer));
    this.orphanTimers.clear();
    this.launchStopTimers.forEach((timer) => clearTimeout(timer));
    this.launchStopTimers.clear();
    for (const launch of this.launches.values()) if (launch.status === 'running' || launch.status === 'stopping') launch.process.kill();
    this.launches.clear();
    this.ports.clear();
    this.listenersByPort.clear();
    this.listeners.clear();
    this.processedRecords.clear();
  }

  private async killPid(pid: number): Promise<void> {
    const helper = await this.webcontainer.spawn('node', ['-e', "process.kill(Number(process.argv[1]), 'SIGTERM')", String(pid)], { env: {} });
    const exitCode = await Promise.race([helper.exit, sleep(STOP_WAIT_MS).then(() => null)]);
    if (exitCode === null) {
      helper.kill();
      throw new Error(`Timed out while stopping registered service process ${pid}.`);
    }
    if (exitCode !== 0) throw new Error(`Unable to stop registered service process ${pid}.`);
  }

  private markLaunchExited(launchId: string): void {
    const launch = this.launches.get(launchId);
    if (!launch) return;
    launch.status = 'exited';
    if (![...this.ports.values()].some((port) => port.launchId === launchId)) this.launches.delete(launchId);
  }

  private markPortsStopping(launchId: string): void {
    for (const [portNumber, port] of this.ports) {
      if (port.launchId === launchId) this.updatePort(portNumber, { ...port, state: 'stopping' });
    }
  }

  private scheduleLaunchStopFallback(launchId: string): void {
    const existing = this.launchStopTimers.get(launchId);
    if (existing) clearTimeout(existing);
    this.launchStopTimers.set(launchId, setTimeout(() => {
      this.launchStopTimers.delete(launchId);
      this.markPortsOrphaned(launchId);
    }, STOP_WAIT_MS));
  }

  private markPortsOrphaned(launchId: string): void {
    for (const [portNumber, port] of this.ports) {
      if (port.launchId === launchId) this.updatePort(portNumber, { ...port, state: 'orphaned' });
    }
  }

  private openPort(portNumber: number, url: string): void {
    const existing = this.ports.get(portNumber);
    const listener = this.listenersByPort.get(portNumber);
    const managed = listener ? this.managedPort(portNumber, url, listener) : null;
    this.updatePort(portNumber, managed ?? { port: portNumber, url: url || existing?.url || '', state: existing?.state === 'stopping' ? 'stopping' : 'identifying', ...(existing?.source ? { source: existing.source } : {}), ...(existing?.containerId ? { containerId: existing.containerId } : {}), ...(existing?.launchId ? { launchId: existing.launchId } : {}), ...(existing?.processId ? { processId: existing.processId } : {}), ...(existing?.pid ? { pid: existing.pid } : {}) });
    if (!managed && existing?.state !== 'stopping') this.scheduleOrphanClassification(portNumber);
  }

  private closePort(portNumber: number): void {
    const timer = this.orphanTimers.get(portNumber);
    if (timer) clearTimeout(timer);
    this.orphanTimers.delete(portNumber);
    this.listenersByPort.delete(portNumber);
    const launchId = this.ports.get(portNumber)?.launchId;
    if (this.ports.delete(portNumber)) this.publish();
    if (launchId && ![...this.ports.values()].some((port) => port.launchId === launchId)) {
      const stopTimer = this.launchStopTimers.get(launchId);
      if (stopTimer) clearTimeout(stopTimer);
      this.launchStopTimers.delete(launchId);
      if (this.launches.get(launchId)?.status === 'exited') this.launches.delete(launchId);
    }
  }

  private managedPort(portNumber: number, url: string, record: ListenerRecord): RuntimePortStatus | null {
    const launch = this.launches.get(record.launchId);
    if (!launch || launch.status === 'stopping' || launch.containerId !== record.containerId) return null;
    return {
      port: portNumber,
      url,
      state: 'managed',
      source: launch.source,
      containerId: launch.containerId,
      launchId: launch.id,
      pid: record.pid,
      ...(launch.processId ? { processId: launch.processId } : {}),
    };
  }

  private scheduleOrphanClassification(portNumber: number): void {
    const existing = this.orphanTimers.get(portNumber);
    if (existing) clearTimeout(existing);
    this.orphanTimers.set(portNumber, setTimeout(() => {
      this.orphanTimers.delete(portNumber);
      const port = this.ports.get(portNumber);
      if (port?.state === 'identifying') this.updatePort(portNumber, { ...port, state: 'orphaned' });
    }, ORPHAN_RECONCILIATION_MS));
  }

  private reconcileLaunch(launchId: string): void {
    for (const record of this.listenersByPort.values()) {
      if (record.launchId !== launchId) continue;
      const port = this.ports.get(record.port);
      if (!port) continue;
      const managed = this.managedPort(record.port, port.url, record);
      if (managed) this.updatePort(record.port, managed);
    }
  }

  private queueReadEvents(): void {
    if (this.readQueued) return;
    this.readQueued = true;
    queueMicrotask(() => {
      this.readQueued = false;
      void this.readEvents().catch(this.onError);
    });
  }

  private async readEvents(): Promise<void> {
    const content = await this.webcontainer.fs.readFile(SERVICE_EVENT_PATH, 'utf-8');
    for (const line of content.split('\n').filter(Boolean)) {
      if (this.processedRecords.has(line)) continue;
      this.processedRecords.add(line);
      let unknownRecord: unknown;
      try { unknownRecord = JSON.parse(line); } catch { this.onError(new Error('Invalid runtime service event JSON.')); continue; }
      if (!isListenerRecord(unknownRecord)) { this.onError(new Error('Invalid runtime service event record.')); continue; }
      this.consumeListenerRecord(unknownRecord);
    }
    if (new TextEncoder().encode(content).byteLength > MAX_EVENT_FILE_BYTES) {
      this.processedRecords.clear();
      await this.webcontainer.fs.writeFile(SERVICE_EVENT_PATH, '');
    }
  }

  private consumeListenerRecord(record: ListenerRecord): void {
    if (record.action === 'closed') {
      const current = this.listenersByPort.get(record.port);
      if (current?.launchId === record.launchId && current.pid === record.pid) this.listenersByPort.delete(record.port);
      return;
    }
    this.listenersByPort.set(record.port, record);
    const port = this.ports.get(record.port);
    if (!port) return;
    const managed = this.managedPort(record.port, port.url, record);
    if (managed) {
      const timer = this.orphanTimers.get(record.port);
      if (timer) clearTimeout(timer);
      this.orphanTimers.delete(record.port);
      this.updatePort(record.port, managed);
    }
  }

  private updatePort(portNumber: number, port: RuntimePortStatus): void {
    this.ports.set(portNumber, port);
    this.publish();
  }

  private publish(): void {
    this.listeners.forEach((listener) => listener());
  }
}
