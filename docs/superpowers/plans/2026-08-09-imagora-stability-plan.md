# Imagora Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复已复现的 Windows 路径错误，统一默认质量为 `high`，修好自动整理，并增加不会覆盖手动存档的画布恢复快照与可测试任务队列。

**Architecture:** 保留 FastAPI、React Flow 和现有 API 契约。后端新增独立恢复快照目录，前端把排队状态抽为纯 TypeScript 模块，并通过小型 hook 接入自动保存。

**Tech Stack:** Python 3.12、FastAPI、pytest、React 19、TypeScript、Vite、Vitest、@xyflow/react

---

## 文件结构

- Modify: `server.py` - 路径边界与生成参数默认值。
- Modify: `core/config.py` - 全局默认质量。
- Modify: `core/canvas.py` - 原子恢复快照、轮转与读取。
- Modify: `tests/test_server_helpers.py` - Windows 跨盘回归测试。
- Modify: `tests/test_core_canvas.py` - 恢复快照不覆盖手动存档测试。
- Modify: `tests/test_server_canvas.py` - 恢复快照路由测试。
- Modify: `frontend/src/App.tsx` - 经典表单默认质量。
- Modify: `frontend/src/workflow.ts` - 旧工作流质量归一化与确定性自动整理。
- Modify: `frontend/src/components/CanvasPage.tsx` - 队列、自动保存和稳定 fitView 接入。
- Create: `frontend/src/generationQueue.ts` - 并发与任务生命周期。
- Create: `frontend/src/generationQueue.test.ts` - 队列回归测试。
- Create: `frontend/src/workflow.test.ts` - 默认质量与自动整理测试。
- Create: `frontend/src/useCanvasRecovery.ts` - 恢复快照防抖保存与恢复。
- Modify: `frontend/src/api.ts` - 恢复快照 API。
- Modify: `frontend/package.json` / `frontend/package-lock.json` - Vitest。

### Task 1: Windows 路径安全

**Files:**
- Modify: `tests/test_server_helpers.py`
- Modify: `server.py:70-80,317-324`

- [ ] **Step 1: 增加跨盘路径回归断言**

```python
def test_safe_ref_path_rejects_cross_drive_without_raising():
    from server import safe_ref_path
    assert safe_ref_path(r"Z:\\foreign\\image.png") is None

def test_display_path_cross_drive_hides_drive_letter():
    result = display_path(r"Z:\\foreign\\image.png")
    assert not result.startswith("Z:")
    assert result.endswith("foreign/image.png")
```

- [ ] **Step 2: 验证测试先失败**

Run: `uv run pytest tests/test_server_helpers.py -q`

Expected: 跨盘 `safe_ref_path` 抛出 `ValueError`，路径展示泄漏盘符。

- [ ] **Step 3: 实现统一路径 helper**

```python
def relative_display_path(path: str, root: str | os.PathLike[str]) -> str:
    try:
        rel = os.path.relpath(path, root)
    except ValueError:
        _, tail = os.path.splitdrive(os.path.abspath(path))
        rel = os.path.join("..", "..", tail.lstrip("\\/"))
    return rel.replace("\\", "/")

def safe_ref_path(path: str) -> str | None:
    abs_path = os.path.abspath(path)
    ref_root = os.path.abspath(REF_DIR)
    try:
        return abs_path if os.path.commonpath([abs_path, ref_root]) == ref_root else None
    except ValueError:
        return None
```

`display_path()` 调用 `relative_display_path(path, WORK_ROOT)`。

- [ ] **Step 4: 验证路径测试通过**

Run: `uv run pytest tests/test_server_helpers.py -q`

Expected: 全部通过。

- [ ] **Step 5: 提交单项修复**

```powershell
git add server.py tests/test_server_helpers.py
git commit -m "fix: handle cross-drive paths safely"
```

### Task 2: 默认质量统一为 high

**Files:**
- Modify: `core/config.py`
- Modify: `server.py`
- Modify: `main.py`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/workflow.ts`
- Create: `frontend/src/workflow.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

- [ ] **Step 1: 安装前端测试运行器并写失败测试**

Run: `npm install --save-dev vitest`

Add script: `"test": "vitest run"`.

