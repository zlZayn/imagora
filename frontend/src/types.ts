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
}

/** 单张生成结果 */
export interface ResultItem {
  status: "ok" | "error";
  message: string;
  url?: string;
}

/** 生成接口响应 */
export interface GenerateResponse {
  results: ResultItem[];
  messages: string[];
}

/** 生成请求参数 */
export interface GenerateParams {
  prompt: string;
  files: File[];
  size: string;
  quality: string;
  outputDir: string;
}
