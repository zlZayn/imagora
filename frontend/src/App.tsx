import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getConfig, getHealthDetails, openFolder, rememberOutputDir } from "./api";
import { useGenerationTask } from "./useGenerationTask";
import { accentForWindow } from "./accent";
import type { AppConfig, GenerationTaskStatus, RefItem, ResultItem } from "./types";
import { errMessage, generatingLabel } from "./format";
import { clearInheritedState, readInheritedState, saveInheritedState } from "./windowInherit";
import UploadZone from "./components/UploadZone";
import FolderPicker from "./components/FolderPicker";
import Gallery from "./components/Gallery";
import Select from "./components/Select";
import CanvasPage from "./components/CanvasPage";

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

/** 顶部标题区：logo + 标题 + 窗口徽章 + 模式切换（并入标题行省空间）+ 新窗口按钮 */
function TitleBar({
  windowId,
  onNewWindow,
  mode,
  onModeChange,
}: {
  windowId: number | null;
  onNewWindow: () => void;
  mode: "classic" | "canvas";
  onModeChange: (m: "classic" | "canvas") => void;
}) {
  return (
    <header className="enter-up mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-200/70 pb-3">
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
      <h1 className="text-lg font-semibold tracking-wide">Imagora</h1>
      {windowId !== null && (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
          窗口 #{windowId}
        </span>
      )}
      {/* 模式切换：紧凑分段按钮，并入标题行右侧 */}
      <div className="flex overflow-hidden rounded-md border border-neutral-200">
        <button
          type="button"
          onClick={() => onModeChange("classic")}
          className={`px-3 py-0.5 text-xs transition-colors ${
            mode === "classic" ? "bg-brand/10 font-medium text-brand" : "text-neutral-500 hover:bg-neutral-50"
          }`}
        >
          经典表单
        </button>
        <button
          type="button"
          onClick={() => onModeChange("canvas")}
          className={`px-3 py-0.5 text-xs transition-colors ${
            mode === "canvas" ? "bg-brand/10 font-medium text-brand" : "text-neutral-500 hover:bg-neutral-50"
          }`}
        >
          无限画布
        </button>
      </div>
      <span className="text-muted ml-auto hidden text-xs xl:block">
        文生图 / 图生图 · 不传参考图即文生图 · 生成约需 1-2 分钟
      </span>
      <button type="button" onClick={onNewWindow} className="btn-ghost px-2 py-1 text-xs">
        ＋ 新窗口
      </button>
    </header>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  /** 界面模式：经典表单 / 无限画布（?mode=canvas 直达画布） */
  const [mode, setMode] = useState<"classic" | "canvas">(() =>
    new URLSearchParams(window.location.search).get("mode") === "canvas" ? "canvas" : "classic",
  );
  /** 画布是否已挂载：首次进入画布后保持常驻（切换模式不销毁，内容保留；退出窗口才清空） */
  const [canvasMounted, setCanvasMounted] = useState(() => mode === "canvas");
  const switchMode = (m: "classic" | "canvas") => {
    if (m === "canvas") setCanvasMounted(true);
    setMode(m);
  };
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("high");
  const [outputDir, setOutputDir] = useState("");
  /** 生成任务：submit 返回 taskId，订阅回调按 activeTaskId 驱动状态 */
  const generationTask = useGenerationTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<GenerationTaskStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(0);
  /** 输出路径防抖上报定时器（用户改路径 300ms 后记住到服务端） */
  const outputDirTimerRef = useRef<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [healthIssues, setHealthIssues] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // 日志更新后自动滚动到底部，配合逐行淡入
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const known = resolveWindowId();
    getConfig(known ?? undefined)
      .then((cfg) => {
        setConfig(cfg);
        setWindowId(cfg.windowId);
        // 服务端新分配的编号记住到本标签页，刷新后编号不变
        if (known === null) storeWindowId(cfg.windowId);
        document.title = cfg.windowId > 0 ? `Imagora · 窗口 #${cfg.windowId}` : "Imagora";
        setSize(cfg.sizes[0]?.value ?? "");
        setOutputDir(cfg.defaultOutputDir);
        // 继承上一窗口的状态（仅「＋ 新窗口」按钮写入；命令行打开无此键，保持全新）
        const inherited = readInheritedState();
        if (inherited) {
          clearInheritedState();
          if (inherited.size && cfg.sizes.some((s) => s.value === inherited.size)) {
            setSize(inherited.size);
          }
          if (inherited.quality && cfg.qualities.includes(inherited.quality)) {
            setQuality(inherited.quality);
          }
          if (inherited.outputDir) setOutputDir(inherited.outputDir);
          // 参考图本体已在服务端，只还原元信息，直接渲染 URL
          if (inherited.refs.length) {
            setRefs(
              inherited.refs.map((r) => ({
                id: r.path,
                path: r.path,
                url: `/api/image?path=${encodeURIComponent(r.path)}`,
                name: r.name,
                size: r.size,
                ext: r.ext,
                mime: "",
                synced: true,
              })),
            );
          }
          // 继承提示（如部分图片未上传成功）显示在新窗口的日志区
          if (inherited.notice) setLogs([inherited.notice]);
        }
      })
      .catch((err) => setLogs([`初始化失败：${errMessage(err)}`]));
  }, []);

  useEffect(() => {
    getHealthDetails()
      .then((health) => setHealthIssues(health.issues))
      .catch((err) => setHealthIssues([`启动自检失败：${errMessage(err)}`]));
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

  /** 订阅当前任务状态：queued/running 驱动按钮，终态落结果 / 日志 */
  useEffect(() => {
    return generationTask.subscribe((taskId, view) => {
      if (taskId !== activeTaskId) return;
      if (view.status === "queued") {
        setTaskStatus("queued");
        setElapsed(0);
        setLogs((prev) => (prev[0] === "已提交，排队等待生成…" ? prev : ["已提交，排队等待生成…"]));
      } else if (view.status === "running") {
        setTaskStatus("running");
        setElapsed(view.elapsed);
        setLogs((prev) => (prev[0] === "生成中…" ? prev : ["生成中…"]));
      } else if (view.status === "done") {
        setTaskStatus("done");
        setResults(view.results ?? []);
        setLogs([
          ...(view.messages ?? []),
          `总用时 ${((Date.now() - startedAtRef.current) / 1000).toFixed(1)} 秒`,
        ]);
      } else if (view.status === "failed") {
        setTaskStatus("failed");
        setResults([]);
        setLogs([`生成失败：${view.error ?? "未知错误"}`]);
      } else if (view.status === "cancelled") {
        setTaskStatus("cancelled");
        setLogs(["生成已取消"]);
      }
    });
  // 与 CanvasPage 同约定：只依赖稳定的 subscribe，避免每次任务状态刷新重建订阅
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationTask.subscribe, activeTaskId]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setLogs(["请先输入提示词"]);
      return;
    }
    startedAtRef.current = Date.now();
    setResults([]);
    setElapsed(0);
    setTaskStatus("queued");
    setLogs(["已提交，排队等待生成…"]);
    try {
      // 已上传的走 ref_paths 复用服务端文件；未上传成功的本地兜底走 multipart
      const syncedRefs = refs.filter((r) => r.synced);
      const pendingFiles = refs.filter((r) => !r.synced).flatMap((r) => (r.file ? [r.file] : []));
      const taskId = await generationTask.submit({
        prompt,
        refPaths: syncedRefs.map((r) => r.path),
        files: pendingFiles,
        size,
        quality,
        outputDir,
        win: windowId ?? 0,
      });
      setActiveTaskId(taskId);
    } catch (err) {
      setTaskStatus(null);
      setLogs([`提交失败：${errMessage(err)}`]);
    }
  };

  /** 生成中（排队或执行）时禁用表单操作 */
  const busy = taskStatus === "queued" || taskStatus === "running";

  const handleOpenFolder = async () => {
    const res = await openFolder(outputDir);
    if (!res.ok) {
      setLogs(["打开文件夹失败"]);
    }
  };

  /** 输出路径变更：本地更新 + 防抖上报服务端记住（挂载/继承的默认值不走这里，避免覆盖记录） */
  const handleOutputDirChange = (path: string) => {
    setOutputDir(path);
    if (outputDirTimerRef.current) {
      window.clearTimeout(outputDirTimerRef.current);
    }
    outputDirTimerRef.current = window.setTimeout(() => {
      rememberOutputDir(path).catch(() => {
        // 尽力而为：记录失败不影响界面
      });
    }, 300);
  };

  const accent = accentForWindow(windowId);

  /** 新窗口：参考图已存服务端，只把元信息 + 参数写入 sessionStorage 后开窗（提示词不保留）。
   *  继承失败的提示随状态带到新窗口，显示在新窗口的日志区（而非原窗口）。 */
  const handleNewWindow = () => {
    const syncedRefs = refs.filter((r) => r.synced);
    let notice: string | undefined;
    if (refs.length > 0 && syncedRefs.length === 0) {
      notice = "参考图上传失败，新窗口未继承图片";
    } else if (syncedRefs.length < refs.length) {
      notice = `${refs.length - syncedRefs.length} 张参考图上传失败，新窗口未继承`;
    }
    const saved = saveInheritedState(
      syncedRefs.map(({ path, name, size, ext }) => ({ path, name, size, ext })),
      size,
      quality,
      outputDir,
      notice,
    );
    if (!saved.ok) {
      // sessionStorage 整体不可用（极少见）：新窗口从默认设置开始
      setLogs(["无法保存状态到新窗口，新窗口使用默认设置"]);
    }
    openNewWindow();
  };

  return (
    <div
      className="mx-auto max-w-[1500px] px-6 py-4"
      style={{ "--color-brand": accent.brand, "--color-brand-dark": accent.brandDark } as CSSProperties}
    >
      <TitleBar windowId={windowId} onNewWindow={handleNewWindow} mode={mode} onModeChange={switchMode} />

      {healthIssues.length > 0 && (
        <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {healthIssues.map((issue) => <div key={issue}>{issue}</div>)}
        </div>
      )}

      {/* 无限画布：首次进入后保持挂载，切换模式仅显隐（内容保留，退出窗口才清空） */}
      {canvasMounted && config && (
        <div className={mode === "canvas" ? "block" : "hidden"}>
          <CanvasPage config={config} />
        </div>
      )}
      {/* 经典表单：始终挂载（状态在 App），按模式显隐 */}
      <main
        className={
          mode === "canvas"
            ? "hidden"
            : "grid grid-cols-[6fr_4fr] items-start gap-5"
        }
      >
        {/* 左栏：输入面板 */}
        <section className="space-y-4">
          <div className="panel-card enter-up space-y-3">
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
            <UploadZone refs={refs} onChange={setRefs} />
          </div>

          <div className="panel-card enter-up enter-delay-1 relative z-30">
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

          <div className="panel-card enter-up enter-delay-2 space-y-3">
            <label className="field-label" htmlFor="output-dir">
              输出路径
            </label>
            <FolderPicker value={outputDir} onChange={handleOutputDirChange} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy}
                className={`btn-primary flex-1 ${busy ? "btn-busy" : ""}`}
              >
                {busy ? (taskStatus === "queued" ? "排队中…" : generatingLabel(elapsed)) : "生成图片"}
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
            <div ref={logRef} className="log-box text-log max-h-40 overflow-auto">
              {logs.map((line, i) => (
                <div key={i} className="log-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 右栏：结果画廊 */}
        <section className="panel-card enter-up enter-delay-3 min-h-[560px]">
          <Gallery items={results} />
        </section>
      </main>
    </div>
  );
}
