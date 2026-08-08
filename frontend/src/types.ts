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
