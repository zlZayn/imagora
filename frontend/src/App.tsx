import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generationHistory, getConfig, getHealthDetails, openFolder, readPersonalApiPresets, readPersonalApiSettings, rememberOutputDir, savePersonalApiPresets, savePersonalApiSettings } from "./api";
import { useGenerationTask } from "./useGenerationTask";
import { Palette } from "lucide-react";
import { ACCENT_PRESETS, accentForWindow, accentFromHue, hueForWindow, readAccentHue, saveAccentHue } from "./accent";
import { clearWallpaperImage, purgeLegacyWallpaperSettings, readWallpaperImage, saveWallpaperImage } from "./wallpaperStore";
import { readCanvasBounds, saveCanvasBounds } from "./canvasBounds";
import {
  PRESET_MATERIALS,
  PRESET_WALLPAPERS,
  presetWallpaperOf,
  readBackgroundPreset,
  saveBackgroundPreset,
  type BackgroundPresetId,
} from "./backgroundPreset";
import { SURFACE_TRANSPARENCY_LIMITS, readSurfaceTransparency, saveSurfaceTransparency, surfaceTokens } from "./surface";
import type { AppConfig, ConfigProfileView, GenerationTaskStatus, PersonalApiPreset, PersonalApiSettings, RefItem, ResultItem } from "./types";
import { errMessage, generatingLabel } from "./format";
import { clearInheritedState, readInheritedState, saveInheritedState } from "./windowInherit";
import { pickRecentPrompts } from "./recentPrompts";
import { BRAND_LOGO_PATH, BRAND_LOGO_VIEWBOX, brandLogoSvg } from "./brand/logo";
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

/** 个人 API 设置弹窗。
 *  默认值全部来自 /api/config（后端配置中心）——前端不硬编码中转站 / 模型 / 接口路径，
 *  改 config.json 即全局生效（唯一真相源）；用户填过则用用户自己的配置覆盖。 */
/**
 * 外观弹窗：主体色 / 我的壁纸 / 画布边界（三件都是「整页观感」，一处调完）。
 * 与「生图 API 设置」分开：接口配置配一次就不动，外观是高频调节，
 * 两者访问频率不同，因此各自有顶栏入口，不挤在同一个弹窗里。
 */
/** 弹窗内要展示的壁纸现状（由 App 持有真实状态，弹窗只读不算） */
interface WallpaperView {
  /** 是否已存下一张壁纸图 */
  hasImage: boolean;
  /** 正在读图 / 落库 */
  busy: boolean;
  /** 需要用户知道的一句话（如存储不可用），没有则不显示 */
  notice: string | null;
}


