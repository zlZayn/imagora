import type {
  AppConfig,
  AssetEntry,
  GenerateParams,
  GenerationTaskStatus,
  GenerationTaskSnapshot,
  RefItem,
  WorkflowEdge,
  WorkflowNode,
} from "./types";
/** 通用 JSON 请求，非 2xx 抛错 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** 获取应用初始化配置（尺寸/质量/默认输出路径/窗口编号）
 *  传 win 表示沿用已有窗口编号（URL ?win= 或 window.name 记忆），否则由服务端分配 */
export function getConfig(win?: number): Promise<AppConfig> {
  const query = win ? `?win=${win}` : "";
  return requestJson<AppConfig>(`/api/config${query}`);
}

export function getHealthDetails(): Promise<{
  ok: boolean;
  checks: { apiKey: boolean; frontendBuilt: boolean; outputWritable: boolean };
  issues: string[];
}> {
  return requestJson("/api/health/details");
}

/** 弹出系统文件夹选择器，返回选中的路径（取消则返回原路径） */
export async function selectFolder(current: string): Promise<{ path: string }> {
  return requestJson<{ path: string }>("/api/select-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current }),
  });
}

/** 在系统资源管理器中打开指定文件夹 */
export async function openFolder(path: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/** 参考图落盘服务端（添加进上传区时即调），返回带 path/url/size/ext 的元信息 */
export async function uploadRefs(files: File[]): Promise<RefItem[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }
  const res = await requestJson<{ refs: RefItem[] }>("/api/upload-ref", { method: "POST", body: formData });
  return res.refs;
}

/** 删除已落盘参考图（尽力而为，失败不阻断界面） */
export async function deleteRef(path: string): Promise<void> {
  await requestJson("/api/delete-ref", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/** 记住输出路径：用户一改路径即上报，服务重启后默认沿用（失败不影响界面） */
export async function rememberOutputDir(path: string): Promise<void> {
  await requestJson("/api/output-dir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/** 文生图 / 图生图（refPaths 优先复用已上传参考图，files 为未上传兜底）
 *  提交后立即返回 {taskId, status}，后续用 fetchTask 轮询快照 */
export async function submitGenerate(
  params: GenerateParams,
): Promise<{ taskId: string; status: GenerationTaskStatus }> {
  const formData = new FormData();
  formData.append("prompt", params.prompt);
  if (params.refPaths.length) {
    // 字段名与后端参数名一致（ref_paths: str = Form），后端按 REF_DIR 校验
    formData.append("ref_paths", JSON.stringify(params.refPaths));
  }
  for (const file of params.files) {
    // 字段名必须与后端参数名一致（images: list[UploadFile]），否则后端收不到图片
    formData.append("images", file);
  }
  formData.append("size", params.size);
  formData.append("quality", params.quality);
  formData.append("output_dir", params.outputDir);
  formData.append("win", String(params.win)); // 与后端 Form 参数名一致，日志按窗口溯源
  return requestJson("/api/generate", { method: "POST", body: formData });
}

/* ---------------- 生成任务（异步任务管线：提交 / 轮询 / 取消） ---------------- */

/** 轮询任务快照（排队 / 执行 / 完成 / 失败 / 取消） */
export function fetchTask(taskId: string): Promise<GenerationTaskSnapshot> {
  return requestJson<GenerationTaskSnapshot>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

/** 请求取消任务（排队中立即取消；运行中等待当前张完成后丢弃结果） */
export async function cancelTask(taskId: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
}

/* ---------------- 画布工作流（无限画布：图片节点 + 提示词节点） ---------------- */

/** 画布：上传本地图片（multipart），服务端复制进 output/.canvas/ 并登记 registry */
export async function canvasUpload(files: File[]): Promise<{ images: AssetEntry[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }
  return requestJson<{ images: AssetEntry[] }>("/api/canvas/upload", {
    method: "POST",
    body: formData,
  });
}

/** 画布：从输出目录导入图片（目录递归 / 单文件），复制进 .canvas 并登记 */
export async function canvasImport(
  paths: string[],
): Promise<{ imported: AssetEntry[]; skipped: { path: string; reason: string }[] }> {
  return requestJson("/api/canvas/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}

/** 画布：删除图片（注册表移除 + 尽力删文件） */
export async function canvasDeleteImage(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/canvas/image/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

/** 工作流：保存为 JSON 文件（固定目录 output/workflows/<name>.json，仅需名字） */
export async function workflowSave(params: {
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Promise<{ ok: boolean; path: string }> {
  return requestJson("/api/canvas/workflow/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

/** 工作流：列出 output/workflows/ 下所有工作流（按修改时间倒序） */
export async function workflowList(): Promise<{ workflows: { name: string; modified: string }[] }> {
  return requestJson("/api/canvas/workflow/list");
}

/** 工作流：按名加载（固定目录解析 + 文件存在性校验，缺失进 missing） */
export async function workflowLoad(
  name: string,
): Promise<{ name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; missing: string[] }> {
  return requestJson("/api/canvas/workflow/load?name=" + encodeURIComponent(name));
}

export interface RecoverySnapshotResponse {
  ok: boolean;
  empty?: boolean;
  name?: string;
  savedAt?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  missing?: string[];
}

/** 创建新的系统恢复快照；服务端保证不会覆盖手动命名工作流。 */
export async function recoverySave(params: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Promise<{ ok: true; path: string; name: string; savedAt: string }> {
  return requestJson("/api/canvas/recovery/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

/** 读取最近一份可用系统恢复快照。 */
export async function recoveryLatest(): Promise<RecoverySnapshotResponse> {
  return requestJson("/api/canvas/recovery/latest");
}

/** 经典提交整图导入画布：按 submissionId 取提交图快照（图片路径已实时解析，缺失进 missing） */
export async function importSubmission(
  submissionId: string,
): Promise<{ name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; missing: string[] }> {
  return requestJson("/api/canvas/import-submission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}

/** 历史记录参考图条目（后端按注册表解析 /api/history inputAssetIds） */
export interface HistoryInputRef {
  id: string;
  path: string;
  url: string;
}

export interface GenerationHistoryItem {
  time?: string;
  mode?: string;
  refs?: number;
  prompt?: string;
  size?: string;
  quality?: string;
  status?: string;
  cost?: number;
  seconds?: number;
  output?: string;
  exists: boolean;
  path: string;
  url: string;
  /** 参考图（按注册表解析；旧记录 / 纯文生图为空数组） */
  inputRefs?: HistoryInputRef[];
  /** 图生图记录但参考图找不回（有 refs 计数、inputAssetIds 缺失或解析失败） */
  inputRefMissing?: boolean;
}

export async function generationHistory(params: {
  limit?: number;
  query?: string;
  status?: string;
} = {}): Promise<{ items: GenerationHistoryItem[] }> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 200));
  if (params.query) query.set("query", params.query);
  if (params.status) query.set("status", params.status);
  return requestJson(`/api/history?${query.toString()}`);
}

export async function importHistoryAsset(path: string): Promise<{
  imported: AssetEntry[];
  skipped: { path: string; reason: string }[];
}> {
  return requestJson("/api/history/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
