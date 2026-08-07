import { readText, removeText, STORAGE_KEYS, writeText } from '@/shared/lib/storage';

/**
 * R2 受限环境持久化标记。
 *
 * 环境不支持启动 Succinix（非 Chromium / 无 COOP/COEP，导致 Succinix boot 失败 → 受限）
 * 时记录一次标记（localStorage `sunam_container_unavailable=1`），像主动关闭一样持久化——
 * 下次进入不自动开启容器，避免无效加载（每次受限触发重试都会重新等待 boot 失败）。
 *
 * 清除时机（如实记录）：
 *  - 用户手动重试（retryContainer / 能力库开关）→ 清除标记重新检测；
 *  - 用户显式重新开启容器开关（setContainerEnabled(true)）→ 清除标记（等同于手动重试）；
 *  - 一次 boot 成功（环境已可用）→ 清除标记。
 * 标记本身不改变受限判定标准（R3）：判定仍是 boot 失败 → restricted，这里只改触发后的持久化行为。
 */

export function isContainerUnavailable(): boolean {
  return readText(STORAGE_KEYS.containerUnavailable) === '1';
}

export function markContainerUnavailable(): void {
  writeText(STORAGE_KEYS.containerUnavailable, '1');
}

export function clearContainerUnavailable(): void {
  removeText(STORAGE_KEYS.containerUnavailable);
}
