/**
 * 窗口状态继承：仅「＋ 新窗口」按钮触发。
 * 通过 sessionStorage 传递（window.open 的新标签页会拷贝一份），
 * 新窗口挂载时读取并清除；命令行 / 直接输 URL 打开无该键，保持全新。
 */

const INHERIT_KEY = "aig-window-inherit";

export interface InheritedFileData {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface InheritedState {
  files: InheritedFileData[];
  size: string;
  quality: string;
  outputDir: string;
}

export interface SaveResult {
  /** 状态已保存（至少参数成功） */
  ok: boolean;
  /** 图片是否一并保存（图片过大时可能被丢弃） */
  filesIncluded: boolean;
}

/** File → dataURL，跨窗口传递 */
function fileToDataUrl(file: File): Promise<InheritedFileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** dataURL → File，还原参考图 */
export function dataUrlToFile(data: InheritedFileData): File {
  const [meta, b64] = data.dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] ?? data.type;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], data.name, { type: mime });
}

/** 保存当前窗口状态到 sessionStorage，供新窗口继承（不含提示词） */
export async function saveInheritedState(
  files: File[],
  size: string,
  quality: string,
  outputDir: string,
): Promise<SaveResult> {
  const base = { files: [], size, quality, outputDir };
  try {
    const full: InheritedState = { ...base, files: await Promise.all(files.map(fileToDataUrl)) };
    sessionStorage.setItem(INHERIT_KEY, JSON.stringify(full));
    return { ok: true, filesIncluded: true };
  } catch {
    // 图片超 sessionStorage 配额：回退为仅继承参数
    try {
      sessionStorage.setItem(INHERIT_KEY, JSON.stringify(base));
      return { ok: true, filesIncluded: false };
    } catch {
      return { ok: false, filesIncluded: false };
    }
  }
}

/** 读取继承状态（不删除，由调用方决定时机清除） */
export function readInheritedState(): InheritedState | null {
  const raw = sessionStorage.getItem(INHERIT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InheritedState;
  } catch {
    return null;
  }
}

/** 清除继承状态 */
export function clearInheritedState() {
  sessionStorage.removeItem(INHERIT_KEY);
}
