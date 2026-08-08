import type { AppConfig, GenerateParams, GenerateResponse, RefItem } from "./types";

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

/** 文生图 / 图生图（refPaths 优先复用已上传参考图，files 为未上传兜底） */
export async function generateImage(params: GenerateParams): Promise<GenerateResponse> {
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
  return requestJson<GenerateResponse>("/api/generate", { method: "POST", body: formData });
}
