/** 字节数格式化为可读文本（B / KB / MB），画廊与上传区共用 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 提取错误可读消息：Error 对象取 message，其余转字符串，截断防长 */
export function errMessage(err: unknown, limit = 120): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > limit ? `${msg.slice(0, limit)}…` : msg;
}

