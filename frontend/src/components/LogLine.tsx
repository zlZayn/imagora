import { splitLogPath } from "../logPath";
import CopyChip from "./CopyChip";

/**
 * 单条日志行：文本里的本机绝对路径拆成可点击复制的词条（CopyChip），
 * 其余保持普通文本；行动画沿用 log-line（与旧实现一致）。
 */
export default function LogLine({ text }: { text: string }) {
  const segments = splitLogPath(text);
  return (
    <div className="log-line">
      {segments.map((seg, i) =>
        seg.path ? <CopyChip key={i} path={seg.path} /> : <span key={i}>{seg.text}</span>,
      )}
    </div>
  );
}