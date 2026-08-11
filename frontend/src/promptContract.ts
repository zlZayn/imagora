/** 提示词契约解析 —— 纯函数、零依赖
 *
 * 契约格式（块式）：
 *   === 标题 ===
 *   ```text
 *   ratio: N:M
 *
 *   <提示词正文，可多行>
 *   ```
 *
 * 解析策略：按标题锚点切分行段；段内取第一个围栏为开、最后一个围栏为闭；
 * 块内首非空行为 ratio 元数据行。缺任何必需元素 → 进 issues，绝不静默猜测。
 */

/** 模板预期的卡片数（与 docs/prompt-contract.md「恰好 10 块」对应） */
export const EXPECTED_CARDS = 10;

/** 契约中间结构：解析器 / 尺寸映射器 / 建卡构造器共用的唯一类型 */
export interface PromptCardSpec {
  /** 标题行内容，如「轮播图1」 */
  title: string;
  /** 元数据行解析出的比例，如 "1:1" */
  ratio: string;
  /** 提示词正文（trim 后） */
  prompt: string;
}

export type PromptIssueCode =
  | "missing-header" // 有围栏无标题行
  | "missing-fence" // 有标题行无围栏
  | "missing-ratio" // 块内无 ratio 行
  | "bad-ratio" // ratio 行格式非法（非 数字:数字）
  | "empty-prompt" // 提示词正文为空
  | "duplicate-title"; // 标题重复

export interface PromptParseIssue {
  code: PromptIssueCode;
  /** 关联块的标题（可缺，如 missing-header 无标题） */
  title?: string;
  message: string;
}

export interface PromptParseResult {
  /** 完全合法、可直接建卡的条目 */
  cards: PromptCardSpec[];
  /** 有问题的条目（不进 cards，逐条标红） */
  issues: PromptParseIssue[];
  /** 解析过程中被忽略的散落文字片段（供日志提示） */
  skippedText: string[];
}

const HEADER_RE = /^=== (.+) ===\s*$/;
const FENCE_RE = /^```(?:text)?\s*$/;
const RATIO_RE = /^ratio:\s*(\d+):(\d+)\s*$/;
const RATIO_PREFIX_RE = /^ratio\b/i;

/** 文本中是否包含围栏行（按行扫描，不整串匹配） */
function containsFence(text: string): boolean {
  return text.split("\n").some((line) => FENCE_RE.test(line));
}

/** 契约文本 → 解析结果（标题锚点切分 + 段内首尾围栏配对） */
export function parsePromptContract(text: string): PromptParseResult {
  // 预处理：去 BOM、统一换行
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");

  const cards: PromptCardSpec[] = [];
  const issues: PromptParseIssue[] = [];
  const skipped: string[] = [];

  // 收集标题锚点（行号 + 标题）
  const headers: { title: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = line.match(HEADER_RE);
    if (m) headers.push({ title: m[1].trim(), line: i });
  });

  // 全文无标题
  if (headers.length === 0) {
    const trimmed = src.trim();
    if (trimmed) skipped.push(trimmed);
    if (containsFence(src)) {
      issues.push({ code: "missing-header", message: "全文未找到 === 标题 === 行，但存在代码块围栏" });
    }
    return { cards, issues, skippedText: skipped };
  }

  // 序言段：首个标题之前
  const prelude = lines.slice(0, headers[0].line).join("\n").trim();
  if (prelude) {
    skipped.push(prelude);
    if (containsFence(prelude)) {
      issues.push({ code: "missing-header", message: "标题之前存在代码块围栏（疑似缺标题的块）" });
    }
  }

  const seenTitles = new Set<string>();
  for (let h = 0; h < headers.length; h++) {
    const { title } = headers[h];
    const segStart = headers[h].line + 1;
    const segEnd = h + 1 < headers.length ? headers[h + 1].line : lines.length;
    const segLines = lines.slice(segStart, segEnd);

    // 标题去重（保留首个）
    if (seenTitles.has(title)) {
      issues.push({ code: "duplicate-title", title, message: `标题重复：「${title}」` });
      continue;
    }
    seenTitles.add(title);

    // 围栏配对：第一个为开、最后一个为闭
    const fences: number[] = [];
    segLines.forEach((line, i) => {
      if (FENCE_RE.test(line)) fences.push(i);
    });
    if (fences.length === 0) {
      issues.push({ code: "missing-fence", title, message: `「${title}」缺少代码块围栏（需要 \`\`\`text）` });
      continue;
    }
    const open = fences[0];
    const close = fences[fences.length - 1];

    // 开围栏之前的散落文字
    const before = segLines.slice(0, open).join("\n").trim();
    if (before) skipped.push(before);

    // 块体 = 开围栏行之后 到 闭围栏行之前
    const bodyLines = segLines.slice(open + 1, close);
    const firstNonBlank = bodyLines.findIndex((l) => l.trim() !== "");
    if (firstNonBlank === -1) {
      issues.push({ code: "missing-ratio", title, message: `「${title}」块内没有内容` });
      continue;
    }

    // 首非空行必须是 ratio: N:M
    const firstLine = bodyLines[firstNonBlank].trim();
    const ratioMatch = firstLine.match(RATIO_RE);
    if (!ratioMatch) {
      // 首行以 ratio 开头但格式非法 → bad-ratio；否则视为缺 ratio 行
      if (RATIO_PREFIX_RE.test(firstLine)) {
        issues.push({ code: "bad-ratio", title, message: `「${title}」ratio 行格式非法：${firstLine}` });
      } else {
        issues.push({
          code: "missing-ratio",
          title,
          message: `「${title}」缺少 ratio 元数据行（块内首行应为 ratio: N:M）`,
        });
      }
      continue;
    }
    const ratio = `${ratioMatch[1]}:${ratioMatch[2]}`;

    // ratio 行之后全部内容为正文（不强依赖空行分隔）
    const prompt = bodyLines.slice(firstNonBlank + 1).join("\n").trim();
    if (!prompt) {
      issues.push({ code: "empty-prompt", title, message: `「${title}」提示词正文为空` });
      continue;
    }

    cards.push({ title, ratio, prompt });
  }

  return { cards, issues, skippedText: skipped };
}

