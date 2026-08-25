import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 图片「单击 vs 双击」行为区分（Gallery 结果图 / HistoryGallery 生产历史共用）：
 * 单击：延时 250ms 在新窗口打开原图；250ms 内再来一击（双击的第二击）则取消本次打开。
 * 双击：取消未决的单击开原图，改为打开 ZoomModal 放大预览（与画布节点双击放大同一组件）。
 * 预防：双击连开两个新标签——第二击到达时先取消未决的单击延时。
 */

export interface ZoomTarget {
  url: string;
  name: string;
}

/** 单击/双击区分延时：双击的第二击到达前，单击的「开原图」保持未决可取消 */
export const CLICK_OPEN_DELAY_MS = 250;

export function useImageZoom() {
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  /** 单击延时开原图定时器；双击第二击到达时取消（避免双击连开两个新标签） */
  const pendingOpenRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pendingOpenRef.current) window.clearTimeout(pendingOpenRef.current);
    },
    [],
  );

  /** 单击：延时开原图；延时内再来一击说明是双击，取消本次打开（交给 handleDoubleClick） */
  const handleClick = useCallback((event: { preventDefault(): void }, item: ZoomTarget) => {
    event.preventDefault();
    if (pendingOpenRef.current) {
      window.clearTimeout(pendingOpenRef.current);
      pendingOpenRef.current = null;
      return;
    }
    pendingOpenRef.current = window.setTimeout(() => {
      pendingOpenRef.current = null;
      window.open(item.url, "_blank", "noopener");
    }, CLICK_OPEN_DELAY_MS);
  }, []);

  /** 双击：取消未决的单击开原图，改为放大预览 */
  const handleDoubleClick = useCallback((item: ZoomTarget) => {
    if (pendingOpenRef.current) {
      window.clearTimeout(pendingOpenRef.current);
      pendingOpenRef.current = null;
    }
    setZoom(item);
  }, []);

  const closeZoom = useCallback(() => setZoom(null), []);

  return { zoom, handleClick, handleDoubleClick, closeZoom };
}