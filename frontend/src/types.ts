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

/** 单张生成结果 */
export interface ResultItem {
  status: "ok" | "error";
  message: string;
  url?: string;
  size?: string;
  cost?: number;
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
  files: File[];
  size: string;
  quality: string;
  outputDir: string;
  /** 窗口编号（多开页面溯源到日志），无窗口传 0 */
  win: number;
}