function AppearanceModal({
  accentHue,
  onAccentHueChange,
  wallpaper,
  onWallpaperFile,
  onWallpaperClear,
  backgroundPreset,
  onBackgroundPresetChange,
  surfaceTransparency,
  onSurfaceTransparencyChange,
  canvasBounds,
  onCanvasBoundsChange,
  onClose,
}: {
  /** 自定义主体色相；null 表示未自定义（回到按窗口自动配色） */
  accentHue: number | null;
  /** 改主体色：传 null 恢复自动配色 */
  onAccentHueChange: (hue: number | null) => void;
  /** 壁纸现状：图有无 + 参数 + 忙碌 / 提示 */
  wallpaper: WallpaperView;
  /** 选好一张图（App 负责落 IndexedDB 并铺底） */
  onWallpaperFile: (file: File) => void;
  /** 删除壁纸 */
  onWallpaperClear: () => void;
  /** 当前背景材质预设 */
  backgroundPreset: BackgroundPresetId;
  /** 改背景材质预设 */
  onBackgroundPresetChange: (id: BackgroundPresetId) => void;
  /** 卡片/面板/输入框通透度 0-1 */
  surfaceTransparency: number;
  /** 改通透度 */
  onSurfaceTransparencyChange: (value: number) => void;
  /** 画布是否显示自己的边界（边框 + 底色） */
  canvasBounds: boolean;
  onCanvasBoundsChange: (visible: boolean) => void;
  onClose: () => void;
}) {
  /** Esc 关闭（与图片预览弹窗同一套行为：模态开了就该能用 Esc 退出来） */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="studio-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <section
        className="studio-modal corner-rings flex max-h-[min(86vh,720px)] w-[min(480px,94vw)] flex-col p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">外观</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        {/* 内容区走 .modal-body：加了壁纸与画布开关后内容变高，超出时自己滚动并预留滚动条位 */}
        <div className="modal-body space-y-4">
          {/* 九色预设：点一个即整页换主色（按钮/角标/选中态/连线/聚焦环全部跟随） */}
          <div>
            <p className="field-label mb-2">主体色</p>
            <div className="accent-swatches">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.hue}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={accentHue === preset.hue}
                  className={`accent-swatch ${accentHue === preset.hue ? "is-on" : ""}`}
                  style={{ background: accentFromHue(preset.hue).brand }}
                  onClick={() => onAccentHueChange(preset.hue)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="field-label mb-2" htmlFor="accent-hue">
              色相微调
            </label>
            <div className="flex items-center gap-3">
              <input
                id="accent-hue"
                type="range"
                min={0}
                max={359}
                value={accentHue ?? 0}
                onChange={(e) => onAccentHueChange(Number(e.target.value))}
                className="accent-hue"
              />
              <span className="text-muted w-16 text-right text-xs">
                {accentHue === null ? "自动" : `${Math.round(accentHue)}°`}
              </span>
            </div>
          </div>

          <div className="spec-list">
            <div className="spec-list__row">
              <span className="spec-list__key">当前</span>
              <span className="spec-list__val">
                {accentHue === null ? "按窗口编号自动配色" : `自定义色相 ${Math.round(accentHue)}°`}
              </span>
            </div>
            <div className="spec-list__row">
              <span className="spec-list__key">生效范围</span>
              <span className="spec-list__val">所有窗口</span>
            </div>
          </div>

          {accentHue !== null && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => onAccentHueChange(null)}>
              恢复自动配色
            </button>
          )}

          {/* 背景：两种铺法分开写清——上面是材质（repeat 的纯色/纹理），下面是内置壁纸（cover 大图） */}
          <div className="border-t border-neutral-200/80 pt-4">
            <p className="field-label mb-2">背景材质</p>
            <div className="bg-swatches">
              {PRESET_MATERIALS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  aria-label={preset.label}
                  aria-pressed={backgroundPreset === preset.id}
                  className={`bg-swatch bg-swatch--${preset.id} ${backgroundPreset === preset.id ? "is-on" : ""}`}
                  onClick={() => onBackgroundPresetChange(preset.id)}
                />
              ))}
            </div>

            {/* 第二组标签：不复用 .field-label 的 mt-4，避免与 Tailwind 工具类的层叠顺序打架 */}
            <div className="mt-4 mb-2">
              <p className="field-label">预设壁纸</p>
            </div>
            <div className="bg-walls">
              {PRESET_WALLPAPERS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  aria-label={preset.label}
                  aria-pressed={backgroundPreset === preset.id}
                  className={`bg-wall bg-wall--${preset.id} ${backgroundPreset === preset.id ? "is-on" : ""}`}
                  onClick={() => onBackgroundPresetChange(preset.id)}
                >
                  <span className="bg-wall__name">{preset.label}</span>
                </button>
              ))}
            </div>

            <p className="text-caption mt-2">
              {PRESET_MATERIALS.concat(PRESET_WALLPAPERS).find((preset) => preset.id === backgroundPreset)?.hint ?? ""}
            </p>
            {presetWallpaperOf(backgroundPreset) !== null && wallpaper.hasImage && (
              <p className="text-caption mt-1">预设壁纸盖住了你的自选壁纸；删掉自选壁纸也还是这张预设图。</p>
            )}
          </div>

          {/* 我的壁纸：按原图直接铺满，不缩放、不模糊、不压暗（图本体存 IndexedDB，只在本机） */}
          <div className="border-t border-neutral-200/80 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="field-label">我的壁纸</p>
              <span className="text-caption">{wallpaper.hasImage ? "已设置" : "未设置"}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* 原生 file input 由 label 触发：按钮仍是 btn-ghost btn-sm 体系，不另造一套 */}
              <label className={`btn-ghost btn-sm ${wallpaper.busy ? "opacity-50" : "cursor-pointer"}`}>
                {wallpaper.busy ? "处理中…" : wallpaper.hasImage ? "换一张" : "选择图片"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="选择壁纸图片"
                  disabled={wallpaper.busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // 先清空 value：同一张图连选两次也要能触发 change
                    e.target.value = "";
                    if (file) onWallpaperFile(file);
                  }}
                />
              </label>
              {wallpaper.hasImage && (
                <button type="button" className="btn-ghost btn-sm btn-danger" onClick={onWallpaperClear}>
                  删除壁纸
                </button>
              )}
            </div>

            <p className="text-caption mt-2">
              选一张本地图片当整页背景，按原图铺满、不做任何处理（只存本机，不上传）。
            </p>
            {wallpaper.notice !== null && <p className="text-caption mt-1">{wallpaper.notice}</p>}
          </div>

          {/* 卡片通透度：材质字符串在 JS 里按此值算出后内联注入（不在 CSS 里嵌 var，压缩器会丢） */}
          <div className="border-t border-neutral-200/80 pt-4">
            <label className="field-label mb-2" htmlFor="surface-transparency">
              卡片通透度
            </label>
            <div className="flex items-center gap-3">
              <input
                id="surface-transparency"
                type="range"
                className="range-field flex-1"
                min={SURFACE_TRANSPARENCY_LIMITS.min}
                max={SURFACE_TRANSPARENCY_LIMITS.max}
                step={0.05}
                value={surfaceTransparency}
                onChange={(e) => onSurfaceTransparencyChange(Number(e.target.value))}
              />
              <span className="text-muted w-16 text-right text-xs">
                {Math.round(surfaceTransparency * 100)}%
              </span>
            </div>
            <p className="text-caption mt-2">越大卡片越透，越能看清背后的壁纸。拉到 100% 卡片完全让开，壁纸按原样清晰铺满（不做模糊）。</p>
          </div>

          {/* 画布边界：纯外观开关（容器边框 + 底色），不碰画布任何交互 */}
          <div className="flex items-start justify-between gap-4 border-t border-neutral-200/80 pt-4">
            <div>
              <p className="field-label">画布边界</p>
              <p className="text-caption mt-0.5">关闭后画布不显示边框与底色，与页面背景融为一体</p>
            </div>
            <input
              type="checkbox"
              className="switch mt-1"
              checked={canvasBounds}
              onChange={(e) => onCanvasBoundsChange(e.target.checked)}
              aria-label="显示画布边界"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function PersonalApiModal({
  settings,
  defaults,
  profileView,
  onSave,
  onClose,
}: {
  settings: PersonalApiSettings | null;
  /** /api/config 当前 profile 派生：baseUrl / apiPath / model（个人配置为空时的默认值） */
  defaults: PersonalApiSettings;
  /** 配置来源视图：后端配置只读展示（值 + 来自哪一层），让人看清自己覆盖的是哪一层 */
  profileView?: ConfigProfileView | undefined;
  onSave: (settings: PersonalApiSettings | null) => void;
  onClose: () => void;
}) {
  /** Esc 关闭（与图片预览弹窗同一套行为：模态开了就该能用 Esc 退出来） */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** 页签职责：看（当前生效）/ 改（个人配置）/ 管（预设资产）——三件事互不干扰 */
  const [tab, setTab] = useState<"active" | "edit" | "presets">("active");
  const [form, setForm] = useState<PersonalApiSettings>(settings ?? defaults);
  const [presets, setPresets] = useState<PersonalApiPreset[]>(() => readPersonalApiPresets());
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");

  /** 内容区高度：量出当前页签面板的自然高度写进 --panel-h，
   *  CSS 用它做显式像素端点 —— 只有两端都是像素，transition 才真的插值。
   *  ResizeObserver 保证页签切换与页内内容变化（如新增预设）都能跟上。 */
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 上一次量到的内容高度：判断这次是变高还是变矮；
   *  必须存 ref 而非 effect 内局部变量——effect 跟随 [tab] 重建，局部量会归零，
   *  于是「切到更高的一页」时判不出变高，滚动条照样闪。 */
  const prevContentRef = useRef(0);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const panel = panelRef.current;
    if (!body || !panel) return undefined;
    let timer = 0;
    const sync = () => {
      // 用小数精度量内容高度：offsetHeight 会取整丢掉零头（实测面板是 304.5 / 366.5），
      // 那不到 1px 的缺口会让 scrollHeight 比 clientHeight 大 1px ——
      // 正是「几乎拖不动」的滚动条来源（个人配置 / 预设两页内容矮，最明显）。
      const content = panel.getBoundingClientRect().height;
      // 容器高度 = 向上取整 + 1px 余量：保证内容永远放得下，不产生 1px 溢出
      const next = Math.ceil(content) + 1;
      const grew = prevContentRef.current > 0 && content > prevContentRef.current + 0.5;
      prevContentRef.current = content;
      body.style.setProperty("--panel-h", `${next}px`);
      // 变高的一瞬容器还装不下新内容，滚动条会闪出又消失 → 过渡窗口内先裁切
      if (grew) {
        body.dataset.growing = "true";
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          delete body.dataset.growing;
        }, 260);
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [tab]);

  /** 当前真正生效的一份：个人配置优先，否则用后端 profile 派生的默认值 */
  const usingPersonal = Boolean(settings);
  const activeSettings = settings ?? defaults;

  /** 载入预设 → 落到「个人配置」页，改了什么立刻看得见 */
  const applyPreset = (preset: PersonalApiPreset) => {
    setForm(preset.settings);
    setPresetName(preset.name);
    setSelectedPresetId(preset.id);
    setTab("edit");
  };
  /** 保存预设：同名视为覆盖，避免存出一堆同名条目 */
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || !form.baseUrl.trim() || !form.apiKey.trim()) return;
    const existing = presets.find((item) => item.name === name);
    const preset: PersonalApiPreset = {
      id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      settings: { ...form, baseUrl: form.baseUrl.trim().replace(/\/$/, "") },
    };
    const next = existing
      ? presets.map((item) => (item.id === existing.id ? preset : item))
      : [...presets, preset];
    setPresets(next);
    savePersonalApiPresets(next);
    setSelectedPresetId(preset.id);
  };
  const removePreset = (id: string) => {
    const next = presets.filter((item) => item.id !== id);
    setPresets(next);
    savePersonalApiPresets(next);
    if (selectedPresetId === id) setSelectedPresetId("");
  };
  const clearPersonal = () => {
    savePersonalApiSettings(null);
    onSave(null);
    onClose();
  };
  const saveAndUse = () => {
    const next = { ...form, baseUrl: form.baseUrl.trim().replace(/\/$/, "") };
    savePersonalApiSettings(next);
    onSave(next);
    onClose();
  };
  /** 预设下拉项：空值 = 不使用预设（与经典表单同款 Select 组件） */
  const presetOptions = [
    { value: "", label: presets.length ? "不使用预设" : "暂无预设" },
    ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
  ];
  /** 后端各字段的「值 + 来源」（由 /api/config 的 profileView 提供，前端不自行推断分层规则） */
  const backendField = (key: string) => profileView?.fields.find((field) => field.key === key);
  /** 生效值逐项标注来源：个人配置优先，否则回落到后端那一层 */
  const activeRows = [
    { key: "接口地址", value: activeSettings.baseUrl, mono: true, source: usingPersonal ? "个人配置" : (backendField("baseUrl")?.source ?? "") },
    { key: "接口路径", value: activeSettings.apiPath, mono: true, source: usingPersonal ? "个人配置" : (backendField("apiPath")?.source ?? "") },
    { key: "模型", value: activeSettings.model, mono: false, source: usingPersonal ? "个人配置" : (backendField("model")?.source ?? "") },
    {
      key: "API Key",
      value: usingPersonal
        ? (activeSettings.apiKey ? "已保存（本机浏览器）" : "未填写")
        : (backendField("apiKey")?.configured ? "已配置" : "未配置"),
      mono: false,
      source: usingPersonal ? "个人配置" : (backendField("apiKey")?.source ?? ""),
    },
  ];
  /** 字段统一形态：label（.field-label）+ 控件（.field-control），与经典表单同源 */
  const fields: { id: string; label: string; key: "baseUrl" | "apiKey" | "model" | "apiPath"; mono?: boolean; type?: string; placeholder?: string }[] = [
    { id: "api-base-url", label: "接口地址", key: "baseUrl", placeholder: "https://api.example.com" },
    { id: "api-key", label: "API Key", key: "apiKey", mono: true, type: "password", placeholder: "sk-..." },
    { id: "api-model", label: "模型名称", key: "model" },
    { id: "api-path", label: "图片接口路径", key: "apiPath", mono: true },
  ];
  return (
    <div className="studio-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <section
        className="studio-modal api-settings-modal corner-rings flex max-h-[min(86vh,720px)] w-[min(560px,94vw)] flex-col p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">生图 API 设置</h2>
          <span className="chip chip--sm chip--quiet">仅当前浏览器</span>
        </div>

        {/* 分段控件：看 / 改 / 管 各占一页（与顶栏模式切换同一套视觉，尺寸走 --h-ctl） */}
        <div className="tabs mb-4" role="tablist">
          {([["active", "使用中"], ["edit", "个人配置"], ["presets", "预设"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="tabs__item"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区：全模态只此一处滚动——页签内容再长也不会把操作栏顶出视口。
            高度由内容决定（.modal-body 负责高度过渡与滚动条占位），不用 flex-1 撑满，
            因此三页之间切换时模态高度是平滑变化的。 */}
        <div ref={bodyRef} className="modal-body pr-1">
          {tab === "active" && (
            <div ref={panelRef} key="active" className="tab-panel space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip chip--sm ${usingPersonal ? "chip--brand" : "chip--quiet"}`}>
                  {usingPersonal ? "个人配置生效中" : "后端配置生效中"}
                </span>
                <span className="text-[11px] text-neutral-400">
                  {usingPersonal ? "优先级最高，仅本机浏览器" : "来自 config.json / .env"}
                </span>
              </div>

              {/* 生效值：每行给出「值 + 它来自哪一层」（后端来源由 profileView 提供） */}
              <dl className="spec-list">
                {activeRows.map((row) => (
                  <div key={row.key} className="spec-list__row">
                    <dt className="spec-list__key">{row.key}</dt>
                    <dd className={`spec-list__val ${row.mono ? "spec-list__val--mono" : ""}`}>
                      <span className="block truncate">{row.value}</span>
                      <span className="spec-list__src truncate">{row.source}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              {/* 后端 profile 诊断：谁提供的 profile、本机注册过哪些 */}
              {profileView && (
                <div className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="chip chip--sm chip--quiet">
                      {profileView.name ? `profile · ${profileView.name}` : "未指定 profile"}
                    </span>
                    <span className="font-mono text-[10px] text-neutral-400">{profileView.nameSource}</span>
                  </div>
                  {profileView.registeredProfiles.length > 0 && (
                    <p className="mt-2 text-[10px] text-neutral-400">
                      本机 config.json 注册：{profileView.registeredProfiles.join(" · ")}
                    </p>
                  )}
                </div>
              )}

              <p className="text-[11px] text-neutral-400">
                任意 OpenAI 图片接口兼容服务均可。
                <a className="link ml-1" href="https://www.aiwanwu.cc/" target="_blank" rel="noreferrer">获取 API ↗</a>
              </p>
            </div>
          )}

          {tab === "edit" && (
            <div ref={panelRef} key="edit" className="tab-panel space-y-3">
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div>
                  <label className="field-label text-xs" htmlFor="api-preset">从预设载入</label>
                  <Select
                    id="api-preset"
                    className="mt-1"
                    options={presetOptions}
                    value={selectedPresetId}
                    onChange={(id) => {
                      setSelectedPresetId(id);
                      const preset = presets.find((item) => item.id === id);
                      if (preset) setForm(preset.settings);
                    }}
                  />
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setTab("presets")}>管理预设</button>
              </div>

              {fields.map((field) => (
                <div key={field.id}>
                  <label className="field-label text-xs" htmlFor={field.id}>{field.label}</label>
                  <input
                    id={field.id}
                    className={`field-control mt-1 ${field.mono ? "font-mono" : ""}`}
                    type={field.type ?? "text"}
                    value={form[field.key]}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                  />
                </div>
              ))}

              <p className="text-[11px] text-neutral-400">
                默认值取自后端 profile（改 config.json 即全局生效）；保存后本机浏览器优先使用这里填的。
              </p>
            </div>
          )}

          {tab === "presets" && (
            <div ref={panelRef} key="presets" className="tab-panel space-y-3">
              {presets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-6 text-center text-xs text-neutral-400">
                  还没有预设。到「个人配置」页填好接口与 Key，再回到这里保存。
                </p>
              ) : (
                <ul className="space-y-2">
                  {presets.map((preset) => (
                    <li
                      key={preset.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200/80 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-neutral-700">{preset.name}</span>
                        <span className="block truncate font-mono text-[10px] text-neutral-400">
                          {preset.settings.model || "未填模型"} · {preset.settings.baseUrl}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button type="button" className="btn-ghost btn-xs" onClick={() => applyPreset(preset)}>载入</button>
                        <button type="button" className="btn-ghost btn-xs btn-danger" onClick={() => removePreset(preset.id)}>删除</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className="field-control"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="预设名称（同名覆盖）"
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={savePreset}
                  disabled={!presetName.trim() || !form.baseUrl.trim() || !form.apiKey.trim()}
                >
                  保存当前配置
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 操作栏：跨页签常驻，与内容滚动解耦 */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-neutral-200/80 pt-4">
          <button type="button" className="btn-ghost btn-sm" disabled={!settings} onClick={clearPersonal}>清除个人配置</button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>取消</button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!form.baseUrl.trim() || !form.apiKey.trim()}
              onClick={saveAndUse}
            >
              保存并使用
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}


/** 顶部标题区：logo + 标题 + 窗口徽章 + 配置徽章（当前 profile·模型，确认切换中转站生效）+ 模式切换 + 新窗口按钮 */
function TitleBar({
  windowId,
  onNewWindow,
  mode,
  onModeChange,
  activeProfile,
  defaultModel,
  onOpenApi,
  personalApi,
  onOpenAppearance,
}: {
  windowId: number | null;
  onNewWindow: () => void;
  mode: "classic" | "canvas";
  onModeChange: (m: "classic" | "canvas") => void;
  /** 当前生效的 config.json profile 名（config.json 多 profile，换中转站后可在此确认） */
  activeProfile?: string | undefined;
  /** 当前 profile 的默认模型 */
  defaultModel?: string | undefined;
  onOpenApi: () => void;
  personalApi: PersonalApiSettings | null;
  /** 打开外观弹窗（主体色 / 我的壁纸 / 画布边界） */
  onOpenAppearance: () => void;
}) {
  /** 品牌区使用单层 Logo，悬停只改变高光与阴影，避免透视挤出造成重影。 */
  const brandRootRef = useRef<HTMLAnchorElement | null>(null);

  return (
    <header className="studio-header enter-up mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <a
        href="https://github.com/zlZayn/imagora"
        target="_blank"
        rel="noreferrer"
        ref={brandRootRef}
        className="brand-swing"
        title="打开远程仓库（GitHub）"
      >
        <span className="brand-swing__face">
          <svg width="30" height="30" viewBox={BRAND_LOGO_VIEWBOX} fill="var(--color-brand)" aria-hidden="true">
            <path d={BRAND_LOGO_PATH} />
          </svg>
          <h1 className="text-lg font-semibold tracking-wide">Imagora</h1>
        </span>
      </a>
      {windowId !== null && <span className="chip chip--brand window-chip">⌘{String(windowId).padStart(2, "0")}</span>}
      {activeProfile && (
        <span
          className="chip chip--quiet profile-chip"
          title={`当前配置：profile「${activeProfile}」${defaultModel ? ` · 默认模型 ${defaultModel}` : ""}`}
        >
          {activeProfile}
          {defaultModel ? ` · ${defaultModel}` : ""}
        </span>
      )}
      {/* 模式切换：胶囊分段控件（高度/圆角/字号统一由 .mode-switch 提供，与顶栏其它控件等高） */}
      <div className="mode-switch">
        <button
          type="button"
          onClick={() => onModeChange("classic")}
          className={`mode-switch__item transition-colors ${
            mode === "classic" ? "bg-brand/10 font-medium" : "hover:bg-neutral-50"
          }`}
        >
          经典表单
        </button>
        <button
          type="button"
          onClick={() => onModeChange("canvas")}
          className={`mode-switch__item transition-colors ${
            mode === "canvas" ? "bg-brand/10 font-medium" : "hover:bg-neutral-50"
          }`}
        >
          无限画布
        </button>
      </div>
      <button type="button" onClick={onNewWindow} className="btn-ghost ml-auto">
        ＋ 新窗口
      </button>
      <button type="button" onClick={onOpenApi} className={`api-settings-trigger btn-ghost ${personalApi ? "is-active" : ""}`}>
        {personalApi ? "个人 API 已启用" : "生图 API"}
      </button>
      {/* 外观独立入口：接口配置配一次就不动，外观是高频调节，分开才容易发现 */}
      <button type="button" onClick={onOpenAppearance} className="btn-ghost" title="外观" aria-label="外观">
        <Palette size={15} aria-hidden="true" />
      </button>
      {/* 右下镜像小字：与其它角落装饰同一套排版，对比度最低 */}
      <span className="corner-note">Image Workspace</span>
    </header>
  );
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  /** 自定义主体色相；null = 未自定义，回到按窗口编号自动配色（对所有窗口统一生效） */
  const [accentHue, setAccentHue] = useState<number | null>(() => readAccentHue());
  /** 当前生效的主体色：自定义优先，否则按窗口编号 */
  const accent = accentHue === null ? accentForWindow(windowId) : accentFromHue(accentHue);
  /** 归一后的色相：写页面底色变量用（负色相在 CSS 里虽合法，但归一后更直观） */
  const backgroundHue = (() => {
    const raw = accentHue === null ? hueForWindow(windowId) : accentHue;
    return ((raw % 360) + 360) % 360;
  })();
  const handleAccentHueChange = (hue: number | null) => {
    setAccentHue(hue);
    saveAccentHue(hue);
  };
  const [personalApi, setPersonalApi] = useState<PersonalApiSettings | null>(() => readPersonalApiSettings());
  const [showApiSettings, setShowApiSettings] = useState(false);
  /** 外观弹窗（主体色 / 我的壁纸 / 画布边界）：与接口配置分开，顶栏有独立入口 */
  const [showAppearance, setShowAppearance] = useState(false);
  /** 壁纸图本体（启动时从 IndexedDB 取回）；null = 没有壁纸 */
  const [wallpaperBlob, setWallpaperBlob] = useState<Blob | null>(null);
  /** 铺底用的 object URL：直接指向原图；null = 不铺底 */
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  /** 需要用户知道的一句话（如本地存储不可用）；null = 不显示 */
  const [wallpaperNotice, setWallpaperNotice] = useState<string | null>(null);
  /** 画布是否显示自己的边界（边框 + 底色）；默认开，保持既有观感 */
  const [canvasBounds, setCanvasBounds] = useState<boolean>(() => readCanvasBounds());
  /** 背景材质预设；默认「跟随主体色」（= 改动前的既有观感） */
  const [backgroundPreset, setBackgroundPreset] = useState<BackgroundPresetId>(() => readBackgroundPreset());
  /** 卡片/面板通透度 0-1；越大越透。材质字符串由 surfaceTokens 在 JS 里产出后内联注入 */
  const [surfaceTransparency, setSurfaceTransparency] = useState<number>(() => readSurfaceTransparency());
  /** 有自选图才算「设置了我的壁纸」（只影响外观弹窗里那句话与「删除壁纸」按钮） */
  const wallpaperActive = wallpaperBlob !== null;

  /** 启动时取回壁纸图：IndexedDB 不可用 / 读失败 = 没有壁纸（静默降级，不影响生图主流程） */
  useEffect(() => {
    let alive = true;
    // 顺手清掉旧版壁纸参数键（模糊/压暗/缩放那版已删，键是遗留垃圾）；
    // 待老用户都升过一次后，这行与 purgeLegacyWallpaperSettings 可一起删。
    purgeLegacyWallpaperSettings();
    void readWallpaperImage().then((blob) => {
      if (alive && blob) setWallpaperBlob(blob);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 铺底图 URL：**直接用原图 Blob 的 object URL，不做任何处理**（不缩放、不模糊、不重编码）。
   *  object URL 在切换 / 卸载时必须 revoke，否则内存泄漏。 */
  useEffect(() => {
    if (wallpaperBlob === null) {
      setWallpaperUrl(null);
      return undefined;
    }
    let created: string | null = null;
    try {
      created = URL.createObjectURL(wallpaperBlob);
      setWallpaperUrl(created);
    } catch {
      setWallpaperUrl(null);
    }
    return () => {
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [wallpaperBlob]);

  /** 预设壁纸（内置大图）的 URL；选的是材质时为 null */
  const presetWallpaperUrl = presetWallpaperOf(backgroundPreset);

  /**
   * 铺在整页底下的那张图：**预设壁纸优先于我的壁纸**。
   *
   * 优先级为什么这么定：预设壁纸是「用户刚点的那一下」，自选壁纸是更早留下的文件。
   * 点了预设却看不到任何变化，会让人以为坏了；反过来（自选盖住预设）至少用户知道
   * 自己存过一张图，弹窗里也有一句话告诉他怎么回到预设。
   *
   * 两者铺的是**同一层、同一套处理**（cover 原图 + 降噪 + 卡片文字描边 + 卡片全透），
   * 所以「内置预设」和「我的壁纸」观感完全一致，不额外分叉。
   */
  const pageWallpaperUrl = presetWallpaperUrl ?? wallpaperUrl;
  const pageWallpaperActive = pageWallpaperUrl !== null;

  /** 有壁纸（预设或自选）时：页面底色让位于壁纸（CSS 读 html[data-wallpaper]），前景元素照旧跟随主体色。
   *  颜色与观感全在 index.css，这里只翻一个属性，不在 JS 里算颜色。 */
  useEffect(() => {
    const root = document.documentElement;
    if (pageWallpaperActive) root.dataset.wallpaper = "on";
    else delete root.dataset.wallpaper;
  }, [pageWallpaperActive]);

  /** 背景材质：写到根元素，index.css 按 html[data-bg] 出对应材质变量 */
  useEffect(() => {
    document.documentElement.dataset.bg = backgroundPreset;
  }, [backgroundPreset]);

  /** 画布边界开关：写到根元素，样式由 index.css 的 html[data-canvas-bounds] 接管 */
  useEffect(() => {
    document.documentElement.dataset.canvasBounds = canvasBounds ? "on" : "off";
  }, [canvasBounds]);

  const handleBackgroundPresetChange = (id: BackgroundPresetId) => {
    setBackgroundPreset(id);
    saveBackgroundPreset(id);
  };

  /** 选图：直接落 IndexedDB，原图铺底，不做任何处理。
   *  存不进去（IndexedDB 不可用）就当没设置，只留一句说明，不抛错、不影响生图。 */
  const handleWallpaperFile = async (file: File) => {
    setWallpaperBusy(true);
    setWallpaperNotice(null);
    try {
      const saved = await saveWallpaperImage(file);
      if (!saved) {
        setWallpaperNotice("当前浏览器无法本地保存图片（IndexedDB 不可用），壁纸未设置");
        return;
      }
      setWallpaperBlob(file);
    } finally {
      setWallpaperBusy(false);
    }
  };

  /** 删壁纸：图与铺底图一起清 */
  const handleWallpaperClear = () => {
    setWallpaperBlob(null);
    setWallpaperUrl(null);
    setWallpaperNotice(null);
    void clearWallpaperImage();
  };

  /** 画布边界开关：纯外观偏好，不碰画布交互 */
  const handleCanvasBoundsChange = (visible: boolean) => {
    setCanvasBounds(visible);
    saveCanvasBounds(visible);
  };

  /** 卡片/面板/输入框的表面材质：按主色相 + 通透度在 JS 里算出字面量再内联注入。
   *  不在 CSS 里写 `hsl(… / calc(0.66 * var(--x)))`——压缩器会丢弃「函数内嵌 var()」的声明。 */
  const surface = surfaceTokens(backgroundHue, surfaceTransparency);
  const handleSurfaceTransparencyChange = (value: number) => {
    setSurfaceTransparency(value);
    saveSurfaceTransparency(value);
  };

  /** 动态 favicon：标签页图标跟随窗口主体色（与顶栏 logo / 菜单边框同色），多开一眼可辨 */
useEffect(() => {
  const svg = brandLogoSvg(accent.brand);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (!link.parentElement) document.head.appendChild(link);
  // 依赖 accent.brand（字符串）而非 accent 对象：换主体色时图标跟着变，且不会每渲染都重跑
}, [windowId, accent.brand]);

/** 页面底色跟随主体色：把归一后的色相写到根元素，index.css 的 body 底色读它 */
useEffect(() => {
  document.documentElement.style.setProperty("--accent-hue", String(backgroundHue));
}, [backgroundHue]);
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
  /** 最近用过的提示词（结果区空态展示，点一条填回输入框）；取不到就为空数组，不影响主流程 */
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
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

  // 最近用过的提示词：只读生成历史的前若干条，失败静默（空态退化为纯文字引导）
  useEffect(() => {
    generationHistory({ limit: 30 })
      .then((res) => setRecentPrompts(pickRecentPrompts(res.items)))
      .catch(() => setRecentPrompts([]));
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

  // 后端自检只知道项目默认 Key；启用个人 API 后，个人 Key 同样可以满足生图条件。
  const visibleHealthIssues = personalApi
    ? healthIssues.filter((issue) => !issue.includes("未配置 API Key"))
    : healthIssues;

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

  /** 个人 API 的默认值 = 后端当前 profile（config.json / .env 合并结果）：
   *  前端不硬编码中转站 / 模型 / 接口路径，改 config.json 即全局生效（唯一真相源）。 */
  const apiDefaults = useMemo<PersonalApiSettings>(
    () => ({
      baseUrl: config?.baseUrl ?? "",
      apiKey: "",
      model: config?.defaultModel ?? "",
      apiPath: config?.apiPath ?? "",
    }),
    [config],
  );

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
      className="imagora-app mx-auto max-w-[1500px] px-6 py-4"
      style={
        {
          "--color-brand": accent.brand,
          "--color-brand-dark": accent.brandDark,
          "--surface-card": surface.card,
          "--surface-panel": surface.panel,
          "--field-bg": surface.field,
          "--surface-blur": surface.blur,
        } as CSSProperties
      }
    >
      {/* 整页壁纸（内置预设图或我的自选图）：原图铺满、置于内容之下、不接收事件（只是背景，不挡任何交互）。
          降噪滤镜（去饱和 + 微压对比）只为让前景文字读得清，不遮挡、不压暗、不改尺寸。
          两者共用这一层，因此观感完全一致——别为预设图另开一层，否则可读性处理会分叉。 */}
      {pageWallpaperUrl !== null && (
        <div className="imagora-wallpaper" aria-hidden="true">
          <div className="imagora-wallpaper__image" style={{ backgroundImage: `url("${pageWallpaperUrl}")` }} />
        </div>
      )}
      <TitleBar
        windowId={windowId}
        onNewWindow={handleNewWindow}
        mode={mode}
        onModeChange={switchMode}
        activeProfile={config?.activeProfile}
        defaultModel={config?.defaultModel}
        onOpenApi={() => setShowApiSettings(true)}
        personalApi={personalApi}
        onOpenAppearance={() => setShowAppearance(true)}
      />
      {showAppearance && (
        <AppearanceModal
          accentHue={accentHue}
          onAccentHueChange={handleAccentHueChange}
          wallpaper={{ hasImage: wallpaperActive, busy: wallpaperBusy, notice: wallpaperNotice }}
          onWallpaperFile={(file) => void handleWallpaperFile(file)}
          onWallpaperClear={handleWallpaperClear}
          backgroundPreset={backgroundPreset}
          onBackgroundPresetChange={handleBackgroundPresetChange}
          surfaceTransparency={surfaceTransparency}
          onSurfaceTransparencyChange={handleSurfaceTransparencyChange}
          canvasBounds={canvasBounds}
          onCanvasBoundsChange={handleCanvasBoundsChange}
          onClose={() => setShowAppearance(false)}
        />
      )}
      {showApiSettings && (
        <PersonalApiModal
          settings={personalApi}
          defaults={apiDefaults}
          profileView={config?.profileView}
          onSave={setPersonalApi}
          onClose={() => setShowApiSettings(false)}
        />
      )}

      {visibleHealthIssues.length > 0 && (
        <div className="health-alert mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {visibleHealthIssues.map((issue) => <div key={issue}>{issue}</div>)}
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
            : "classic-main grid grid-cols-[6fr_4fr] items-start gap-5"
        }
      >
        {/* 左栏：输入面板。卡片只保留中文标题，不再印编号水印。 */}
        <section className="classic-input-column">
          <div className="space-y-4">
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
          </div>
        </section>

        {/* 右栏：结果画廊，保留轻量角落装饰。 */}
        <section className="classic-output-column">
          <section className="classic-result-panel corner-rings corner-deco panel-card enter-up enter-delay-3 min-h-[560px]">
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
              recentPrompts={recentPrompts}
              onPickPrompt={setPrompt}
            />
          </section>
        </section>
      </main>
    </div>
  );
}
