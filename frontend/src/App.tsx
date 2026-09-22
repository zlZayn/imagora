import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getConfig, getHealthDetails, openFolder, rememberOutputDir } from "./api";
import { useGenerationTask } from "./useGenerationTask";
import { accentForWindow } from "./accent";
import type { AppConfig, GenerationTaskStatus, RefItem, ResultItem } from "./types";
import { errMessage, generatingLabel } from "./format";
import { clearInheritedState, readInheritedState, saveInheritedState } from "./windowInherit";
import { UploadZone } from "./components/UploadZone";
import { FolderPicker } from "./components/FolderPicker";
import { ResultPanel } from "./components/ResultPanel";
import { LogLine } from "./components/LogLine";
import { Select } from "./components/Select";
import { CanvasPage } from "./components/CanvasPage";

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

/** 顶栏品牌区 3D 挤出参数（借 React Bits DepthText 手法）：
 *  logo 与标题各自正面/深度配色，越深的层越接近深度色（progress^2 缓动 + color-mix）；
 *  logo 正面跟随窗口主题色（var(--color-brand)），标题正面沿用 body 文字色，均不硬编码。 */
const BRAND_LAYERS = 10; // 挤出层数（越小越省 DOM，也越浅）
const BRAND_DEPTH = 1.5; // 层间距 px，挤出总深 ≈ BRAND_LAYERS × BRAND_DEPTH（≈15px，克制偏浅）
const LOGO_FACE = "var(--color-brand)"; // logo 正面基准色（跟随窗口主题色）
const LOGO_DEPTH = "var(--color-brand-dark)"; // logo 挤出深色（主题色加深）
const TEXT_FACE = "#262626"; // 标题正面基准色（与 body 文字色一致）
const TEXT_DEPTH = "#000000"; // 标题挤出深色
const LOGO_FACE_LIGHT = "color-mix(in srgb, var(--color-brand) 88%, white)"; // logo 正面浅色（比挤出层起点亮一档，叠加深浅层次；侧面渐变不变）
const TEXT_FACE_LIGHT = "color-mix(in srgb, #262626 88%, white)"; // 标题正面浅色

/** DepthText 同款分层取色：index 1…BRAND_LAYERS，层越靠前越接近正面色 */
function brandLayerColor(face: string, depth: string, index: number): string {
  const progress = index / BRAND_LAYERS;
  const eased = progress * progress;
  const faceMix = Math.round((1 - eased) * 72 + 4);
  return `color-mix(in srgb, ${face} ${faceMix}%, ${depth})`;
}

/** 挤出层索引：1（最前）…BRAND_LAYERS（最后，translateZ 最负 = 最深） */
const brandLayers = Array.from({ length: BRAND_LAYERS }, (_, li) => BRAND_LAYERS - li);

/** 品牌 logo 路径（与 favicon 同一图形，抽出便于多层复用） */
const BRAND_LOGO_PATH = "M755.242667 396.224L643.84 168.32l-0.064-0.106667Q634.176 149.333333 612.373333 149.333333t-31.424 18.901334l-0.917333 1.813333v0.213333l-124.906667 255.488-0.064 0.128q-2.709333 6.037333 1.045334 11.52 3.541333 5.205333 9.92 5.290667h45.802666q8.682667 0.042667 12.501334-7.658667l88.106666-180.330666 60.906667 124.714666H597.76q-8.832-0.085333-12.586667 7.829334l-18.709333 38.506666-0.042667 0.128q-2.709333 6.037333 1.024 11.52 3.562667 5.205333 9.92 5.290667h146.389334q18.453333 0.405333 28.8-14.549333 10.581333-15.253333 2.688-31.914667z m-2.922667-237.44l-0.725333-1.557333q-3.776-7.872-12.565334-7.872h-21.290666l0.021333 0.021333h-24.085333q-6.506667 0.042667-10.069334 5.333333-3.754667 5.568-0.917333 11.648l130.474667 274.709334q3.754667 7.850667 12.565333 7.850666h45.376q6.357333 0.064 10.005333-5.184 3.818667-5.546667 1.024-11.626666l-0.064-0.106667-126.101333-265.557333-3.626667-7.658667zM471.466667 247.402667l3.626666-0.170667 0.213334-0.021333q15.808-1.557333 26.24-13.034667 10.56-11.690667 9.728-27.136-0.853333-15.402667-12.586667-25.962667Q487.125333 170.666667 471.253333 170.666667H208.106667l-4.778667 0.128h-0.128q-35.114667 1.877333-59.328 26.090666Q119.466667 221.290667 119.466667 254.954667v573.952l0.128 4.544v0.149333q2.026667 33.578667 27.84 56.618667Q173.034667 913.066667 208.213333 913.066667h607.701334l4.757333-0.128h0.128q35.114667-1.877333 59.328-26.090667 24.405333-24.405333 24.405333-58.069333V501.12l-0.213333-3.52v-0.234667q-1.706667-15.338667-13.994667-25.28-12.117333-9.792-27.946666-9.024-15.872 0.768-26.88 11.712-10.346667 10.261333-11.157334 24.234667l-4.757333 4.970667q-70.741333 72.768-140.992 116.053333-60.394667 37.226667-91.925333 37.226667-30.442667 0-69.717334-27.477334l-5.802666-4.096-0.106667 0.128q-1.066667-1.024-2.474667-2.048l-6.613333-4.864q-10.24-7.488-15.701333-11.392l-9.024-6.186666-0.085334-0.064q-14.72-9.621333-27.605333-14.890667-18.773333-7.722667-37.248-7.722667-52.992 0-212.565333 110.336V255.232l0.106666-1.514667q1.066667-6.314667 8.362667-6.314666H471.466667z m-129.493334 441.514666l0.021334-0.021333 5.717333-3.349333q51.733333-30.08 64.426667-30.272 3.178667 0.170667 6.058666 1.493333l0.213334 0.085333 4.565333 1.770667q3.093333 1.344 5.909333 3.456l41.984 30.165333Q530.56 733.866667 586.666667 733.866667q95.338667 0 237.610666-126.890667v221.504l-0.106666 1.514667q-1.066667 6.314667-8.362667 6.314666H208.426667l-1.706667-0.106666q-7.04-1.024-7.018667-7.445334v-44.821333q86.613333-62.08 142.250667-95.04z";

