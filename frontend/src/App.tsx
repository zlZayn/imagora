import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getConfig, getHealthDetails, openFolder, readPersonalApiPresets, readPersonalApiSettings, rememberOutputDir, savePersonalApiPresets, savePersonalApiSettings } from "./api";
import { useGenerationTask } from "./useGenerationTask";
import { accentForWindow } from "./accent";
import type { AppConfig, ConfigProfileView, GenerationTaskStatus, PersonalApiPreset, PersonalApiSettings, RefItem, ResultItem } from "./types";
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

/** 个人 API 设置弹窗。
 *  默认值全部来自 /api/config（后端配置中心）——前端不硬编码中转站 / 模型 / 接口路径，
 *  改 config.json 即全局生效（唯一真相源）；用户填过则用用户自己的配置覆盖。 */
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

/** 顶栏品牌区 3D 挤出参数（借 React Bits DepthText 手法）：
 *  logo 与标题各自正面/深度配色，越深的层越接近深度色（progress^2 缓动 + color-mix）；
 *  logo 正面跟随窗口主题色（var(--color-brand)），标题正面沿用 body 文字色，均不硬编码。 */
const BRAND_LAYERS = 10; // 挤出层数（越小越省 DOM，也越浅）
/* 层间距分两档：标题字面大，1.5px/层（10 层 ≈15px 厚度）撑得起立体感；
 * logo 图标线条细，同深度会被挤成"红块"（细节糊掉）——压到 0.4px/层（≈4px），
 * 靠层内反向 translateZ 补偿让两者在同一层里各走各的深度（见下方 svg 的 transform）。 */
const TEXT_Z_STEP = 1.5;
const LOGO_Z_STEP = 0.4;
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
  onOpenApi,
  personalApi,
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
}) {
  /** 品牌区（logo + 标题整体）3D 指针跟随：借 React Bits DepthText 手法——
   *  10 层挤出堆叠（见 BRAND_LAYERS / TEXT_Z_STEP + .brand-swing__layer 样式）常驻 DOM，
   *  但平面态整层透明（is-tilting 才淡入，见 index.css）：透视会让后台层边缘露出约 1px，
   *  正面浅色与挤出深色的反差会变成肉眼可见的重影。
   *  鼠标接近时向光标方向倾斜，挤出厚度随摆动显现、移动时平滑跟随、离开回摆到位后撤掉类。
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
      // 已回到静止位且不在悬停：撤掉 is-tilting（挤出层淡出、平面态零重影）并停循环（省电）
      if (!hovering && Math.abs(current.x - target.x) < 0.01 && Math.abs(current.y - target.y) < 0.01) {
        stage.classList.remove("is-tilting");
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
      stage.classList.add("is-tilting");
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
      stage.classList.remove("is-tilting");
    };
  }, []);

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
        <div ref={brandStageRef} className="brand-swing__stage">
          {brandLayers.map((index) => (
            <span
              key={index}
              className="brand-swing__layer"
              style={{ transform: `translateZ(${-index * TEXT_Z_STEP}px)` }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 1024 1024"
                aria-hidden="true"
                style={{
                  fill: brandLayerColor(LOGO_FACE, LOGO_DEPTH, index),
                  /* 反向补偿：抵消标题那档深度差 → 图标只按 LOGO_Z_STEP 后退，细节不被挤糊 */
                  transform: `translateZ(${index * (TEXT_Z_STEP - LOGO_Z_STEP)}px)`,
                }}
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
      {windowId !== null && <span className="chip chip--brand">窗口 #{windowId}</span>}
      {activeProfile && (
        <span
          className="chip chip--quiet"
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
      <span className="text-muted ml-auto hidden text-xs xl:block">
        文生图 / 图生图 · 不传参考图即文生图 · 生成约需 1-2 分钟
      </span>
      <button type="button" onClick={onNewWindow} className="btn-ghost">
        ＋ 新窗口
      </button>
      <button type="button" onClick={onOpenApi} className={`api-settings-trigger btn-ghost ${personalApi ? "is-active" : ""}`}>
        {personalApi ? "个人 API 已启用" : "生图 API"}
      </button>
      {/* 右下镜像小字：与左栏/右栏眉标同一套排版（.eyebrow 家族），最低对比度 */}
      <span className="corner-note">Image Workspace</span>
    </header>
  );
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [personalApi, setPersonalApi] = useState<PersonalApiSettings | null>(() => readPersonalApiSettings());
  const [showApiSettings, setShowApiSettings] = useState(false);

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

  const accent = accentForWindow(windowId);

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
      style={{ "--color-brand": accent.brand, "--color-brand-dark": accent.brandDark } as CSSProperties}
    >
      <TitleBar
        windowId={windowId}
        onNewWindow={handleNewWindow}
        mode={mode}
        onModeChange={switchMode}
        activeProfile={config?.activeProfile}
        defaultModel={config?.defaultModel}
        onOpenApi={() => setShowApiSettings(true)}
        personalApi={personalApi}
      />
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
        {/* 左栏：输入面板。两个水印都长在卡片内（左上分区词 + 右上编号，同一个裁切层）——
            这样它们随卡片动画一起进退，且始终在内容层之下，不会叠到输入框上。 */}
        <section className="classic-input-column">
          <div className="space-y-4">
            <div className="panel-card corner-deco enter-up space-y-3">
              <span className="corner-deco__clip" aria-hidden="true">
                <span className="corner-deco__tag">Input</span>
                <span className="corner-deco__step">1</span>
              </span>
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

            <div className="panel-card corner-deco enter-up enter-delay-1 relative z-30">
              <span className="corner-deco__clip" aria-hidden="true">
                <span className="corner-deco__step">2</span>
              </span>
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

            <div className="panel-card corner-deco enter-up enter-delay-2 space-y-3">
              <span className="corner-deco__clip" aria-hidden="true">
                <span className="corner-deco__step">3</span>
              </span>
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

        {/* 右栏：结果画廊（分区词 + 弧环都长在面板内，与左栏同一套角落装饰） */}
        <section className="classic-output-column">
          <section className="classic-result-panel corner-rings corner-deco panel-card enter-up enter-delay-3 min-h-[560px]">
            <span className="corner-deco__clip" aria-hidden="true">
              <span className="corner-deco__tag">Output</span>
            </span>
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
        </section>
      </main>
    </div>
  );
}