```ts
import { describe, expect, it } from "vitest";
import { workflowToCanvas } from "./workflow";

describe("workflow defaults", () => {
  it("uses high for a legacy prompt without quality", () => {
    const prompt = {
      id: "p1",
      type: "prompt" as const,
      position: { x: 0, y: 0 },
      data: { prompt: "x", size: "1024x1024", outputDir: "out", status: "idle" as const },
    };
    const result = workflowToCanvas([prompt as never], [], []);
    expect(result.nodes[0].type === "prompt" && result.nodes[0].data.quality).toBe("high");
  });
});
```

- [ ] **Step 2: 验证质量测试先失败**

Run: `npm test -- workflow.test.ts`

Expected: 收到 `undefined`，不是 `high`。

- [ ] **Step 3: 修改默认值**

```python
# core/config.py
DEFAULT_QUALITY = "high"
```

`server.generate` 和 `main.py gen --quality` 使用 `DEFAULT_QUALITY`；`App.tsx` 初始化值改为 `high`；`workflowToCanvas` 对缺失质量使用 `node.data.quality ?? "high"`。批量配置中显式写出的 `low` 不改动。

- [ ] **Step 4: 验证默认值测试和构建**

Run: `npm test -- workflow.test.ts`

Run: `npm run build`

Expected: 两条命令均退出 0。

- [ ] **Step 5: 提交默认值修改**

```powershell
git add core/config.py server.py main.py frontend/src/App.tsx frontend/src/workflow.ts frontend/src/workflow.test.ts frontend/package.json frontend/package-lock.json
git commit -m "fix: default image quality to high"
```

### Task 3: 修复自动整理

**Files:**
- Modify: `frontend/src/workflow.ts`
- Modify: `frontend/src/workflow.test.ts`
- Modify: `frontend/src/components/CanvasPage.tsx`

- [ ] **Step 1: 写自动整理失败场景**

测试必须覆盖：空画布保持原数组、多个提示词组不重叠、共享参考图位置确定、孤立节点单独成列、所有坐标为有限数值。

```ts
it("lays out shared references deterministically without overlaps", () => {
  const first = autoLayout(nodes, edges);
  const second = autoLayout(first, edges);
  expect(second.map((n) => n.position)).toEqual(first.map((n) => n.position));
  expect(new Set(first.map((n) => `${n.position.x}:${n.position.y}`)).size).toBe(first.length);
});
```

- [ ] **Step 2: 验证当前自动整理测试失败**

Run: `npm test -- workflow.test.ts`

Expected: 共享参考图或重复执行布局的断言失败。

- [ ] **Step 3: 使布局确定且不重复占位**

在 `autoLayout` 中按当前 y/x/id 稳定排序提示词；使用 `claimedNodeIds` 让共享参考图只在第一个提示词组占位；组高度最小为节点估算高度；所有最终坐标通过 `Number.isFinite` 校验，异常时保留原位置。

- [ ] **Step 4: 用双 requestAnimationFrame 触发 fitView**

```ts
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void rfInstanceRef.current?.fitView({ padding: 0.2, duration: 300 });
  });
});
```

删除固定 60ms 定时器，避免慢机器上读取旧坐标。

- [ ] **Step 5: 验证自动整理**

Run: `npm test -- workflow.test.ts`

Run: `npm run build`

Expected: 全部通过。

- [ ] **Step 6: 提交自动整理修复**

```powershell
git add frontend/src/workflow.ts frontend/src/workflow.test.ts frontend/src/components/CanvasPage.tsx
git commit -m "fix: make canvas auto layout deterministic"
```

### Task 4: 独立恢复快照

**Files:**
- Modify: `core/canvas.py`
- Modify: `server.py`
- Modify: `tests/test_core_canvas.py`
- Modify: `tests/test_server_canvas.py`
- Modify: `frontend/src/api.ts`
- Create: `frontend/src/useCanvasRecovery.ts`
- Modify: `frontend/src/components/CanvasPage.tsx`

- [ ] **Step 1: 写后端失败测试**

```python
def test_recovery_snapshot_never_overwrites_named_workflow(canvas_env):
    canvas.workflow_save("manual", [{"id": "manual"}], [])
    manual = Path(canvas.WORKFLOWS_DIR, "manual.json")
    before = manual.read_bytes()
    first = canvas.recovery_save([{"id": "a"}], [])
    second = canvas.recovery_save([{"id": "b"}], [])
    assert first["path"] != second["path"]
    assert manual.read_bytes() == before
```

