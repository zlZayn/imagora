/**
 * 窗口状态继承：仅「＋ 新窗口」按钮触发。
 * 参考图本体已在上传区落盘服务端（output/.refs/），此处只把元信息
 * （path/name/size/ext）写入 sessionStorage——几百字节，永不会触发 5MB 配额，
 * 新窗口挂载时读取并清除；命令行 / 直接输 URL 打开无该键，保持全新。
 */

const INHERIT_KEY = "aig-window-inherit";

/** 跨窗口传递的参考图元信息（不含图片数据） */
export interface InheritedRef {
  path: string;
  name: string;
  size: number;
  ext: string;
}

export interface InheritedState {
  refs: InheritedRef[];
  size: string;
  quality: string;
  outputDir: string;
  /** 需要在新窗口展示的提示（如部分参考图未上传成功） */
  notice?: string;
}

export interface SaveResult {
  /** 状态已保存（至少参数成功） */
  ok: boolean;
  /** 参考图是否一并保存（未上传成功的图会被剔除） */
  filesIncluded: boolean;
}

/** 保存当前窗口状态到 sessionStorage，供新窗口继承（不含提示词、不含图片数据） */
export function saveInheritedState(
  refs: { path: string; name: string; size: number; ext: string }[],
  size: string,
  quality: string,
  outputDir: string,
  notice?: string,
): SaveResult {
  const state: InheritedState = {
    refs,
    size,
    quality,
    outputDir,
    ...(notice ? { notice } : {}),
  };
  try {
    sessionStorage.setItem(INHERIT_KEY, JSON.stringify(state));
    return { ok: true, filesIncluded: refs.length > 0 };
  } catch {
    // sessionStorage 整体不可用（极少见）：放弃继承
    return { ok: false, filesIncluded: false };
  }
}

/** sessionStorage 属外部输入（旧版本残留 / 手工改写 / 同源他应用），按形状校验后才信任 */
function isInheritedRef(value: unknown): value is InheritedRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.path === "string" &&
    typeof ref.name === "string" &&
    typeof ref.size === "number" &&
    typeof ref.ext === "string"
  );
}

function isInheritedState(value: unknown): value is InheritedState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.size === "string" &&
    typeof state.quality === "string" &&
    typeof state.outputDir === "string" &&
    (state.notice === undefined || typeof state.notice === "string") &&
    Array.isArray(state.refs) &&
    state.refs.every(isInheritedRef)
  );
}

/** 读取继承状态（不删除，由调用方决定时机清除）；形状不符视为无继承 */
export function readInheritedState(): InheritedState | null {
  const raw = sessionStorage.getItem(INHERIT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isInheritedState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 清除继承状态 */
export function clearInheritedState() {
  sessionStorage.removeItem(INHERIT_KEY);
}
