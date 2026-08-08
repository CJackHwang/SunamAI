# TASK-CIRUNTIME — CI runtime 测试确定性失败排查修复

## 背景

CI（GitHub Actions ubuntu）上 runtime 测试**确定性失败**（重试 2 次也挂，本地单独跑全绿）。error-context 铁证：

1. **containerProcessIsolation**：`Expected "ISOLATED" / Received "LEAKED"`——容器 B 的进程表**看到容器 A 的进程**（`cisol-pa`）→ 跨容器进程隔离在 CI 上未生效
2. **webcontainer.smoke**（snapshot 序列化）：`Expected "src" / Received ["package.json"]`——资源物化后**只有 package.json，没有 src 目录** → 快照序列化在 CI 上丢内容

本地全绿（20-44s 跑完）→ CI 挂（90s 超时）→ **确定性环境差异**，非 flake。怀疑方向：
- **CI runner 时序/速度差异**：进程归属判定（host 侧 cwd 前缀解析）依赖启动时序，CI 慢导致 cwd 解析失败 → 进程归错容器
- **WebContainer boot 在 CI 上的差异**：stackblitz 网络慢 / 资源物化（materialize）时序——smoke 的资源 attach → 物化 → 快照链路在 CI 慢环境丢步
- **共享 runner 资源限制**：CI runner 内存/CPU 低于本地，WC 容器资源物化超时

## 物理边界

- contracts 一字不改、UI 视觉零改动、零新增依赖
- **不删测试、不放宽断言**（隔离必须真隔离、快照必须真含 src）
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. 排查根因（先诊断，不急着改）

- **本地复现 CI 失败**：尽量模拟 CI 环境（`CI=true npx playwright test --config playwright.runtime.config.ts` 跑这两个测试）——CI=true 会启用 retries + reuseExistingServer 关闭，先看本地 CI 模式是否复现
- **查两个失败的共同根因**：是否都是"CI 慢环境下的时序/资源竞争"？还是各自独立问题？
- **看 error-context 更多细节**（/tmp/ci-runtime-report/ 有完整快照）：containerProcessIsolation 里 B 的进程表具体显示什么（是 A 的 cisol-pa 完整可见？还是 scope 错标？）；smoke 里快照后的文件树

### R2. 修复（按根因）

**若根因 = 时序/慢环境**：
- 进程归属：host 侧 cwd 解析加等待/重试（进程启动到 ps 之间有延迟，CI 更明显）——或归属判定加"启动后稳定期"
- 资源物化：materialize 链路的等待/超时在 CI 上放大（对齐 webServer timeout 120s 的级别）

**若根因 = CI 特有资源限制**：
- runtime job 加 `--workers=1`（已有）+ 可能需要 `retries`（已有 2 次仍挂 = 不够，或根本不是 flake）
- 评估：runtime job 单独跑这两个测试是否过（其他 runtime 测试可能正常）

### R3. 验证

- 本地 CI 模式复现 → 修复 → 本地 CI 模式全绿
- push 后 CI runtime job 全绿（**这是唯一验收标准**）

## 提交

`fix: CI runtime 确定性失败（进程隔离 + 快照序列化在 CI 环境修复）`