/** 顶部标题区：logo + 标题 + 窗口徽章 + 配置徽章（当前 profile·模型，确认切换中转站生效）+ 模式切换 + 新窗口按钮 */
function TitleBar({
  windowId,
  onNewWindow,
  mode,
  onModeChange,
  activeProfile,
  defaultModel,
}: {
  windowId: number | null;
  onNewWindow: () => void;
  mode: "classic" | "canvas";
  onModeChange: (m: "classic" | "canvas") => void;
  /** 当前生效的 config.json profile 名（config.json 多 profile，换中转站后可在此确认） */
  activeProfile?: string;
  /** 当前 profile 的默认模型 */
  defaultModel?: string;
}) {
  /** 品牌区（logo + 标题整体）3D 指针跟随：借 React Bits DepthText 手法——
   *  10 层挤出堆叠（见 BRAND_LAYERS / BRAND_DEPTH + .brand-swing__layer 样式）常驻 DOM，
   *  默认平面（正面层盖住挤出层，无视觉变化）；鼠标接近时向光标方向倾斜，
   *  挤出厚度随摆动显现、移动时平滑跟随、离开后回摆到平面。
   *  只在悬停期写 transform（不碰颜色/字号），纯 JS 驱动（不受全局 reduced-motion
   *  的 CSS 动画降级规则影响——指针跟随属直接操作型动效，非周边自动动画）。 */
  const brandRootRef = useRef<HTMLAnchorElement | null>(null);
  const brandStageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = brandRootRef.current;
    const stage = brandStageRef.current;
    if (!root || !stage || typeof window === "undefined") return;
    // 触屏 / 无 hover 设备不启用（DepthText 同款限制）
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const TILT = 11;
    const SMOOTHING = 0.14;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));

    let raf = 0;
    let hovering = false;
    // 默认平面：0 偏移；仅悬停期写入倾角，离开回摆到 0（3D 只在鼠标靠近时出现）
    const current = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    const apply = () => {
      stage.style.transform = `rotateX(${current.x.toFixed(3)}deg) rotateY(${current.y.toFixed(3)}deg)`;
    };
    const tick = () => {
      current.x += (target.x - current.x) * SMOOTHING;
      current.y += (target.y - current.y) * SMOOTHING;
      apply();
      // 已回到静止位且不在悬停：停掉循环（省电，一轮 tick 即归位）
      if (!hovering && Math.abs(current.x - target.x) < 0.01 && Math.abs(current.y - target.y) < 0.01) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const ensureLoop = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onEnter = () => {
      hovering = true;
      ensureLoop();
    };
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // 与 DepthText 同款归一：光标相对中心越偏，倾角越大
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.7);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.7);
      target.y = clamp(nx) * TILT;
      target.x = -clamp(ny) * TILT;
    };
    const onLeave = () => {
      hovering = false;
      target.x = 0;
      target.y = 0;
      ensureLoop();
    };

    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
      stage.style.transform = "";
    };
  }, []);

  return (
    <header className="enter-up mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-200/70 pb-3">
      <a
        href="https://github.com/zlZayn/imagora"
        target="_blank"
        rel="noreferrer"
        ref={brandRootRef}
        className="brand-swing"
        title="打开远程仓库（GitHub）"
      >
        <div ref={brandStageRef} className="brand-swing__stage">
          {brandLayers.map((index) => (
            <span
              key={index}
              className="brand-swing__layer"
              style={{ transform: `translateZ(${-index * BRAND_DEPTH}px)` }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 1024 1024"
                aria-hidden="true"
                style={{ fill: brandLayerColor(LOGO_FACE, LOGO_DEPTH, index) }}
              >
                <path d={BRAND_LOGO_PATH} />
              </svg>
              <h1 className="text-lg font-semibold tracking-wide" style={{ color: brandLayerColor(TEXT_FACE, TEXT_DEPTH, index) }}>
                Imagora
              </h1>
            </span>
          ))}
          <span className="brand-swing__face">
            <svg
              width="30"
              height="30"
              viewBox="0 0 1024 1024"
              fill={LOGO_FACE_LIGHT}
              aria-hidden="true"
            >
              <path d={BRAND_LOGO_PATH} />
            </svg>
            <h1 className="text-lg font-semibold tracking-wide" style={{ color: TEXT_FACE_LIGHT }}>
              Imagora
            </h1>
          </span>
        </div>
      </a>
      {windowId !== null && (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
          窗口 #{windowId}
        </span>
      )}
      {activeProfile && (
        <span
          className="rounded-md bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-medium text-brand/80"
          title={`当前配置：profile「${activeProfile}」${defaultModel ? ` · 默认模型 ${defaultModel}` : ""}`}
        >
          {activeProfile}
          {defaultModel ? ` · ${defaultModel}` : ""}
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

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);

/** 动态 favicon：标签页图标跟随窗口主题色（与顶栏 logo / 菜单边框同色），多开一眼可辨 */
useEffect(() => {
  const { brand } = accentForWindow(windowId);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="${brand}">
    <path d="M755.242667 396.224L643.84 168.32l-0.064-0.106667Q634.176 149.333333 612.373333 149.333333t-31.424 18.901334l-0.917333 1.813333v0.213333l-124.906667 255.488-0.064 0.128q-2.709333 6.037333 1.045334 11.52 3.541333 5.205333 9.92 5.290667h45.802666q8.682667 0.042667 12.501334-7.658667l88.106666-180.330666 60.906667 124.714666H597.76q-8.832-0.085333-12.586667 7.829334l-18.709333 38.506666-0.042667 0.128q-2.709333 6.037333 1.024 11.52 3.562667 5.205333 9.92 5.290667h146.389334q18.453333 0.405333 28.8-14.549333 10.581333-15.253333 2.688-31.914667z m-2.922667-237.44l-0.725333-1.557333q-3.776-7.872-12.565334-7.872h-21.290666l0.021333 0.021333h-24.085333q-6.506667 0.042667-10.069334 5.333333-3.754667 5.568-0.917333 11.648l130.474667 274.709334q3.754667 7.850667 12.565333 7.850666h45.376q6.357333 0.064 10.005333-5.184 3.818667-5.546667 1.024-11.626666l-0.064-0.106667-126.101333-265.557333-3.626667-7.658667zM471.466667 247.402667l3.626666-0.170667 0.213334-0.021333q15.808-1.557333 26.24-13.034667 10.56-11.690667 9.728-27.136-0.853333-15.402667-12.586667-25.962667Q487.125333 170.666667 471.253333 170.666667H208.106667l-4.778667 0.128h-0.128q-35.114667 1.877333-59.328 26.090666Q119.466667 221.290667 119.466667 254.954667v573.952l0.128 4.544v0.149333q2.026667 33.578667 27.84 56.618667Q173.034667 913.066667 208.213333 913.066667h607.701334l4.757333-0.128h0.128q35.114667-1.877333 59.328-26.090667 24.405333-24.405333 24.405333-58.069333V501.12l-0.213333-3.52v-0.234667q-1.706667-15.338667-13.994667-25.28-12.117333-9.792-27.946666-9.024-15.872 0.768-26.88 11.712-10.346667 10.261333-11.157334 24.234667l-4.757333 4.970667q-70.741333 72.768-140.992 116.053333-60.394667 37.226667-91.925333 37.226667-30.442667 0-69.717334-27.477334l-5.802666-4.096-0.106667 0.128q-1.066667-1.024-2.474667-2.048l-6.613333-4.864q-10.24-7.488-15.701333-11.392l-9.024-6.186666-0.085334-0.064q-14.72-9.621333-27.605333-14.890667-18.773333-7.722667-37.248-7.722667-52.992 0-212.565333 110.336V255.232l0.106666-1.514667q1.066667-6.314667 8.362667-6.314666H471.466667z m-129.493334 441.514666l0.021334-0.021333 5.717333-3.349333q51.733333-30.08 64.426667-30.272 3.178667 0.170667 6.058666 1.493333l0.213334 0.085333 4.565333 1.770667q3.093333 1.344 5.909333 3.456l41.984 30.165333Q530.56 733.866667 586.666667 733.866667q95.338667 0 237.610666-126.890667v221.504l-0.106666 1.514667q-1.066667 6.314667-8.362667 6.314666H208.426667l-1.706667-0.106666q-7.04-1.024-7.018667-7.445334v-44.821333q86.613333-62.08 142.250667-95.04z"/>
  </svg>`;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (!link.parentElement) document.head.appendChild(link);
}, [windowId]);
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
  /** 最近一次生成失败的原因（结果区失败面板展示；完整错误仍进日志） */
  const [taskError, setTaskError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(0);
  /** 输出路径防抖上报定时器（用户改路径 300ms 后记住到服务端） */
  const outputDirTimerRef = useRef<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  /** 最近一次成功生成的提交 id（后端落盘提交图快照，可整图导入画布） */
  const [lastSubmissionId, setLastSubmissionId] = useState<string | null>(null);
  /** 待导入画布的提交 id（传给 CanvasPage 触发整图导入，完成后清空） */
  const [pendingSubmissionImport, setPendingSubmissionImport] = useState<string | null>(null);
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

  /** 订阅当前任务状态：queued/running 驱动按钮，终态落结果 / 日志 / 结果区状态面板。
   *  过程状态（排队/生成中）由右栏 ResultPanel 呈现，日志区只收终态与操作反馈——不写过程行。 */
  useEffect(() => {
    return generationTask.subscribe((taskId, view) => {
      if (taskId !== activeTaskId) return;
      if (view.status === "queued") {
        setTaskStatus("queued");
        setElapsed(0);
        setTaskError(null);
      } else if (view.status === "running") {
        setTaskStatus("running");
        setElapsed(view.elapsed);
      } else if (view.status === "done") {
        setTaskStatus("done");
        setResults(view.results ?? []);
        setLastSubmissionId(view.submissionId ?? null);
        setTaskError(null);
        setLogs([
          ...(view.messages ?? []),
          `总用时 ${((Date.now() - startedAtRef.current) / 1000).toFixed(1)} 秒`,
        ]);
      } else if (view.status === "failed") {
        setTaskStatus("failed");
        setResults([]);
        setTaskError(view.error ?? "未知错误");
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
    setTaskError(null);
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

  /** 把最近一次经典提交整图导入画布：切到画布模式并下发 importSubmissionId */
  const handleImportToCanvas = () => {
    if (!lastSubmissionId) {
      setLogs(["当前结果无提交快照（旧历史不完整），无法整图导入"]);
      return;
    }
    setPendingSubmissionImport(lastSubmissionId);
    setCanvasMounted(true);
    switchMode("canvas");
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
      <TitleBar
        windowId={windowId}
        onNewWindow={handleNewWindow}
        mode={mode}
        onModeChange={switchMode}
        activeProfile={config?.activeProfile}
        defaultModel={config?.defaultModel}
      />

      {healthIssues.length > 0 && (
        <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {healthIssues.map((issue) => <div key={issue}>{issue}</div>)}
        </div>
      )}

      {/* 无限画布：首次进入后保持挂载，切换模式仅显隐（内容保留，退出窗口才清空） */}
      {canvasMounted && config && (
        <div className={mode === "canvas" ? "block" : "hidden"}>
          <CanvasPage
            config={config}
            importSubmissionId={pendingSubmissionImport}
            onSubmissionImported={() => setPendingSubmissionImport(null)}
          />
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
                <LogLine key={i} text={line} />
              ))}
            </div>
          </div>
        </section>

        {/* 右栏：结果画廊 */}
        <section className="panel-card enter-up enter-delay-3 min-h-[560px]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="field-label mb-0">生成结果</span>
            {lastSubmissionId && (
              <button type="button" onClick={handleImportToCanvas} className="btn-ghost text-xs">
                导入画布
              </button>
            )}
          </div>
          <ResultPanel
            status={taskStatus}
            elapsed={elapsed}
            meta={{ refCount: refs.length, size, quality, outputDir }}
            error={taskError}
            results={results}
          />
        </section>
      </main>
    </div>
  );
}
