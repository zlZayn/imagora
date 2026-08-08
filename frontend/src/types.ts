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
  hasApiKey: boolean;
  /** 窗口编号（多开页面时由后端分配或沿用已有编号） */
  windowId: number;
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

/** 生成接口响应 */
export interface GenerateResponse {
  results: ResultItem[];
  messages: string[];
  totalCost: number;
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
}

/** 画布图片注册表条目（/api/canvas/* 返回；registry entry + absPath 供生成引用） */
export interface CanvasImageEntry {
  id: string;
  relPath: string;
  absPath: string;
  name: string;
  size: number;
  ext: string;
  createdAt: string;
}

/** 画布图片节点数据（缩略图 + 引用计数 + 删除） */
export interface CanvasImageNodeData {
  registryId: string;
  name: string;
  url: string;
  size: number;
  ext: string;
  /** 被多少个提示词节点引用（由入边数推导） */
  refCount: number;
  /** 工作流加载时文件缺失（红框提示） */
  missing?: boolean;
  absPath: string;
  [key: string]: unknown;
}

/** 画布提示词节点数据（独立任务：idle/running/done/failed） */
export interface CanvasPromptNodeData {
  prompt: string;
  size: string;
  quality: string;
  outputDir: string;
  status: "idle" | "running" | "done" | "failed";
  /** 运行已等待秒数（running 时实时刷新） */
  elapsed?: number;
  /** 成功生成的张数（done 时显示） */
  resultCount?: number;
  /** 失败原因（failed 时显示） */
  message?: string;
  [key: string]: unknown;
}

/** 画布图片组节点数据（聚合多张图片后统一连到提示词节点管理） */
export interface CanvasGroupNodeData {
  name: string;
  /** 组内图片数（由入边图片数推导） */
  imageCount: number;
  /** 组内图片总大小（字节，由入边图片 size 合计） */
  totalSize: number;
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
}

/** 工作流文件（version 1，保存/加载的 JSON 结构） */
export interface WorkflowFile {
  version: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
