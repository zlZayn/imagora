/**
 * 我的壁纸 —— 存储层。
 *
 * 只做一件事：把用户选的那张图存进 IndexedDB（Blob 直存），以及读回、删除。
 *
 * - 不走 localStorage：base64 会膨胀约 1/3 且很快撞配额，一张 4K 图就足以让整站 localStorage 写失败。
 * - 不做任何图像处理：按原图铺满就是需求本身。
 *   （曾有过「模糊 / 压暗 / 缩放」三个参数、按图亮度算压暗初值、以及缩图档位与 canvas 取样，
 *   维护者要求「就正常的原图就行了」，这些连同 wallpaper.ts 纯函数模块已一并删除。）
 *
 * 降级原则：存储不可用（无 IndexedDB / 隐私模式 / 老浏览器）＝「没有壁纸」，
 * 读取一律返回 null、写入返回 false，不抛错、不影响生图主流程。
 *
 * 另有一个与壁纸无关的小职责：`purgeLegacyWallpaperSettings` 清掉旧版壁纸参数键
 * （那段代码可整体删除，说明见函数上方）。
 */

const DB_NAME = "imagora-wallpaper";
const DB_VERSION = 1;
const STORE_NAME = "wallpaper";
/** 该库只存「当前这张壁纸」一张图，固定主键 */
const IMAGE_KEY = "current";

/** 打开壁纸库；不可用（无 IndexedDB / 打不开 / 被阻断）一律返回 null，由调用方安静降级 */
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || indexedDB === null) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** 读当前壁纸图；没有图 / 存储不可用一律返回 null（= 没有壁纸，不报错） */
export async function readWallpaperImage(): Promise<Blob | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(IMAGE_KEY);
        request.onsuccess = () => {
          const value: unknown = request.result;
          resolve(value instanceof Blob ? value : null);
        };
        request.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } finally {
    db.close();
  }
}

/** 存当前壁纸图；成功 true，IndexedDB 不可用 / 写失败 false（调用方据此安静降级为「没有壁纸」） */
export async function saveWallpaperImage(blob: Blob): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(blob, IMAGE_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } finally {
    db.close();
  }
}

/** 删当前壁纸图；存储不可用时静默返回（删不掉也不影响「本次会话没有壁纸」） */
export async function clearWallpaperImage(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(IMAGE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}

/**
 * 旧版壁纸参数的 localStorage 键（模糊 / 压暗 / 缩放三个滑杆那版）。
 * 那套参数与设置面板早已删除，源码里再无任何地方读它——**是纯遗留垃圾**，
 * 留着只会让下一个人以为「壁纸还有参数可调」而去翻代码。这里主动清掉。
 */
const LEGACY_WALLPAPER_SETTINGS_KEY = "imagora.wallpaper-settings.v1";

/**
 * 一次性清理旧版壁纸参数键。**已过时，可整段删除**——
 * 想删的时候连 `LEGACY_WALLPAPER_SETTINGS_KEY` 与本函数一起删，
 * 再删掉 App 启动处的那次调用即可，没有别处引用。
 *
 * 为什么现在留着：旧键已经躺在老用户浏览器里了（存着一坨 JSON），
 * 而这段代码一旦删掉，就再没有任何机会把它收走——不删反而越留越久。
 * **幂等、随时可重复调用**（`removeItem` 对不存在的键是空操作），
 * 「只清一次」由调用方决定（App 在挂载 effect 里调，天然一次）。
 *
 * 只删这一个键，**绝不 `.clear()`**：现存设置（主体色 / 背景预设 / 通透度 / 画布边界）
 * 都还要用，清库等于把用户调好的外观一起抹掉。
 */
export function purgeLegacyWallpaperSettings(): void {
  try {
    localStorage.removeItem(LEGACY_WALLPAPER_SETTINGS_KEY);
  } catch {
    /* 隐私模式 / 存储被禁用：没有键可删，静默即可 */
  }
}
