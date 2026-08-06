import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generateImage, getConfig, openFolder } from "./api";
import { accentForWindow } from "./accent";
import type { AppConfig, ResultItem } from "./types";
import UploadZone from "./components/UploadZone";
import FolderPicker from "./components/FolderPicker";
import Gallery from "./components/Gallery";
import Select from "./components/Select";

const WIN_KEY = "aig-win";

/** 读取本标签页记忆的窗口号（window.name 跨刷新保留；复制标签页不继承） */
function readStoredWindowId(): number | null {
  const m = window.name.match(new RegExp(`^${WIN_KEY}-(\\d+)$`));
  return m ? Number(m[1]) : null;
}

/** 解析窗口号：URL ?win= 优先 > window.name 记忆 > null（交给服务端分配） */
function resolveWindowId(): number | null {
  const param = new URLSearchParams(window.location.search).get("win");
  const n = param ? Number(param) : NaN;
  if (Number.isInteger(n) && n > 0) return n;
  return readStoredWindowId();
}

/** 把窗口号记忆到本标签页（跨刷新保留编号） */
function storeWindowId(id: number) {
  window.name = `${WIN_KEY}-${id}`;
}

/** 开新窗口：去掉 win 参数，让新标签自动领下一个编号 */
function openNewWindow() {
  const url = new URL(window.location.href);
  url.searchParams.delete("win");
  window.open(url.pathname + url.search, "_blank");
}

/** 顶部标题区：SVG 叶子图标 + 标题 + 窗口编号徽章 + 新窗口按钮 */
function TitleBar({ windowId }: { windowId: number | null }) {
  return (
    <header className="mb-4 flex items-center gap-3 border-b border-neutral-200/70 pb-3">
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
      <h1 className="text-lg font-semibold tracking-wide">A站生图工具</h1>
      {windowId !== null && (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
          窗口 #{windowId}
        </span>
      )}
      <span className="text-muted ml-auto text-xs">
        文生图 / 图生图 · 不传参考图即文生图 · 生成约需 1-2 分钟
      </span>
      <button type="button" onClick={openNewWindow} className="btn-ghost px-2 py-1 text-xs">
        ＋ 新窗口
      </button>
    </header>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("low");
  const [outputDir, setOutputDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);

  useEffect(() => {
    const known = resolveWindowId();
    getConfig(known ?? undefined)
      .then((cfg) => {
        setConfig(cfg);
        setWindowId(cfg.windowId);
        // 服务端新分配的编号记住到本标签页，刷新后编号不变
        if (known === null) storeWindowId(cfg.windowId);
        document.title = cfg.windowId > 0 ? `A站生图工具 · 窗口 #${cfg.windowId}` : "A站生图工具";
        setSize(cfg.sizes[0]?.value ?? "");
        setOutputDir(cfg.defaultOutputDir);
      })
      .catch((err) => setLogs([`加载配置失败: ${String(err)}`]));
  }, []);

  // 尺寸 / 质量下拉选项（由后端配置派生）
  const sizeOptions = useMemo(
    () => (config?.sizes ?? []).map((s) => ({ value: s.value, label: `${s.label}（${s.cost}元）` })),
    [config],
  );
  const qualityOptions = useMemo(
    () => (config?.qualities ?? []).map((q) => ({ value: q, label: q })),
    [config],
  );

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setLogs(["请先输入提示词"]);
      return;
    }
    const startedAt = Date.now();
    setBusy(true);
    setResults([]);
    setElapsed(0);
    setLogs(["生成中 ..."]);
    // 实时计时：每秒刷新已等待秒数
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const res = await generateImage({ prompt, files, size, quality, outputDir, win: windowId ?? 0 });
      setResults(res.results);
      setLogs([...res.messages, `总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`]);
    } catch (err) {
      setLogs([`请求失败: ${String(err)}`]);
    } finally {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setBusy(false);
    }
  };

  const handleOpenFolder = async () => {
    const res = await openFolder(outputDir);
    if (!res.ok) {
      setLogs([`无法打开文件夹: ${outputDir}`]);
    }
  };

  const accent = accentForWindow(windowId);

  return (
    <div
      className="mx-auto max-w-[1500px] px-6 py-4"
      style={{ "--color-brand": accent.brand, "--color-brand-dark": accent.brandDark } as CSSProperties}
    >
      <TitleBar windowId={windowId} />

      {config && !config.hasApiKey && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          未配置 API Key（AIWANWU_API_KEY），生成图片将失败。请参考 README「首次使用」配置。
        </div>
      )}

      <main className="grid grid-cols-[5fr_7fr] items-start gap-5">
        {/* 左栏：输入面板 */}
        <section className="space-y-4">
          <div className="panel-card space-y-3">
            <label className="field-label" htmlFor="prompt">
              提示词
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="英文优先，减少歧义。例如：a red apple on white background, product photo"
              className="field-control resize-y"
            />
            <UploadZone files={files} onChange={setFiles} />
          </div>

          <div className="panel-card">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="size-select">
                  尺寸
                </label>
                <Select
                  id="size-select"
                  options={sizeOptions}
                  value={size}
                  onChange={setSize}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="quality-select">
                  质量
                </label>
                <Select
                  id="quality-select"
                  options={qualityOptions}
                  value={quality}
                  onChange={setQuality}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <div className="panel-card space-y-3">
            <label className="field-label" htmlFor="output-dir">
              输出路径
            </label>
            <FolderPicker value={outputDir} onChange={setOutputDir} />
            <div className="flex gap-2">
              <button type="button" onClick={handleGenerate} disabled={busy} className="btn-primary flex-1">
                {busy ? `生成中 ${elapsed}s` : "生成图片"}
              </button>
              <button
                type="button"
                onClick={handleOpenFolder}
                disabled={busy}
                className="btn-ghost"
              >
                打开文件夹
              </button>
            </div>
            <div className="log-box text-log max-h-40 overflow-auto">
              {logs.join("\n")}
            </div>
          </div>
        </section>

        {/* 右栏：结果画廊 */}
        <section className="panel-card min-h-[560px]">
          <Gallery items={results} />
        </section>
      </main>
    </div>
  );
}
