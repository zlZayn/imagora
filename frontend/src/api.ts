import type { AppConfig, GenerateParams, GenerateResponse } from "./types";

/** 通用 JSON 请求，非 2xx 抛错 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** 获取应用初始化配置（尺寸/质量/默认输出路径） */
export function getConfig(): Promise<AppConfig> {
  return requestJson<AppConfig>("/api/config");
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

/** 文生图 / 图生图（有 files 即图生图（多张参考图，用途由提示词决定）） */
export async function generateImage(params: GenerateParams): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append("prompt", params.prompt);
  for (const file of params.files) {
    formData.append("image", file);
  }
  formData.append("size", params.size);
  formData.append("quality", params.quality);
  formData.append("output_dir", params.outputDir);
  return requestJson<GenerateResponse>("/api/generate", { method: "POST", body: formData });
}
