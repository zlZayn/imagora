/** 日志文本解析：把本机绝对路径段拆成可点击复制的词条（其余保持普通文本）。

 * 后端生成消息的保存路径统一为绝对路径（如 `E:\新下载\txt2img_1.png`），
 * 解析成正斜杠/反斜杠皆可的 Windows 路径段；错误消息里的路径（单引号包裹）同样命中。
 * 纯函数，供 LogLine 组件渲染分词条；一行可能含多个路径（各自成词条）。
 */

export interface LogSegment {
  text: string;
  /** 命中绝对路径时携带完整路径（含盘符与扩展名），无则 undefined */
  path?: string;
}

/** Windows 绝对路径：盘符 + 分隔符起，路径字符排除空白/括号/引号，以图片扩展名结尾 */
const ABS_PATH_RE = /[A-Za-z]:[\\/][^\s（）()"'`，。；]*?\.(?:png|jpe?g|webp|gif)(?=$|[\s（）()"'`，。；])/gi;

export function splitLogPath(text: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(ABS_PATH_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index) });
    segments.push({ text: match[0], path: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}