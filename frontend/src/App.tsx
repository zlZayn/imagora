import { useEffect, useMemo, useState } from "react";
import { generateImage, getConfig, openFolder } from "./api";
import type { AppConfig, ResultItem } from "./types";
import UploadZone from "./components/UploadZone";
import FolderPicker from "./components/FolderPicker";
import Gallery from "./components/Gallery";
import Select from "./components/Select";

/** 顶部标题区：SVG 叶子图标 + 标题 + 副标题 */
function TitleBar() {
  return (
    <header className="flex items-center gap-3 pb-4">
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3d7a5c"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
      <h1 className="text-xl font-semibold">A站生图工具</h1>
      <span className="ml-auto text-sm text-neutral-400">
        文生图 / 图生图 · 不传参考图即文生图 · 生成约需 1-2 分钟
      </span>
    </header>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("low");
  const [outputDir, setOutputDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setConfig(cfg);
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
    setBusy(true);
    setResults([]);
    setLogs(["生成中 ..."]);
    try {
      const res = await generateImage({ prompt, files, size, quality, outputDir });
      setResults(res.results);
      setLogs(res.messages);
    } catch (err) {
      setLogs([`请求失败: ${String(err)}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-4">
      <TitleBar />

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
                {busy ? "生成中 ..." : "生成图片"}
              </button>
              <button
                type="button"
                onClick={() => openFolder(outputDir)}
                disabled={busy}
                className="btn-ghost"
              >
                打开文件夹
              </button>
            </div>
            <div className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-neutral-500">
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