另测轮转上限 20、latest 返回最新快照、损坏快照跳过。

- [ ] **Step 2: 验证恢复测试先失败**

Run: `uv run pytest tests/test_core_canvas.py tests/test_server_canvas.py -q`

Expected: `recovery_save` 尚不存在。

- [ ] **Step 3: 实现原子、唯一、轮转快照**

```python
RECOVERY_DIR = os.path.join(WORKFLOWS_DIR, ".recovery")
RECOVERY_LIMIT = 20

def recovery_save(nodes: list, edges: list) -> dict:
    os.makedirs(RECOVERY_DIR, exist_ok=True)
    name = f"recovery_{time.time_ns()}.json"
    path = os.path.join(RECOVERY_DIR, name)
    atomic_write_json(path, {"version": 1, "name": name[:-5], "nodes": nodes, "edges": edges})
    prune_recovery_snapshots(RECOVERY_LIMIT)
    return {"ok": True, "path": path, "name": name[:-5]}
```

增加 `POST /api/canvas/recovery/save` 和 `GET /api/canvas/recovery/latest`。恢复文件不进入 `workflow_list()`。

- [ ] **Step 4: 验证后端恢复测试通过**

Run: `uv run pytest tests/test_core_canvas.py tests/test_server_canvas.py -q`

Expected: 全部通过。

- [ ] **Step 5: 写前端恢复 hook**

`useCanvasRecovery` 在首次取得非空画布后启用；节点/边变化 1500ms 后保存新快照；挂载时读取 latest，只有用户确认才替换当前画布。清理 effect 时取消待执行定时器，不在空初始状态创建快照。

- [ ] **Step 6: 验证前端构建**

Run: `npm run build`

Expected: 退出 0。

- [ ] **Step 7: 提交恢复功能**

```powershell
git add core/canvas.py server.py tests/test_core_canvas.py tests/test_server_canvas.py frontend/src/api.ts frontend/src/useCanvasRecovery.ts frontend/src/components/CanvasPage.tsx
git commit -m "feat: add non-destructive canvas recovery snapshots"
```

### Task 5: 可测试的生成队列

**Files:**
- Create: `frontend/src/generationQueue.ts`
- Create: `frontend/src/generationQueue.test.ts`
- Modify: `frontend/src/components/CanvasPage.tsx`

- [ ] **Step 1: 写队列失败测试**

覆盖：重复 id 只执行一次、并发不超过 2、失败后释放锁、删除/取消后忽略完成回调、只重试失败任务。

```ts
it("deduplicates queued and running task ids", async () => {
  const calls: string[] = [];
  const queue = createGenerationQueue({ concurrency: 2, run: async (id) => calls.push(id) });
  expect(queue.enqueue("p1")).toBe(true);
  expect(queue.enqueue("p1")).toBe(false);
  await queue.onIdle();
  expect(calls).toEqual(["p1"]);
});
```

- [ ] **Step 2: 验证队列测试先失败**

Run: `npm test -- generationQueue.test.ts`

Expected: 模块不存在。

- [ ] **Step 3: 实现最小队列状态机**

模块暴露 `enqueue(id)`, `cancel(id)`, `retryFailed()`, `getSnapshot()`, `subscribe(listener)` 与 `onIdle()`；状态仅为 `queued/running/done/failed/cancelled`。并发 worker 在 `finally` 中释放 in-flight id。

- [ ] **Step 4: 验证队列测试通过**

Run: `npm test -- generationQueue.test.ts`

Expected: 全部通过。

- [ ] **Step 5: 将 CanvasPage 接入单一队列**

删除 `queuedRef`、`runningRef` 和 `runningAll` 的重复来源；节点 data.status 由队列订阅结果更新；节点删除调用 `cancel(id)`；批量运行只 enqueue，不自行创建 worker 数组。

- [ ] **Step 6: 运行第一阶段全量验证**

Run: `uv run pytest -q`

Run: `npm test`

Run: `npm run build`

Expected: 全部退出 0，无失败测试。

- [ ] **Step 7: 提交队列重构**

```powershell
git add frontend/src/generationQueue.ts frontend/src/generationQueue.test.ts frontend/src/components/CanvasPage.tsx
git commit -m "refactor: centralize canvas generation queue"
```

