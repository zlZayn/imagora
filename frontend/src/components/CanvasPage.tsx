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
  canvasUpload,
  generateImage,
  workflowList,
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
  computeCounts,
  snapshotIncomingAbsPaths,
  updatePromptNode,
  workflowToCanvas,
} from "../workflow";
import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";
import { WorkflowLoadModal, WorkflowSaveModal, ZoomModal } from "./WorkflowModals";

/** 全部运行并发上限（单次生成 30-120s，防止打爆 API） */
const RUN_CONCURRENCY = 2;

/** 工具栏统一样式按钮 */
function ToolbarButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn-ghost !px-3 !py-1 text-xs ${disabled ? "opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}

interface CanvasPageProps {
  config: AppConfig;
}

export default function CanvasPage({ config }: CanvasPageProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  /** 画布容器引用：把实时 zoom 写入 --canvas-zoom CSS 变量（连接点绝对大小用） */
  const canvasRef = useRef<HTMLDivElement>(null);
  const setCanvasZoom = useCallback((zoom: number) => {
    canvasRef.current?.style.setProperty("--canvas-zoom", String(zoom));
  }, []);
  /** 节点/边的最新引用：回调经 ref 读取，避免 useCallback 依赖 nodes/edges
   *  导致 nodeTypes 每次拖拽重建 -> 全节点重渲染闪烁 */
  const nodesRef = useRef<WorkflowNode[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const [logs, setLogs] = useState<string[]>([]);
  /** 高亮核验：悬停/选中的提示词节点（高亮其入边与关联图片） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 当前选中的节点数（Shift 框选多选后显示批量删除） */
  const [selectedCount, setSelectedCount] = useState(0);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const runningRef = useRef<Set<string>>(new Set());
  /** 放大预览：当前预览的图片绝对路径（null 关闭）与文件名 */
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomName, setZoomName] = useState("");
  /** 保存/加载工作流弹窗 */
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [workflows, setWorkflows] = useState<{ name: string; modified: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 替换图片：待替换的目标节点 + 专用文件选择 */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const pendingReplaceRef = useRef<string | null>(null);

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

  /* ---------------- 连线：类型硬约束（图片 -> 提示词 | 图片组；图片组 -> 提示词；提示词 -> 图片[产出]） ---------------- */
  const isValidConnection: IsValidConnection = useCallback((connection) => {
    const source = nodesRef.current.find((n) => n.id === connection.source);
    const target = nodesRef.current.find((n) => n.id === connection.target);
    if (source?.type === "image") {
      return target?.type === "prompt" || target?.type === "group";
    }
    if (source?.type === "group") {
      return target?.type === "prompt";
    }
    // 产出边：提示词节点连到结果图片（生成结果自动连线，也可手动拖）
    if (source?.type === "prompt") {
      return target?.type === "image";
    }
    return false;
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges],
  );

  /* ---------------- 节点参数就地更新（PromptNode 上抛） ---------------- */
  const handleNodeUpdate = useCallback(
    (nodeId: string, patch: Partial<CanvasPromptNodeData>) => {
      setNodes((nds) => updatePromptNode(nds, nodeId, patch));
    },
    [setNodes],
  );

  /* ---------------- 引用计数 / 分组计数：由连线推导，随 edges 变化刷新 ---------------- */
  useEffect(() => {
    const { refCounts, groupCounts, groupSizes } = computeCounts(nodes, edges);
    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        if (n.type === "image") {
          const count = refCounts.get(n.data.registryId) ?? 0;
          if (n.data.refCount !== count) {
            changed = true;
            return { ...n, data: { ...n.data, refCount: count } };
          }
        }
        if (n.type === "group") {
          const count = groupCounts.get(n.id) ?? 0;
          const size = groupSizes.get(n.id) ?? 0;
          if (n.data.imageCount !== count || n.data.totalSize !== size) {
            changed = true;
            return { ...n, data: { ...n.data, imageCount: count, totalSize: size } };
          }
        }
        return n;
      });
      return changed ? next : nds;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);

  /* ---------------- 高亮核验：hover/选中提示词节点 -> 入边加粗 + 图片描边 ---------------- */
  // 注意：setEdges/setNodes 必须条件更新（className 无变化返回原引用），
  // 否则 effect 依赖 edges 变化 -> 无条件新数组 -> 无限更新循环（React #185）。
  const applyHighlight = useCallback(
    (id: string | null, currentEdges: Edge[]) => {
      const target = id;
      setEdges((eds) => {
        let changed = false;
        const next = eds.map((e) => {
          const cls = target !== null && e.target === target ? "edge-highlight" : "";
          if (e.className !== cls) changed = true;
          return e.className === cls ? e : { ...e, className: cls };
        });
        return changed ? next : eds;
      });
      setNodes((nds) => {
        let changed = false;
        const next = nds.map((n) => {
          if (n.type !== "image") return n;
          const related = target !== null && currentEdges.some((e) => e.source === n.id && e.target === target);
          const cls = related ? "node-related" : "";
          if (n.className !== cls) changed = true;
          return n.className === cls ? n : { ...n, className: cls };
        });
        return changed ? next : nds;
      });
    },
    [setEdges, setNodes],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => setHighlightId(node.id),
    [],
  );
  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => setHighlightId(null), []);
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    selectedIdsRef.current = new Set(selected.map((n) => n.id));
    setSelectedCount(selected.length);
    const first = selected[0];
    setHighlightId(selected.length === 1 && first.type === "prompt" ? first.id : null);
  }, []);
  useEffect(() => {
    applyHighlight(highlightId, edges);
  }, [highlightId, edges, applyHighlight]);

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

  const handleSave = async () => {
    if (!nodes.length) {
      pushLog("画布为空，无需保存");
      return;
    }
    try {
      const { workflows: list } = await workflowList();
      setWorkflows(list);
      setSaveName("");
      setShowSaveModal(true);
    } catch (err) {
      pushLog(`保存准备失败：${errMessage(err)}`);
    }
  };

  /** 确认保存：同名覆盖需确认 */
  const confirmSave = async () => {
    const name = saveName.trim();
    if (!name) {
      pushLog("请输入工作流名字");
      return;
    }
    if (workflows.some((w) => w.name === name)) {
      if (!window.confirm(`工作流「${name}」已存在，覆盖？`)) return;
    }
    try {
      const { path } = await workflowSave({ name, nodes, edges });
      setShowSaveModal(false);
      pushLog(`工作流已保存：${path}`);
    } catch (err) {
      pushLog(`保存失败：${errMessage(err)}`);
    }
  };

  const handleLoad = async () => {
    try {
      const { workflows: list } = await workflowList();
      if (!list.length) {
        pushLog("没有已保存的工作流");
        return;
      }
      setWorkflows(list);
      setShowLoadModal(true);
    } catch (err) {
      pushLog(`加载准备失败：${errMessage(err)}`);
    }
  };

  /** 按名加载工作流并重建画布（位置/连线/参数全还原，运行状态重置） */
  const loadByName = async (name: string) => {
    try {
      const wf = await workflowLoad(name);
      const { nodes: loadedNodes, edges: loadedEdges } = workflowToCanvas(wf.nodes, wf.edges, wf.missing);
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      setShowLoadModal(false);
      pushLog(`已加载「${name}」${wf.missing.length ? `，${wf.missing.length} 张图片缺失` : ""}`);
    } catch (err) {
      pushLog(`加载失败：${errMessage(err)}`);
    }
  };

  /* ---------------- 节点替换 / 删除 ---------------- */
  /** 图片替换：记录目标节点并打开文件选择器 */
  const handleReplaceImage = useCallback((nodeId: string) => {
    pendingReplaceRef.current = nodeId;
    replaceInputRef.current?.click();
  }, []);

  /** 替换文件落地：上传新图并更新该图片节点数据（旧文件保留，避免破坏其他引用/已存工作流） */
  const handleReplaceFile = useCallback(
    async (files: FileList | null) => {
      const nodeId = pendingReplaceRef.current;
      pendingReplaceRef.current = null;
      if (!nodeId || !files?.length) return;
      try {
        const { images } = await canvasUpload(Array.from(files).slice(0, 1));
        if (!images.length) {
          pushLog("替换失败：上传未返回图片");
          return;
        }
        const entry = images[0];
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId || n.type !== "image") return n;
            return {
              ...n,
              data: {
                ...n.data,
                registryId: entry.id,
                name: entry.name,
                url: `/api/image?path=${encodeURIComponent(entry.absPath)}`,
                size: entry.size,
                ext: entry.ext,
                absPath: entry.absPath,
                missing: false,
              },
            };
          }),
        );
        pushLog(`已替换图片：${entry.name}`);
      } catch (err) {
        pushLog(`替换失败：${errMessage(err)}`);
      }
    },
    [setNodes, pushLog],
  );

  /** 删除节点：仅移除节点与其所有连线（不删文件，删除文件是显式操作） */
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      pushLog("已删除节点（文件保留）");
    },
    [setNodes, setEdges, pushLog],
  );

  /* ---------------- 图片双击动作：放大预览 ---------------- */
  const handleZoom = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (node?.type === "image") {
      setZoomImage(node.data.absPath);
      setZoomName(node.data.name);
    }
  }, []);

  /** 默认质量：优先 high（用户要求） */
  const defaultQuality = config.qualities.includes("high") ? "high" : config.qualities[0] ?? "low";

  /** 工具栏按钮：新建提示词卡片 */
  const handleCreatePrompt = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: `prompt-${Date.now()}`,
        type: "prompt" as const,
        position: { x: 160 + (nds.length % 6) * 26, y: 100 + (nds.length % 4) * 26 },
        data: {
          prompt: "",
          size: config.sizes[0]?.value ?? "1024x1024",
          quality: defaultQuality,
          outputDir: config.defaultOutputDir,
          status: "idle" as const,
        },
      },
    ]);
    pushLog("已新建提示词卡片");
  }, [config, defaultQuality, setNodes, pushLog]);

  /** 新建图片组节点（聚合多图后连到提示词统一管理） */
  const handleCreateGroup = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: `group-${Date.now()}`,
        type: "group" as const,
        position: { x: 280 + (nds.length % 6) * 30, y: 260 + (nds.length % 4) * 30 },
        data: { name: "图片组", imageCount: 0, totalSize: 0 },
      },
    ]);
    pushLog("已新建图片组，把图片连进来即可");
  }, [setNodes, pushLog]);

  /** 批量删除：移除所有选中节点及其连线（文件保留） */
  const handleDeleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedCount(0);
    selectedIdsRef.current = new Set();
    pushLog(`已删除 ${ids.size} 个选中节点（文件保留）`);
  }, [setNodes, setEdges, pushLog]);

  /* ---------------- 运行编排：单节点（入边快照）+ 结果回流 + 全部运行（并发 2） ---------------- */
  const runNodeInternal = useCallback(
    async (nodeId: string) => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
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
      setNodes((nds) => updatePromptNode(nds, nodeId, { status: "running", elapsed: 0 }));
      const timer = window.setInterval(() => {
        setNodes((nds) => {
          const now = Math.floor((Date.now() - startedAt) / 1000);
          return updatePromptNode(nds, nodeId, { elapsed: now });
        });
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
          const resultIds: string[] = [];
          setNodes((nds) => {
            const promptNode = nds.find((n) => n.id === nodeId);
            const baseX = (promptNode?.position.x ?? 40) + 340;
            const baseY = (promptNode?.position.y ?? 40) + 20;
            const created = imported.map((entry, i) => {
              resultIds.push(`img-${entry.id}`);
              return buildImageNode(entry, { x: baseX, y: baseY + i * 130 });
            });
            return [...nds, ...created];
          });
          // 结果图自动连线：提示词节点 -> 结果图片（产出边，右边出线）
          setEdges((eds) => [
            ...eds,
            ...resultIds.map((targetId) => ({
              id: `${nodeId}->${targetId}`,
              source: nodeId,
              target: targetId,
            })),
          ]);
          pushLog(`节点 ${nodeId}：生成 ${resultCount} 张并已回流画布（自动连线）`);
        } else {
          pushLog(`节点 ${nodeId}：生成失败（无结果）`);
        }
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "done", resultCount, message: undefined }));
      } catch (err) {
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "failed", message: errMessage(err) }));
        pushLog(`节点 ${nodeId} 失败：${errMessage(err)}`);
      } finally {
        window.clearInterval(timer);
        runningRef.current.delete(nodeId);
      }
    },
    [setNodes, pushLog],
  );

  const handleRun = useCallback(
    (nodeId: string) => {
      void runNodeInternal(nodeId);
    },
    [runNodeInternal],
  );

  const handleRunAll = useCallback(async () => {
    const all = nodesRef.current.filter((n) => n.type === "prompt");
    // 跳过正在运行的节点（不重复启动），只运行未在运行的
    const queue = all.map((n) => n.id).filter((id) => !runningRef.current.has(id));
    if (!queue.length) {
      pushLog(
        all.length ? "全部节点已在运行中" : "画布上没有提示词节点",
      );
      return;
    }
    setRunningAll(true);
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
      pushLog(`全部运行完成：${queue.length} 个节点`);
    } finally {
      setRunningAll(false);
    }
  }, [runNodeInternal, pushLog]);

  /* ---------------- 渲染 ---------------- */
  const nodeTypes = useMemo(
    () => ({
      image: (props: object) => (
        <ImageNode
          {...(props as React.ComponentProps<typeof ImageNode>)}
          onReplace={handleReplaceImage}
          onDelete={handleDeleteNode}
          onZoom={handleZoom}
        />
      ),
      group: (props: object) => (
        <GroupNode
          {...(props as React.ComponentProps<typeof GroupNode>)}
          onDelete={handleDeleteNode}
        />
      ),
      prompt: (props: object) => (
        <PromptNode
          {...(props as React.ComponentProps<typeof PromptNode>)}
          onRun={handleRun}
          onUpdate={handleNodeUpdate}
          onDelete={handleDeleteNode}
          sizeOptions={sizeOptions}
          qualityOptions={qualityOptions}
        />
      ),
    }),
    [
      handleRun,
      handleNodeUpdate,
      handleDeleteNode,
      handleReplaceImage,
      handleZoom,
      sizeOptions,
      qualityOptions,
    ],
  );

  return (
    <div className="flex h-[calc(100vh-130px)] flex-col gap-2">
      {/* 工具栏：左侧节点创建，右侧工作流操作（按使用习惯分区） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary !px-3 !py-1 text-xs" onClick={() => fileInputRef.current?.click()}>
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
          {/* 图片节点「替换」用的隐藏文件选择（单张） */}
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleReplaceFile(e.target.files);
              e.target.value = "";
            }}
          />
          <ToolbarButton onClick={handleCreatePrompt}>新建提示词卡片</ToolbarButton>
          <ToolbarButton onClick={handleCreateGroup}>新建图片组</ToolbarButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton onClick={() => void handleSave()}>保存工作流</ToolbarButton>
          <ToolbarButton onClick={() => void handleLoad()}>加载工作流</ToolbarButton>
          <ToolbarButton onClick={() => void handleRunAll()} disabled={runningAll}>
            {runningAll ? "运行中..." : "全部运行"}
          </ToolbarButton>
        </div>
      </div>
      {/* 操作帮助：一行小字，不占位置 */}
      <div className="text-[10px] leading-tight text-neutral-400">
        Shift+拖拽框选多选 · 滚轮缩放 · 空白处拖拽平移 · 连接规则：图片→提示词或图片组、图片组→提示词、提示词→图片（生成结果）
      </div>

      {/* 画布 */}
      <div className="panel-card relative min-h-0 flex-1 overflow-hidden">
        {/* 多选批量删除（Shift+框选后显示，沿用右上角小按钮风格） */}
        {selectedCount >= 2 && (
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="nodrag btn-ghost absolute right-3 top-3 z-40 !border-red-200 !bg-white/95 !px-2 !py-1 text-xs text-red-500 shadow"
          >
            删除所选 ({selectedCount})
          </button>
        )}
        <div ref={canvasRef} className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onSelectionChange={onSelectionChange}
          onMove={(_event, viewport) => setCanvasZoom(viewport.zoom)}
          onInit={(instance) => setCanvasZoom(instance.getViewport().zoom)}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls />
        </ReactFlow>
        </div>
      </div>

      {/* 画布日志 */}
      <div className="log-box max-h-24 overflow-auto text-xs">
        {logs.map((line, i) => (
          <div key={i} className="log-line">
            {line}
          </div>
        ))}
      </div>

      {/* 保存 / 加载 / 放大预览 弹窗（独立展示组件，交互经回调上抛） */}
      {showSaveModal && (
        <WorkflowSaveModal
          saveName={saveName}
          onSaveNameChange={setSaveName}
          workflows={workflows}
          onPickName={setSaveName}
          onConfirm={() => void confirmSave()}
          onClose={() => setShowSaveModal(false)}
        />
      )}
      {showLoadModal && (
        <WorkflowLoadModal
          workflows={workflows}
          onLoad={(name) => void loadByName(name)}
          onClose={() => setShowLoadModal(false)}
        />
      )}
      {zoomImage && (
        <ZoomModal imagePath={zoomImage} name={zoomName} onClose={() => setZoomImage(null)} />
      )}
    </div>
  );
}
