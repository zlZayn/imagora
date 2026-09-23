/** 尺寸选项（后端 /api/config 下发） */
export interface SizeOption {
  value: string;
  label: string;
  cost: number;
}

/** 应用初始化配置 */
export interface AppConfig {
  sizes: SizeOption[];
  qualities: string[];
  defaultOutputDir: string;
  /** 窗口编号（多开页面时由后端分配或沿用已有编号） */
  windowId: number;
  /** 当前中转站 base URL（config.json profile 解析，前端展示用） */
  baseUrl?: string;
  /** 当前 profile 的默认模型（标题栏徽章展示，确认切换生效） */
  defaultModel?: string;
  /** 当前生效的配置 profile 名（config.json 多 profile，.env ACTIVE_PROFILE 可覆盖） */
  activeProfile?: string;
}

/** 已落盘服务端的参考图（/api/upload-ref 返回；未上传成功的本地兜底 synced=false） */
export interface RefItem {
  /** 服务端文件名（唯一标识） */
  id: string;
  /** 服务端绝对路径（继承 / 生成时引用） */
  path: string;
  /** 可直接渲染的 URL */
  url: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
  /** 后缀（不含点，如 jpg/png） */
  ext: string;
  mime: string;
  /** 本地 File 兜底（上传失败时保留，生成走 multipart images） */
  file?: File;
  /** 是否已成功落盘服务端 */
  synced: boolean;
}

/** 单张生成结果 */
export interface ResultItem {
  status: "ok" | "error";
  message: string;
  url?: string;
  size?: string;
  cost?: number;
  /** 文件字节数（后端 os.path.getsize） */
  fileSize?: number;
  /** 文件后缀（如 png） */
  ext?: string;
}

/** 生成任务状态（后端任务管线；经典表单与画布共用，见 core/tasks.py） */
export type GenerationTaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** 生成任务快照（GET /api/tasks/{taskId} 轮询返回） */
export interface GenerationTaskSnapshot {
  taskId: string;
  status: GenerationTaskStatus;
  /** 开始执行时间（epoch ms），未开始为 null */
  startedAt?: number | null;
  results?: ResultItem[];
  messages?: string[];
  totalCost?: number;
  error?: string | null;
  cancelRequested?: boolean;
  /** 稳定提交 id（落盘提交图快照，经典结果可整图导入画布） */
  submissionId?: string;
}

/** 生成请求参数 */
export interface GenerateParams {
  prompt: string;
  /** 已上传参考图的 path 列表（与 files 二选一，后端优先取它） */
  refPaths: string[];
  /** 未上传成功的本地兜底文件 */
  files: File[];
  size: string;
  quality: string;
  outputDir: string;
  /** 窗口编号（多开页面溯源到日志），无窗口传 0 */
  win: number;
  /** 超预算已确认（预算闸门：服务端超限未确认时 409，前端确认后带此标记重提） */
  allowOverBudget?: boolean;
}

/** 画布图片注册表条目（/api/canvas/* 返回；registry entry + absPath/url 供生成引用与显示） */
export interface AssetEntry {
  id: string;
  relPath: string;
  absPath: string;
  url: string;
  name: string;
  size: number;
  ext: string;
  createdAt: string;
}

/** 画布图片节点数据（缩略图 + 引用计数 + 删除）
 *  url/absPath 为派生字段：正常节点由后端加载时实时解析，缺失（missing）节点没有 */
export interface CanvasImageNodeData {
  registryId: string;
  name: string;
  url?: string;
  size: number;
  ext: string;
  /** 被多少个提示词节点引用（引用溯源：图片数据沿组链最终到达的提示词数，非直接边数） */
  refCount: number;
  /** 工作流加载时文件缺失（红框提示） */
  missing?: boolean;
  absPath?: string;
  [key: string]: unknown;
}

/** 画布提示词节点数据（独立任务：idle/running/done/failed） */
export interface CanvasPromptNodeData {
  prompt: string;
  size: string;
  quality: string;
  outputDir: string;
  status: "idle" | "queued" | "running" | "done" | "failed";
  /** 粘贴导入生成的提示词卡片标题（手动建卡时缺省） */
  title?: string;
  /** 生成开始锚点（epoch 毫秒）：running 转换时写入一次；秒数文字由组件自计时刷新，不逐秒写节点 */
  startedAtMs?: number;
  /** 成功生成的张数（done 时显示） */
  resultCount?: number;
  /** 失败原因（failed 时显示） */
  message?: string;
  [key: string]: unknown;
}

/** 画布图片组节点数据（聚合多张图片后统一连到提示词节点管理） */
export interface CanvasGroupNodeData {
  name: string;
  /** 组内实际图片张数（去重后唯一口径：同一张图经组链多路径只算一次，与生成实际一致） */
  imageCount: number;
  /** 组内图片总大小（字节，与 imageCount 同去重口径） */
  totalSize: number;
  /** 重复条目数（>0 时组卡显示「去重」标签；运行时派生，不持久化） */
  duplicateCount?: number;
  [key: string]: unknown;
}

/** React Flow 节点公共字段（画布高亮/选中/拖拽由画布层维护） */
interface WorkflowNodeBase {
  id: string;
  position: { x: number; y: number };
  className?: string;
  selected?: boolean;
}

/** 画布节点联合类型：图片节点 / 提示词节点 / 图片组节点 */
export type WorkflowNode =
  | (WorkflowNodeBase & { type: "image"; data: CanvasImageNodeData })
  | (WorkflowNodeBase & { type: "prompt"; data: CanvasPromptNodeData })
  | (WorkflowNodeBase & { type: "group"; data: CanvasGroupNodeData });

/** 画布边：source 图片节点 -> target 提示词节点（类型硬约束，仅此方向合法） */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** 是否流动动画（渲染层由 defaultEdgeOptions 统一开启，数据层可选） */
  animated?: boolean;
}

/** 工作流文件（version 1，保存/加载的 JSON 结构） */
export interface WorkflowFile {
  version: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
