import { isImageFile } from "./workflow";

/* ---------------- 画布拖拽（文件 / 工具栏按钮）共用模型与纯函数 ----------------
 * 意图解析、文件识别、落点示意文案全部收敛于此，组件只做事件接线；
 * 拖拽四事件与落点换算在 useCanvasDrop.ts（需要访问 React Flow 实例与画布 DOM）。
 * 所有函数不依赖 React / DOM 状态，可独立单测（见 canvasDrop.test.ts）。 */

/** 工具栏按钮拖出的 dataTransfer 自定义类型（值 = prompt | group，落画布时据此新建对应节点） */
export const CANVAS_DRAG_MIME = "application/x-imagora-canvas";

/** 落画布拖拽意图：images = 文件拖入；prompt/group = 工具栏按钮拖出 */
export type CanvasDropIntent = "images" | "prompt" | "group";

/** 工具栏拖出按钮的落点示意文案（文件拖入的文案按数量动态生成，见 dropChipLabel） */
export const TOOLBAR_DROP_LABELS: Record<"prompt" | "group", string> = {
  prompt: "松开新建提示词卡片",
  group: "松开新建图片组",
};

/** 拖拽数据的最小结构面：判定只读 types/getData（文件拖入与工具栏拖出共用） */
type DragDataLike = { types: readonly string[]; getData: (type: string) => string };
/** 文件拖入的最小结构面：dragover 从 items 计数量、drop 从 files 取文件
 *  （jsdom 的 DataTransfer 实现不完整，测试桩按此面构造即可，无需断言成全量类型） */
type FileDragDataLike = { items: ArrayLike<{ kind: string }>; files: ArrayLike<File> };

/** 拖拽是否携带文件（窗口级拦截与意图判定共用；文本拖拽/内部拖拽不拦截） */
export function dragCarriesFiles(event: { dataTransfer: DragDataLike | null }): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** 当前拖拽的落画布意图：文件拖入 = images；工具栏拖出 = prompt/group；其他（文本拖拽等）= null 放行。
 *  fallback 传入 dragstart 已登记的意图，兜底真实浏览器 dragover 阶段 getData 偶发为空的兼容问题。 */
export function resolveDropIntent(
  event: { dataTransfer: DragDataLike | null },
  fallback: CanvasDropIntent | null,
): CanvasDropIntent | null {
  if (dragCarriesFiles(event)) return "images";
  const kind = event.dataTransfer?.getData(CANVAS_DRAG_MIME);
  if (kind === "prompt" || kind === "group") return kind;
  return fallback;
}

/** dragover 阶段 dataTransfer.files 为空（浏览器延迟到 drop 才填充），
 *  文件数量只能从 dataTransfer.items（kind === "file"）统计；drop 时才用完整 File 列表过滤图片。 */
export function countDraggedFiles(dataTransfer: FileDragDataLike | null): number {
  return dataTransfer
    ? Array.from(dataTransfer.items).filter((item) => item.kind === "file").length
    : 0;
}

/** drop 时从 dataTransfer.files 提取图片（与上传/导入/新建共用同一 isImageFile 判定，保证各入口一致） */
export function extractImageFiles(dataTransfer: FileDragDataLike | null): File[] {
  return Array.from(dataTransfer?.files ?? []).filter(isImageFile);
}

/** 落点示意文案：文件拖入显示拖入数量（0 张 = 未检测到图片），工具栏拖出显示新建类型 */
export function dropChipLabel(intent: CanvasDropIntent, draggedFileCount: number): string {
  if (intent === "images") {
    return draggedFileCount >= 1 ? `松开添加 ${draggedFileCount} 张图片` : "未检测到图片";
  }
  return TOOLBAR_DROP_LABELS[intent];
}

/** 工具栏拖出时画布外的示意文案（松手 = 取消，拖回画布恢复新建文案） */
export const TOOLBAR_DROP_LABEL_CANCEL = "松开取消";

/** 屏幕坐标是否落在矩形内（工具栏拖出判定落点：画布容器内 = 新建，画布外松手 = 取消） */
export function isInsideRect(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
