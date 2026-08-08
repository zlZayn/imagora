import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  canvasImport,
  canvasListImages,
  canvasUpload,
  generateImage,
  selectFolder,
  workflowLoad,
  workflowSave,
} from "../api";
import { errMessage } from "../format";
import type {
  AppConfig,
  CanvasPromptNodeData,
  WorkflowNode,
} from "../types";
import {
  buildImageNode,
  canvasEntriesToNodes,
  computeRefCounts,
  snapshotIncomingAbsPaths,
  workflowToCanvas,
} from "../workflow";
import { ImageNode, PromptNode } from "./CanvasNodes";

/** 全部运行并发上限（单次生成 30-120s，防止打爆 API） */
const RUN_CONCURRENCY = 2;

interface CanvasPageProps {
  config: AppConfig;
}

export default function CanvasPage({ config }: CanvasPageProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [logs, setLogs] = useState<string[]>([]);
  /** 高亮核验：悬停/选中的提示词节点（高亮其入边与关联图片） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const runningRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeOptions = useMemo(
    () => config.sizes.map((s) => ({ value: s.value, label: `${s.label}（${s.cost}元）` })),
    [config],
  );
  const qualityOptions = useMemo(
    () => config.qualities.map((q) => ({ value: q, label: q })),
    [config],
  );

  /** 日志追加（画布内运行反馈） */
  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-50), line]);
  }, []);

  /* ---------------- 连线：类型硬约束（仅 图片 -> 提示词） ---------------- */
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      return source?.type === "image" && target?.type === "prompt";
    },
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges],
  );

  /* ---------------- 节点参数就地更新（PromptNode 上抛） ---------------- */
  const handleNodeUpdate = useCallback(
    (nodeId: string, patch: Partial<CanvasPromptNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && n.type === "prompt"
            ? { ...n, data: { ...n.data, ...patch } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  /* ---------------- 引用计数：由入边推导，随 edges 变化刷新 ---------------- */
  useEffect(() => {
    const counts = computeRefCounts(nodes, edges);
    setNodes((nds) =>
      nds.map((n) =>
        n.type === "image" && n.data.refCount !== (counts.get(n.data.registryId) ?? 0)
          ? { ...n, data: { ...n.data, refCount: counts.get(n.data.registryId) ?? 0 } }
          : n,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);

  /* ---------------- 高亮核验：hover/选中提示词节点 -> 入边加粗 + 图片描边 ---------------- */
  const applyHighlight = useCallback(
    (id: string | null) => {
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          className: id !== null && e.target === id ? "edge-highlight" : "",
        })),
      );
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "image") return n;
          const related = id !== null && edges.some((e) => e.source === n.id && e.target === id);
          return {
            ...n,
            className: related ? "node-related" : "",
          };
        }),
      );
    },
    [setEdges, setNodes, edges],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => setHighlightId(node.id),
    [],
  );
  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => setHighlightId(null), []);
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    const first = selected[0];
    setHighlightId(first && first.type === "prompt" ? first.id : null);
  }, []);
  useEffect(() => {
    applyHighlight(highlightId);
  }, [highlightId, applyHighlight]);

  /* ---------------- 工具栏：上传 / 导入目录 / 保存 / 加载 ---------------- */
  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const { images } = await canvasUpload(Array.from(files));
      setNodes((nds) => [...nds, ...canvasEntriesToNodes(images, nds)]);
      pushLog(`已上传 ${images.length} 张图片到画布`);
    } catch (err) {
      pushLog(`上传失败：${errMessage(err)}`);
    }
  };

  const handleImportDir = async () => {
    try {
      const { path } = await selectFolder(config.defaultOutputDir);
      if (!path) return;
      const { imported, skipped } = await canvasImport([path]);
      if (imported.length) {
        setNodes((nds) => [...nds, ...canvasEntriesToNodes(imported, nds)]);
      }
      pushLog(
        `导入目录 ${imported.length} 张${skipped.length ? `，跳过 ${skipped.length} 项` : ""}`,
      );
    } catch (err) {
      pushLog(`导入失败：${errMessage(err)}`);
    }
  };

  const handleSave = async () => {
    if (!nodes.length) {
      pushLog("画布为空，无需保存");
      return;
    }
    const name = window.prompt("工作流名称：", "未命名工作流");
    if (name === null) return;
    const path =
      window.prompt("保存路径（.json）：", `${config.defaultOutputDir}/workflows/${name}.json`) ?? "";
    try {
      await workflowSave({ path, name, nodes, edges });
      pushLog(`工作流已保存：${path}`);
    } catch (err) {
      pushLog(`保存失败：${errMessage(err)}`);
    }
  };

  const handleLoad = async () => {
    const path = window.prompt("加载路径（.json）：", "") ?? "";
    if (!path.trim()) return;
    try {
      const wf = await workflowLoad(path);
      const { nodes: loadedNodes, edges: loadedEdges } = workflowToCanvas(wf.nodes, wf.edges, wf.missing);
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      pushLog(
        `已加载 ${path}${wf.missing.length ? `，${wf.missing.length} 张图片缺失` : ""}`,
      );
    } catch (err) {
      pushLog(`加载失败：${errMessage(err)}`);
    }
  };

  /* ---------------- 运行编排：单节点（入边快照）+ 结果回流 + 全部运行（并发 2） ---------------- */
  const runNodeInternal = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== "prompt" || runningRef.current.has(nodeId)) return;
      const data = node.data;
      if (!data.prompt.trim()) {
        pushLog(`节点 ${nodeId}：请先输入提示词`);
        return;
      }
      // 运行快照：锁定入边参考图集合，运行期间画布编辑不影响本次
      const snapshot = snapshotIncomingAbsPaths(nodes, edges, nodeId);
      runningRef.current.add(nodeId);
      const startedAt = Date.now();
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId || n.type !== "prompt") return n;
          return { ...n, data: { ...n.data, status: "running" as const, elapsed: 0 } };
        }),
      );
      const timer = window.setInterval(() => {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId || n.type !== "prompt" || n.data.status !== "running") return n;
            return { ...n, data: { ...n.data, elapsed: Math.floor((Date.now() - startedAt) / 1000) } };
          }),
        );
      }, 1000);
      pushLog(`节点 ${nodeId} 开始生成，参考图：[${snapshot.length} 张]`);
      try {
        const res = await generateImage({
          prompt: data.prompt,
          refPaths: snapshot,
          files: [],
          size: data.size,
          quality: data.quality,
          outputDir: data.outputDir,
          win: 0,
        });
        // 结果回流：结果图复制进画布注册表并建节点（放在提示词节点右下方）
        const resultPaths = res.results
          .filter((r) => r.url)
          .map((r) => new URLSearchParams(r.url!.split("?")[1] ?? "").get("path") ?? "")
          .filter(Boolean);
        let resultCount = 0;
        if (resultPaths.length) {
          const { imported } = await canvasImport(resultPaths);
          resultCount = imported.length;
          setNodes((nds) => {
            const promptNode = nds.find((n) => n.id === nodeId);
            const baseX = (promptNode?.position.x ?? 40) + 340;
            const baseY = (promptNode?.position.y ?? 40) + 20;
            const created = imported.map((entry, i) =>
              buildImageNode(entry, { x: baseX, y: baseY + i * 130 }),
            );
            return [...nds, ...created];
          });
          pushLog(`节点 ${nodeId}：生成 ${resultCount} 张并已回流画布`);
        } else {
          pushLog(`节点 ${nodeId}：生成失败（无结果）`);
        }
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId || n.type !== "prompt") return n;
            return {
              ...n,
              data: {
                ...n.data,
                status: "done" as const,
                resultCount,
                message: undefined,
              },
            };
          }),
        );
      } catch (err) {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId || n.type !== "prompt") return n;
            return {
              ...n,
              data: {
                ...n.data,
                status: "failed" as const,
                message: errMessage(err),
              },
            };
          }),
        );
        pushLog(`节点 ${nodeId} 失败：${errMessage(err)}`);
      } finally {
        window.clearInterval(timer);
        runningRef.current.delete(nodeId);
      }
    },
    [nodes, edges, setNodes, pushLog],
  );

  const handleRun = useCallback(
    (nodeId: string) => {
      void runNodeInternal(nodeId);
    },
    [runNodeInternal],
  );

  const handleRunAll = useCallback(async () => {
    const promptNodes = nodes.filter((n) => n.type === "prompt");
    if (!promptNodes.length) {
      pushLog("画布上没有提示词节点");
      return;
    }
    setRunningAll(true);
    const queue = [...promptNodes.map((n) => n.id)];
    const workers = Array.from(
      { length: Math.min(RUN_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length) {
          const id = queue.shift()!;
          await runNodeInternal(id);
        }
      },
    );
    try {
      await Promise.all(workers);
      pushLog(`全部运行完成：${promptNodes.length} 个节点`);
    } finally {
      setRunningAll(false);
    }
  }, [nodes, runNodeInternal, pushLog]);

  /* ---------------- 双击空白：新建提示词节点 ---------------- */
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const rect = (event.target as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      const newNode: WorkflowNode = {
        id: `prompt-${Date.now()}`,
        type: "prompt",
        position: { x, y },
        data: {
          prompt: "",
          size: config.sizes[0]?.value ?? "1024x1024",
          quality: config.qualities[0] ?? "low",
          outputDir: config.defaultOutputDir,
          status: "idle",
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [config, setNodes],
  );

  /* ---------------- 挂载：列出已有画布图片 ---------------- */
  useEffect(() => {
    canvasListImages()
      .then(({ images }) => {
        if (images.length) {
          setNodes((nds) => [...canvasEntriesToNodes(images, nds), ...nds]);
        }
      })
      .catch(() => {
        // 画布图片加载失败不阻断使用
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 渲染 ---------------- */
  const nodeTypes = useMemo(
    () => ({
      image: ImageNode,
      prompt: (props: object) => (
        <PromptNode
          {...(props as React.ComponentProps<typeof PromptNode>)}
          onRun={handleRun}
          onUpdate={handleNodeUpdate}
          sizeOptions={sizeOptions}
          qualityOptions={qualityOptions}
        />
      ),
    }),
    [handleRun, handleNodeUpdate, sizeOptions, qualityOptions],
  );

  return (
    <div className="flex h-[calc(100vh-130px)] flex-col gap-2">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary !py-1 text-xs" onClick={() => fileInputRef.current?.click()}>
          上传图片
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => void handleImportDir()}>
          导入目录
        </button>
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => void handleSave()}>
          保存工作流
        </button>
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => void handleLoad()}>
          加载工作流
        </button>
        <button
          type="button"
          className="btn-ghost !py-1 text-xs"
          onClick={() => void handleRunAll()}
          disabled={runningAll}
        >
          {runningAll ? "运行中..." : "全部运行"}
        </button>
        <span className="text-muted text-xs">双击空白新建提示词节点 · 连线需从图片到提示词</span>
      </div>

      {/* 画布 */}
      <div className="panel-card min-h-0 flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          onPaneClick={(event) => {
            // v12 无 onPaneDoubleClick，用原生 detail===2 判定双击
            if (event.detail === 2) {
              onPaneDoubleClick(event);
            }
          }}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onSelectionChange={onSelectionChange}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls />
        </ReactFlow>
      </div>

      {/* 画布日志 */}
      <div className="log-box max-h-24 overflow-auto text-xs">
        {logs.map((line, i) => (
          <div key={i} className="log-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
