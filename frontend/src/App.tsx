import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generationHistory, getConfig, getHealthDetails, openFolder, readPersonalApiPresets, readPersonalApiSettings, rememberOutputDir, savePersonalApiPresets, savePersonalApiSettings } from "./api";
import { useGenerationTask } from "./useGenerationTask";
import { Palette } from "lucide-react";
import { ACCENT_PRESETS, accentForWindow, accentFromHue, hueForWindow, readAccentHue, saveAccentHue } from "./accent";
import { clearWallpaperImage, purgeLegacyWallpaperSettings, readWallpaperImage, saveWallpaperImage } from "./wallpaperStore";
import { readCanvasBounds, saveCanvasBounds } from "./canvasBounds";
import {
  BACKGROUND_PRESETS,
  readBackgroundPreset,
  saveBackgroundPreset,
  type BackgroundPresetId,
} from "./backgroundPreset";
import { SURFACE_TRANSPARENCY_LIMITS, readSurfaceTransparency, saveSurfaceTransparency, surfaceTokens } from "./surface";
import type { AppConfig, ConfigProfileView, GenerationTaskStatus, ModelOption, PersonalApiPreset, PersonalApiSettings, ProviderCatalog, RefItem, ResultItem } from "./types";
import { errMessage, generatingLabel } from "./format";
import { clearInheritedState, readInheritedState, saveInheritedState } from "./windowInherit";
import { pickRecentPrompts } from "./recentPrompts";
import { applyProviderToForm } from "./providerSwitch";
import { findProvider as findCatalogProvider, priceSummary, qualityAppliesTo, resolveSizes } from "./apiCatalog";
import { BRAND_LOGO_PATH, BRAND_LOGO_VIEWBOX, brandLogoSvg } from "./brand/logo";
import { UploadZone } from "./components/UploadZone";
import { FolderPicker } from "./components/FolderPicker";
import { ResultPanel } from "./components/ResultPanel";
import { LogLine } from "./components/LogLine";
import { ModalShell } from "./components/ModalShell";
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
    <ModalShell title="外观" onClose={onClose} className="modal-panel--md corner-rings">
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

          {/* 背景底色：只有两项预置（跟随主体色 / 纯白）；整页大图只走下面的「我的壁纸」，不再有内置预设壁纸 */}
          <div className="border-t border-neutral-200/80 pt-4">
            <p className="field-label mb-2">背景材质</p>
            <div className="bg-swatches">
              {BACKGROUND_PRESETS.map((preset) => (
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

            <p className="text-caption mt-2">
              {BACKGROUND_PRESETS.find((preset) => preset.id === backgroundPreset)?.hint ?? ""}
            </p>
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
      </ModalShell>
  );
}

function PersonalApiModal({
  settings,
  defaults,
  profileView,
  models,
  providers,
  onSave,
  onClose,
}: {
  settings: PersonalApiSettings | null;
  /** /api/config 当前 profile 派生：baseUrl / apiPath / model（个人配置为空时的默认值） */
  defaults: PersonalApiSettings;
  /** 配置来源视图：后端配置只读展示（值 + 来自哪一层），让人看清自己覆盖的是哪一层 */
  profileView?: ConfigProfileView | undefined;
  /** 后端下发的可选模型清单（每个带尺寸/价格）；模型名称字段据此渲染为下拉框 */
  models?: ModelOption[] | undefined;
  /** 全部来源目录（各 profile 的地址 + 尺寸 + 模型）：价格按「这套接口」解析 */
  providers?: ProviderCatalog[] | undefined;
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

  /** 页签职责：看（当前生效）/ 改（个人配置）/ 管（我的接口）——三件事互不干扰 */
  const [tab, setTab] = useState<"active" | "edit" | "presets">("active");
  const [form, setForm] = useState<PersonalApiSettings>(settings ?? defaults);
  /** 「我的接口」记录（复用 presets 存储键，兼容老数据） */
  const [presets, setPresets] = useState<PersonalApiPreset[]>(() => readPersonalApiPresets());

  /** 当前真正生效的一份：个人配置优先，否则用后端 profile 派生的默认值 */
  const usingPersonal = Boolean(settings);
  const activeSettings = settings ?? defaults;

  /** 一键切换到某条记录：直接生效并关闭弹窗（无需再进「个人配置」页） */
  const switchToPreset = (preset: PersonalApiPreset) => {
    savePersonalApiSettings(preset.settings);
    onSave(preset.settings);
    onClose();
  };
  const removePreset = (id: string) => {
    const next = presets.filter((item) => item.id !== id);
    setPresets(next);
    savePersonalApiPresets(next);
  };
  const clearPersonal = () => {
    savePersonalApiSettings(null);
    onSave(null);
    onClose();
  };
  /** 把一份配置记进「我的接口」：按 baseUrl+model+key 去重，命中则更新 lastUsed 并置顶。
   *  name 为空时自动生成（来源标签 + 模型），用户无需手动命名。 */
  const recordUsage = (settings: PersonalApiSettings) => {
    const key = `${settings.baseUrl}|${settings.model}|${settings.apiKey}`;
    const name = autoName(settings);
    const existing = presets.find(
      (p) => `${p.settings.baseUrl}|${p.settings.model}|${p.settings.apiKey}` === key,
    );
    const entry: PersonalApiPreset = {
      id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: existing?.name || name,
      settings,
      lastUsed: Date.now(),
    };
    // 最近使用置顶（去重后的列表，最新在前）
    const next = [entry, ...presets.filter((p) => p.id !== entry.id)];
    setPresets(next);
    savePersonalApiPresets(next);
    return entry;
  };
  const saveAndUse = () => {
    const next = { ...form, baseUrl: form.baseUrl.trim().replace(/\/$/, "") };
    savePersonalApiSettings(next);
    recordUsage(next); // 自动记进「我的接口」，方便随时切回
    onSave(next);
    onClose();
  };
  /** 后端各字段的「值 + 来源」（由 /api/config 的 profileView 提供，前端不自行推断分层规则） */
  const backendField = (key: string) => profileView?.fields.find((field) => field.key === key);
  /** 使用中这套接口的尺寸表：按地址命中来源、按模型取档位 —— 价目表按来源分家，
   *  切到中转站就该显示中转站的价（见 apiCatalog.ts）。命中不了就不显示，不猜价。 */
  const activeCatalogProvider = findCatalogProvider(providers, activeSettings.baseUrl);
  const activeCatalogSizes = resolveSizes({
    providers,
    baseUrl: activeSettings.baseUrl,
    modelId: activeSettings.model,
  });
  /** 生效值：标签 → 值（等宽只用在真正要逐字核对的地址 / 路径 / Key 上）。
   *  来源只在**与主流来源不同**时才显示 —— 同一句「个人配置」重复四遍纯属噪音。 */
  const dominantSource = usingPersonal ? "个人配置" : (backendField("baseUrl")?.source ?? "");
  const activeRows = [
    { key: "接口地址", value: activeSettings.baseUrl, mono: true, source: usingPersonal ? "个人配置" : (backendField("baseUrl")?.source ?? "") },
    { key: "接口路径", value: activeSettings.apiPath, mono: true, source: usingPersonal ? "个人配置" : (backendField("apiPath")?.source ?? "") },
    { key: "模型", value: activeSettings.model, mono: false, source: usingPersonal ? "个人配置" : (backendField("model")?.source ?? "") },
    ...(activeCatalogSizes.length
      ? [
          {
            key: "尺寸单价",
            value: priceSummary(activeCatalogSizes),
            mono: false,
            // 价目表来自哪家：挪到下方「可选尺寸」标题里说，行内再标一次会撑宽这一行
            source: "",
          },
        ]
      : []),
    {
      key: "API Key",
      // 不写「（本机浏览器）」——顶部已经说过「仅本机浏览器」，同一件事说两遍
      value: usingPersonal
        ? (activeSettings.apiKey ? "已保存" : "未填写")
        : (backendField("apiKey")?.configured ? "已配置" : "未配置"),
      mono: false,
      source: usingPersonal ? "个人配置" : (backendField("apiKey")?.source ?? ""),
    },
  ];
  /** 服务来源预设：选定后自动带出接口地址 / 路径 / 模型，用户只需填 API Key。
   *  两个来源互斥：豆包 Seedream 走火山官方；其余 OpenAI 兼容服务走 wanwu 中转站。
   *  modelList 是该来源支持的模型（下拉框选项），首项为默认模型。 */
  const PROVIDERS: {
    id: string;
    label: string;
    baseUrl: string;
    apiPath: string;
    model: string;
    hint: string;
    modelList: { value: string; label: string; note: string }[];
  }[] = [
    {
      id: "doubao",
      label: "豆包 Seedream（火山方舟官方）",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiPath: "/images/generations",
      model: "doubao-seedream-5-0-pro-260628",
      hint: "填入火山方舟控制台获取的 ark- 开头 Key",
      // 豆包主流生图模型（火山方舟官方 ID，均经账号可用性核验）
      // 排在前面的是「建议用」：5.0 系列分辨率最全、支持 4K 之外的 1.5K 档；4.0 系列唯一可出 4K
      modelList: [
        { value: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 pro", note: "1K/1.5K/2K，画质最细腻，仅文生图/单图" },
        { value: "doubao-seedream-5-0-flash-260915", label: "Seedream 5.0 flash", note: "1K/1.5K/2K，更快更省，批量出图首选" },
        { value: "doubao-seedream-4-0-20260415", label: "Seedream 4.0（2026版）", note: "1K/2K/4K，要 4K 选它，仅 jpeg" },
        { value: "doubao-seedream-5-0-260128", label: "Seedream 5.0", note: "1K/1.5K/2K（退役中，建议换 5.0 pro）" },
        { value: "doubao-seedream-4-5-251128", label: "Seedream 4.5", note: "2K/4K，仅 jpeg（退役中，建议换 4.0 2026版）" },
        { value: "doubao-seedream-4-0-250828", label: "Seedream 4.0", note: "1K/2K/4K，仅 jpeg（退役中，建议换 4.0 2026版）" },
      ],
    },
    {
      id: "wanwu",
      label: "wanwu 中转站（OpenAI 兼容）",
      baseUrl: "https://2api.aiwanwu.cc",
      apiPath: "/v1/images/generations",
      model: "gpt-image-2.5-flare",
      hint: "填入中转站获取的 sk- 开头 Key",
      modelList: [
        { value: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", note: "1K/2K，中转站主力（已实测可用）" },
        { value: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", note: "1K/2K，中转站变体" },
        { value: "gpt‑image‑2", label: "GPT Image 2", note: "1K/2K，仅登记别名，调用会报错" },
        { value: "gpt‑image‑2.5", label: "GPT Image 2.5", note: "1K/2K，仅登记别名，调用会报错" },
      ],
    },
  ];
  /** 按 baseUrl 反推当前选中的来源（用户手改地址后可能对不上任何预设） */
  const matchProvider = (url: string) =>
    PROVIDERS.find((p) => url.trim().replace(/\/$/, "") === p.baseUrl)?.id ?? "";
  /** 来源展示名：命中预设用其 label，否则用域名（用户手填的自定义地址） */
  const providerLabelOf = (url: string) => {
    const hit = PROVIDERS.find((p) => url.trim().replace(/\/$/, "") === p.baseUrl);
    if (hit) return hit.label.replace(/（.*?）/g, "");
    try {
      return new URL(url).host;
    } catch {
      return url || "自定义接口";
    }
  };
  /** 自动命名：来源 + 模型（用户不填名字时用），便于在列表里一眼认出 */
  const autoName = (settings: PersonalApiSettings) =>
    [providerLabelOf(settings.baseUrl), settings.model].filter(Boolean).join(" · ");
  /** 接口主机（列表第二行用）：预设名里只有「来源标签」，主机名才能区分同标签的不同地址 */
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url || "—";
    }
  };
  /** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
  const formatRelativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚使用";
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    return `${Math.floor(hour / 24)} 天前`;
  };
  /** 当前来源的模型选项：命中预设用其内置清单（切换来源即切换模型列表）；
   *  未命中（自定义地址）则回退后端 /api/config 下发的 models。 */
  const currentModelChoices = () => {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (provider) return provider.modelList;
    return (models ?? []).map((m) => ({
      value: m.id,
      label: m.label,
      note: (m.note || "") + (m.output_formats?.length ? `，输出 ${m.output_formats.join("/")}` : ""),
    }));
  };
  /** 把模型清单转成 Select 选项：标签带「模型名 ｜ 能力说明」 */
  const modelOptionsFor = (list: { value: string; label: string; note?: string }[]) =>
    list.map((m) => ({ value: m.value, label: m.note ? `${m.label} ｜ ${m.note}` : m.label }));
  const [providerId, setProviderId] = useState(() => matchProvider(form.baseUrl));
  /** API Key 是否明文显示（默认密文，点小眼睛才露出） */
  const [showApiKey, setShowApiKey] = useState(false);
  /** 打开弹窗时是否带着「已保存的 Key」——用于给出提示，避免用户以为是占位符。
   *  只在来源与已保存配置一致时算「载入的」，换了来源后就不该再这么说。 */
  const loadedSavedKey =
    Boolean(settings?.apiKey) && form.apiKey === settings?.apiKey && form.baseUrl === settings?.baseUrl;
  /** 选来源：一键带出地址 / 路径 / 模型。
   *  Key 规则见 applyProviderToForm：换了来源就清空（两套 Key 不通用）。 */
  const applyProvider = (id: string) => {
    const provider = PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      setProviderId(id);
      return;
    }
    setForm((prev) => applyProviderToForm(prev, provider, providerId));
    if (providerId !== id) setShowApiKey(false);
    setProviderId(id);
  };

  /** 字段统一形态：label（.field-label）+ 控件（.field-control），与经典表单同源。
   *  标签只留最短的可辨认词（"图片接口路径" → "接口路径"），少占一行宽度、少一处换行。 */
  const fields: { id: string; label: string; key: "baseUrl" | "apiKey" | "model" | "apiPath"; mono?: boolean; type?: string; placeholder?: string }[] = [
    { id: "api-base-url", label: "接口地址", key: "baseUrl", placeholder: "https://api.example.com" },
    { id: "api-key", label: "API Key", key: "apiKey", mono: true, type: "password", placeholder: "sk-..." },
    { id: "api-model", label: "模型", key: "model" },
    { id: "api-path", label: "接口路径", key: "apiPath", mono: true },
  ];
  return (
    <ModalShell title="生图 API 设置" onClose={onClose} className="modal-panel--md api-settings-modal corner-rings">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-medium">生图 API 设置</h2>
          {/* 一处隐私说明就够（覆盖三个页签），不再在每个页签里重复 */}
          <span className="text-xs text-neutral-400">仅本机浏览器</span>
        </div>

        {/* 分段控件：看 / 改 / 管 各占一页（与顶栏模式切换同一套视觉，尺寸走 --h-ctl） */}
        <div className="tabs mb-4" role="tablist">
          {([["active", "使用中"], ["edit", "个人配置"], ["presets", "我的接口"]] as const).map(([id, label]) => (
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
            三页共用同一固定高度（见 index.css 的 .api-settings-modal .modal-body）：
            高度随页签变化会让弹窗「跳大小」、底部按钮跟着上下窜，所以这里不按内容自适应。 */}
        <div className="modal-body">
          {tab === "active" && (
            /* 整页撑满固定高度：规格清单在上，来源说明用 mt-auto 压到底部 ——
               内容少的时候留白集中在中间一段，不会出现"上面挤成一条、下面空一大片" */
            <div key="active" className="tab-panel flex h-full flex-col gap-2.5">
              {/* 生效状态一行说清。后端生效时把 profile 名并进这一行 ——
                  原来它在底部又占一行，和这句说的是同一件事 */}
              <p className="flex items-center gap-2 text-[13px] text-neutral-500">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    usingPersonal ? "bg-[var(--color-brand)]" : "bg-neutral-300"
                  }`}
                />
                {usingPersonal
                  ? "个人配置生效中"
                  : `后端配置生效中（${
                      profileView?.nameSource?.startsWith(".env") ? ".env" : "config.json"
                    }${profileView?.name ? ` · profile ${profileView.name}` : ""}）`}
              </p>

              <dl className="spec-list spec-list--roomy">
                {activeRows.map((row) => (
                  <div key={row.key} className="spec-list__row">
                    <dt className="spec-list__key">{row.key}</dt>
                    <dd className={`spec-list__val ${row.mono ? "spec-list__val--mono" : ""}`}>
                      <span className="flex items-baseline justify-end gap-2">
                        <span className="min-w-0 truncate">{row.value}</span>
                        {row.source && row.source !== dominantSource && (
                          <span className="shrink-0 text-[11px] text-neutral-400">{row.source}</span>
                        )}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              {/* 这台接口能出哪些尺寸：省得回主界面翻下拉。价目来自哪家也在这里交代 */}
              {activeCatalogSizes.length > 0 && (
                <div>
                  <p className="mb-1 text-[12px] text-neutral-400">
                    可选尺寸
                    {activeCatalogProvider && (
                      <span className="text-neutral-300"> · 价目来自 {activeCatalogProvider.label}</span>
                    )}
                  </p>
                  <div className="size-pills">
                    {activeCatalogSizes.map((s) => (
                      <span key={s.value} className="size-pill">{s.value}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto space-y-1.5">
                <p className="text-[12px] text-neutral-400">
                  获取 Key：
                  <a className="link ml-1" href="https://www.aiwanwu.cc/" target="_blank" rel="noreferrer">aiwanwu 中转站 ↗</a>
                  <span className="mx-1.5 text-neutral-300">·</span>
                  <a className="link" href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noreferrer">火山方舟控制台 ↗</a>
                </p>
              </div>
            </div>
          )}

          {tab === "edit" && (
            <div key="edit" className="tab-panel space-y-3">
              <div>
                {/* 「我的接口」按钮已去掉：顶部页签就是它，同一个入口没必要出现两次 */}
                <label className="field-label text-[13px]" htmlFor="api-provider">来源</label>
                <Select
                  id="api-provider"
                  className="mt-1"
                  options={[
                    { value: "", label: "请选择来源" },
                    ...PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
                  ]}
                  value={providerId}
                  onChange={applyProvider}
                />
              </div>

              {/* 来源提示不再单占一行：Key 为空时它就是 Key 字段的填写指引（见下方 helper）*/}

              {fields.map((field) => {
                // 来源选定后，地址 / 路径 / 模型由预设带出——Key 仍需用户填，故不禁用
                const autoFilled =
                  providerId !== "" && (field.key === "baseUrl" || field.key === "apiPath" || field.key === "model");
                // 模型名称：有模型清单时渲染为下拉框，避免手打错模型 ID
                const isModelField = field.key === "model";
                const isKeyField = field.key === "apiKey";
                const modelChoices = isModelField ? modelOptionsFor(currentModelChoices()) : [];
                return (
                  <div key={field.id}>
                    <label className="field-label text-[13px]" htmlFor={field.id}>{field.label}</label>
                    {modelChoices.length > 0 ? (
                      <Select
                        id={field.id}
                        className="mt-1"
                        options={[
                          // 当前值不在清单里时也保留一行（用户手填过自定义模型）
                          ...(modelChoices.some((m) => m.value === form.model)
                            ? []
                            : [{ value: form.model, label: form.model || "—" }]),
                          ...modelChoices,
                        ]}
                        value={form.model}
                        onChange={(model) => setForm({ ...form, model })}
                      />
                    ) : isKeyField ? (
                      // Key 字段：右侧挂小眼睛，按一下切换明文/密文
                      <div className="relative mt-1">
                        <input
                          id={field.id}
                          className={`field-control ${field.mono ? "font-mono" : ""} pr-9`}
                          type={showApiKey ? "text" : "password"}
                          value={form.apiKey}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                          {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                        />
                        <button
                          type="button"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                          aria-label={showApiKey ? "隐藏密钥" : "显示密钥"}
                          aria-pressed={showApiKey}
                          title={showApiKey ? "隐藏密钥" : "显示密钥"}
                          onClick={() => setShowApiKey((v) => !v)}
                        >
                          {showApiKey ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <path d="M6.61 6.61A18.15 18.15 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
                              <line x1="2" y1="2" x2="22" y2="22" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    ) : (
                      <input
                        id={field.id}
                        className={`field-control mt-1 ${field.mono ? "font-mono" : ""}`}
                        type={field.type ?? "text"}
                        value={form[field.key]}
                        readOnly={autoFilled}
                        onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                        {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                      />
                    )}
                    {/* Key 的填写指引就挂在这一行：来源的 Key 前缀提示（如 ark- / sk-）在
                        Key 为空时最有价值，单独占一行纯属浪费 */}
                    {isKeyField && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-400">
                        <span>
                          {form.apiKey
                            ? loadedSavedKey
                              ? "已载入本机保存的 Key"
                              : "已填入"
                            : (PROVIDERS.find((p) => p.id === providerId)?.hint ?? "请粘贴你的 API Key")}
                        </span>
                        {form.apiKey && (
                          <button
                            type="button"
                            className="shrink-0 underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--color-brand)]"
                            onClick={() => {
                              setForm({ ...form, apiKey: "" });
                              setShowApiKey(false);
                            }}
                          >
                            清空
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "presets" && (
            <div key="presets" className="tab-panel space-y-3">
              <p className="text-xs text-neutral-400">「切换」即时启用。</p>

              {presets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-8 text-center text-xs text-neutral-400">
                  还没有记录。到「个人配置」保存一次就会出现在这里。
                </p>
              ) : (
                <ul className="space-y-2">
                  {[...presets]
                    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
                    .map((preset) => {
                      const active =
                        settings != null &&
                        `${settings.baseUrl}|${settings.model}|${settings.apiKey}` ===
                          `${preset.settings.baseUrl}|${preset.settings.model}|${preset.settings.apiKey}`;
                      return (
                        <li
                          key={preset.id}
                          className={`rounded-xl border px-3 py-2 ${
                            active ? "border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5" : "border-neutral-200/80"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="truncate text-[13px] font-medium text-neutral-700">{preset.name}</span>
                              {active && (
                                <span className="shrink-0 rounded-full bg-[var(--color-brand)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-brand)]">
                                  使用中
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                className="btn-ghost btn-xs"
                                onClick={() => switchToPreset(preset)}
                              >
                                切换
                              </button>
                              <button type="button" className="btn-ghost btn-xs btn-danger" onClick={() => removePreset(preset.id)}>删除</button>
                            </span>
                          </div>
                          {/* 第二行只补名字里没有的：接口主机 + 最近使用时间。
                              名字本身已是「来源 · 模型」，再重复一遍纯属噪音 */}
                          <p className="mt-0.5 truncate text-xs text-neutral-400">
                            {hostOf(preset.settings.baseUrl)}
                            {preset.lastUsed ? ` · ${formatRelativeTime(preset.lastUsed)}` : ""}
                          </p>
                        </li>
                      );
                    })}
                </ul>
              )}
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
      </ModalShell>
  );
}


/** 顶部标题区：logo + 标题 + 窗口徽章 + 状态徽章（未配置 API Key / 自检问题 / 当前 profile·模型）+ 模式切换 + 新窗口按钮 */
function TitleBar({
  windowId,
  onNewWindow,
  mode,
  onModeChange,
  activeProfile,
  defaultModel,
  healthIssues,
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
  /** 启动自检问题（未配置 API Key / 前端未构建 / 输出不可写 / 自检失败）——状态徽章的数据源 */
  healthIssues: string[];
  onOpenApi: () => void;
  personalApi: PersonalApiSettings | null;
  /** 打开外观弹窗（主体色 / 我的壁纸 / 画布边界） */
  onOpenAppearance: () => void;
}) {
  /** 品牌区使用单层 Logo，悬停只改变高光与阴影，避免透视挤出造成重影。 */
  const brandRootRef = useRef<HTMLAnchorElement | null>(null);

  /* 状态徽章的取值顺序：没配 Key 时「模型 ID」这个槽位本身没有意义（生图根本不可用），
     于是直接改说原因，模型名让位；其余自检问题没有各自的入口，聚合在这个槽位里。 */
  const apiKeyMissing = healthIssues.some((issue) => issue.includes("未配置 API Key"));
  const otherIssues = healthIssues.filter((issue) => !issue.includes("未配置 API Key"));

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
      {apiKeyMissing ? (
        <button
          type="button"
          onClick={onOpenApi}
          className="chip chip--quiet profile-chip cursor-pointer transition-colors hover:text-brand"
          title="未配置 API Key，生图任务暂不可用 —— 点击配置"
        >
          未配置 API Key
        </button>
      ) : otherIssues.length > 0 ? (
        <span className="chip chip--quiet profile-chip" title={otherIssues.join("；")}>
          自检 {otherIssues.length} 项待处理
        </span>
      ) : activeProfile ? (
        <span
          className="chip chip--quiet profile-chip"
          title={`当前配置：profile「${activeProfile}」${defaultModel ? ` · 默认模型 ${defaultModel}` : ""}`}
        >
          {activeProfile}
          {defaultModel ? ` · ${defaultModel}` : ""}
        </span>
      ) : null}
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

  /** 铺在整页底下的那张图：只剩「我的壁纸」这一条来源（内置预设壁纸已移除）。
   *  按原图 cover 铺底 + 降噪滤镜，可读性处理全在 index.css 的 .imagora-wallpaper 一层里。 */
  const pageWallpaperUrl = wallpaperUrl;
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

/** 运行时 token 同样写到根元素：弹窗经 createPortal 挂在 body 上，落在 .imagora-app 之外，
 *  只写在 .imagora-app 内联样式里的话，弹窗内一律退化成 @theme 兜底值——表现为
 *  弹窗外是主题色、弹窗内却是石板灰 #475569，卡片表面与通透度也一并失效。
 *  .imagora-app 那份保留：它在首帧就生效，避免刷新时先闪一下兜底灰。两处取值同源，不会漂。 */
useEffect(() => {
  const root = document.documentElement.style;
  root.setProperty("--color-brand", accent.brand);
  root.setProperty("--color-brand-dark", accent.brandDark);
  root.setProperty("--surface-card", surface.card);
  root.setProperty("--surface-panel", surface.panel);
  root.setProperty("--field-bg", surface.field);
  root.setProperty("--surface-blur", surface.blur);
}, [accent.brand, accent.brandDark, surface.card, surface.panel, surface.field, surface.blur]);
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

  // 尺寸 / 质量下拉选项。尺寸表必须跟着「使用中的接口 + 模型」走：价目表按来源分家
  // （火山官方 0.2/0.3 元，中转站 0.05/0.1 元），沿用 default_profile 那张表就会出现
  // 「用着中转站的接口、显示豆包的价」，还会列出该模型不支持的档位。解析见 apiCatalog.ts。
  const providerCatalog = config?.providers;
  const activeApiBaseUrl = personalApi?.baseUrl ?? config?.baseUrl ?? "";
  const activeModelId = personalApi?.model || config?.defaultModel || "";
  const activeProvider = useMemo(
    () => findCatalogProvider(providerCatalog, activeApiBaseUrl),
    [providerCatalog, activeApiBaseUrl],
  );
  const activeSizes = useMemo(
    () =>
      resolveSizes({
        providers: providerCatalog,
        baseUrl: activeApiBaseUrl,
        modelId: activeModelId,
        // 兜底：自定义地址未在 config.json 登记时，沿用后端 profile 的尺寸表
        fallbackSizes: config?.sizes,
      }),
    [providerCatalog, activeApiBaseUrl, activeModelId, config],
  );
  const sizeOptions = useMemo(
    () => activeSizes.map((s) => ({ value: s.value, label: `${s.label}（${s.cost}元）` })),
    [activeSizes],
  );
  /** 质量档位对当前模型是否真的生效。
   *  豆包 Seedream 的图片接口没有 quality 参数（火山官方参数表里就没有），发了被静默忽略 ——
   *  三档出图完全一样，那就不该给用户一个骗人的选项：为真才渲染这一栏。
   *  中转站（GPT Image）认 quality，决定输出 token 数与耗时；按张计费所以不变贵。 */
  const qualityEffective = qualityAppliesTo(activeModelId, activeApiBaseUrl);
  const qualityOptions = useMemo(
    () => (config?.qualities ?? []).map((q) => ({ value: q, label: q })),
    [config],
  );

  /** 换了接口 / 模型 → 尺寸表整体换掉：旧尺寸不在新表里就落到首项，
   *  否则会把 A 家的尺寸（如 1728x2304）发给 B 家的模型，上游直接报错。 */
  useEffect(() => {
    if (activeSizes.length && !activeSizes.some((s) => s.value === size)) {
      setSize(activeSizes[0]!.value);
    }
  }, [activeSizes, size]);

  /** 生效配置：把「按使用中的 API 解析出的尺寸表 / 模型清单」并回 config，
   *  供画布等下游组件共用同一套价格口径（不必各自再写一份解析）。 */
  const effectiveConfig = useMemo<AppConfig | undefined>(() => {
    if (!config) return undefined;
    return {
      ...config,
      sizes: activeSizes.length ? activeSizes : config.sizes,
      // 命中来源才替换来源相关字段（exactOptionalPropertyTypes 下不能显式写 undefined）
      ...(activeProvider
        ? {
            models: activeProvider.models,
            profileLabel: activeProvider.label,
            activeProfile: activeProvider.name,
          }
        : {}),
    };
  }, [config, activeSizes, activeProvider]);

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
        activeProfile={activeProvider?.name ?? config?.activeProfile}
        defaultModel={activeModelId || config?.defaultModel}
        onOpenApi={() => setShowApiSettings(true)}
        personalApi={personalApi}
        healthIssues={visibleHealthIssues}
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
          models={config?.models}
          providers={providerCatalog}
          onSave={setPersonalApi}
          onClose={() => setShowApiSettings(false)}
        />
      )}

      {/* 无限画布：首次进入后保持挂载，切换模式仅显隐（内容保留，退出窗口才清空） */}
      {canvasMounted && effectiveConfig && (
        <div className={mode === "canvas" ? "block" : "hidden"}>
          <CanvasPage
            config={effectiveConfig}
            qualityEffective={qualityEffective}
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
              {/* 质量栏按当前模型显隐：豆包没有质量参数，留着只会让人以为能调 */}
              <div className={qualityEffective ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
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
                {qualityEffective && (
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
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                {qualityEffective
                  ? "low 最快最省 / medium 均衡 / high 最细（细节与文字更稳，只是更慢；按张计费，价格不变）"
                  : "豆包 Seedream 接口没有质量参数，这一栏已隐藏 —— 它出图不区分 low / medium / high"}
              </p>
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