// ---- 尺寸映射：单一事实源在 config.sizes（/api/config 下发），不硬编码 ----

import type { SizeOption, WorkflowNode } from "./types";

export interface ResolvedSize {
  /** 前端展示/生成用的尺寸值（config.sizes[].value，如 "1024x1024"） */
  value: string;
  /** true 表示按 label 未匹配到比例，回退到 sizes[0] */
  fallback: boolean;
}

/** 解析 "N:M" 比例 → 匹配 config.sizes 中 label 含 "(N:M" 的项（label 形如 "1024x1024 (1:1 1K)"） */
export function resolveCardSize(ratio: string, sizes: SizeOption[]): ResolvedSize {
  if (!/^\d+:\d+$/.test(ratio) || sizes.length === 0) {
    return { value: sizes[0]?.value ?? "1024x1024", fallback: true };
  }
  const match = sizes.find((s) => s.label.includes(`(${ratio}`));
  if (!match) {
    return { value: sizes[0].value, fallback: true };
  }
  return { value: match.value, fallback: false };
}

// ---- 建卡构造器：契约条目 → WorkflowNode 数组 ----

export interface PromptNodeBuildConfig {
  sizes: SizeOption[];
  defaultQuality: string;
  defaultOutputDir: string;
}

/** 每张卡片产出一个 PromptNode；位置在 origin 基础上按 6 列栅格平铺，6 个后换行下移 */
export function buildPromptNodes(
  cards: PromptCardSpec[],
  config: PromptNodeBuildConfig,
  origin: { x: number; y: number },
): WorkflowNode[] {
  return cards.map((card, i) => {
    const size = resolveCardSize(card.ratio, config.sizes);
    return {
      id: `prompt-${Date.now()}-${i}`,
      type: "prompt" as const,
      position: { x: origin.x + (i % 6) * 30, y: origin.y + Math.floor(i / 6) * 30 },
      data: {
        prompt: card.prompt,
        size: size.value,
        quality: config.defaultQuality,
        outputDir: config.defaultOutputDir,
        status: "idle" as const,
        title: card.title,
      },
    };
  });
}