import { describe, expect, it } from "vitest";

import { splitLogPath } from "./logPath";

/** 回归测试：日志文本中的本机绝对路径必须拆成可点击复制的词条段 */
/** noUncheckedIndexedAccess 守卫：越界即失败，不把断言弱化为可选链 */
function indexed<T>(items: ArrayLike<T>, at: number): T {
  const item = items[at];
  if (item === undefined) throw new Error(`indexed: 长度 ${items.length} 越界下标 ${at}`);
  return item;
}

describe("splitLogPath 路径词条解析", () => {
  it("保存消息：相对/绝对反斜杠路径拆成词条，其余文本保留", () => {
    const segs = splitLogPath("已保存 · E:\\新下载\\txt2img_20260825_113443_001.png（1024x1024）");
    expect(segs).toEqual([
      { text: "已保存 · " },
      { path: "E:\\新下载\\txt2img_20260825_113443_001.png", text: "E:\\新下载\\txt2img_20260825_113443_001.png" },
      { text: "（1024x1024）" },
    ]);
  });

  it("错误消息：单引号包裹的正斜杠路径也命中", () => {
    const segs = splitLogPath("生成失败：PermissionError: 'C:/Users/x/out/a.png'");
    expect(segs.some((s) => s.path === "C:/Users/x/out/a.png")).toBe(true);
  });

  it("无路径的纯文本：单段原样返回", () => {
    expect(splitLogPath("生成已取消")).toEqual([{ text: "生成已取消" }]);
  });

  it("一行多个路径：各自成词条", () => {
    const segs = splitLogPath("参考 1.png 与 2.jpg");
    // 相对路径（无盘符）不命中——只有带盘符的才是词条
    expect(segs).toEqual([{ text: "参考 1.png 与 2.jpg" }]);
    const multi = splitLogPath("A:\\a\\1.png 和 B:/b/2.webp");
    expect(multi.filter((s) => s.path)).toHaveLength(2);
  });

  it("扩展名大小写不敏感", () => {
    expect(splitLogPath("已保存: E:\\x\\IMG.PNG").some((s) => s.path === "E:\\x\\IMG.PNG")).toBe(true);
  });

  it("路径后紧跟中文标点/全角括号：路径不含标点", () => {
    const segs = splitLogPath("已保存 · C:\\out\\x.png（尺寸）");
    expect(indexed(segs, 1).path).toBe("C:\\out\\x.png");
  });
});