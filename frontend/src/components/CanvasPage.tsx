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
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  canvasUpload,
  generateImage,
  historyCanvasImport,
  workflowList,
  workflowLoad,
  workflowSave,
} from "../api";
import { createCanvasHistory } from "../canvasHistory";
import { errMessage } from "../format";
import {
  createGenerationQueue,
  type GenerationQueue,
  type GenerationRunContext,
  type GenerationTaskSnapshot,
} from "../generationQueue";
import { useCanvasRecovery } from "../useCanvasRecovery";
import type {
  AppConfig,
  CanvasPromptNodeData,
  WorkflowEdge,
  WorkflowNode,
} from "../types";
import {
  autoConnect,
  autoLayout,
  buildImageNode,
  canvasEntriesToNodes,
  computeCounts,
  extractAnimClasses,
  snapshotIncomingAbsPaths,
  updatePromptNode,
  withEnterAnim,
  workflowToCanvas,
} from "../workflow";
import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";
import HistoryGallery from "./HistoryGallery";
import TaskCenter from "./TaskCenter";
import { WorkflowLoadModal, WorkflowSaveModal, ZoomModal } from "./WorkflowModals";

/** 全部运行并发上限（单次生成 30-120s，防止打爆 API） */
const RUN_CONCURRENCY = 2;

/** 节点删除退场动画时长（与 .node-exiting 的 fade-out 0.2s 一致） */
const FADE_DURATION = 200;

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

/** 画布右下角日志轮播：只露最新几条，新条目淡入上移，旧的自然被挤出去。
 *  pointer-events-none 保证不挡画布拖拽。 */
const LOG_VISIBLE_COUNT = 5;
function CanvasLog({ logs }: { logs: { id: number; text: string }[] }) {
  const recent = logs.slice(-LOG_VISIBLE_COUNT);
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 flex max-w-xs flex-col items-end gap-0.5">
      {recent.map((log) => (
        <div
          key={log.id}
          className="log-toast text-[11px] font-medium leading-relaxed text-brand/80 [text-shadow:0_1px_3px_rgb(255_255_255_/_0.95)]"
        >
          {log.text}
        </div>
      ))}
    </div>
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
  /** React Flow 实例引用：自动布局后调 fitView 自适应居中 */
  const rfInstanceRef = useRef<ReactFlowInstance<WorkflowNode, Edge> | null>(null);
  const setCanvasZoom = useCallback((zoom: number) => {
    canvasRef.current?.style.setProperty("--canvas-zoom", String(zoom));
  }, []);
  /** 节点/边的最新引用：回调经 ref 读取，避免 useCallback 依赖 nodes/edges
   *  导致 nodeTypes 每次拖拽重建 -> 全节点重渲染闪烁 */
  const nodesRef = useRef<WorkflowNode[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const [logs, setLogs] = useState<{ id: number; text: string }[]>([]);
  /** 日志自增 id：稳定 key 触发轮播入场动画（index 复用会原地改文字不触发） */
  const logIdRef = useRef(0);
  /** 高亮核验：悬停/选中的提示词节点（高亮其入边与关联图片） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 当前选中的节点数（Shift 框选多选后显示批量删除） */
  const [selectedCount, setSelectedCount] = useState(0);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<GenerationQueue | null>(null);
  const historyRef = useRef(createCanvasHistory());
  const [, setHistoryVersion] = useState(0);
  const [queueTasks, setQueueTasks] = useState<GenerationTaskSnapshot[]>([]);
  const runningAll = queueTasks.some((task) => task.status === "queued" || task.status === "running");
  /** 放大预览：当前预览的图片绝对路径（null 关闭）与文件名 */
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomName, setZoomName] = useState("");
  /** 保存/加载工作流弹窗 */
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [workflows, setWorkflows] = useState<{ name: string; modified: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 替换图片：待替换的目标节点 + 专用文件选择 */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const pendingReplaceRef = useRef<string | null>(null);

  /** 待真正移除的节点 id -> 定时器（退场动画播完后再删；撤销/重做/卸载需清理） */
  const pendingRemovalRef = useRef<Map<string, number>>(new Map());

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
    setLogs((prev) => [...prev.slice(-50), { id: ++logIdRef.current, text: line }]);
  }, []);

  const refreshHistoryControls = useCallback(() => setHistoryVersion((version) => version + 1), []);
  const recordHistory = useCallback(() => {
    historyRef.current.record({ nodes: nodesRef.current, edges: edgesRef.current });
    refreshHistoryControls();
  }, [refreshHistoryControls]);

  const cancelAllTasks = useCallback(() => {
    const queue = queueRef.current;
    queue?.getSnapshot()
      .filter((task) => task.status === "queued" || task.status === "running")
      .forEach((task) => queue.cancel(task.id));
  }, []);

  const restoreCanvas = useCallback(
    (restoredNodes: WorkflowNode[], restoredEdges: WorkflowEdge[]) => {
      historyRef.current.clear();
      setNodes(restoredNodes);
      setEdges(restoredEdges);
      refreshHistoryControls();
    },
    [refreshHistoryControls, setEdges, setNodes],
  );

  useCanvasRecovery({
    nodes,
    edges,
    onRestore: restoreCanvas,
    onLog: pushLog,
  });

  /* 卸载时清理未到期的删除动画定时器，避免卸载后 setState 泄漏 */
  useEffect(() => {
    const pending = pendingRemovalRef.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  /* ---------------- 连线：类型硬约束（图片 -> 提示词 | 图片组；图片组 -> 提示词；提示词 -> 图片[产出]） ----------------
   * 提示词节点顶部 target 仅允许一条入边：多图请经「图片组」聚合后连入。 */
  const isValidConnection: IsValidConnection = useCallback((connection) => {
    const source = nodesRef.current.find((n) => n.id === connection.source);
    const target = nodesRef.current.find((n) => n.id === connection.target);
    if (source?.type === "image") {
      if (target?.type !== "prompt" && target?.type !== "group") return false;
      if (target?.type === "prompt" && edgesRef.current.some((e) => e.target === connection.target)) {
        return false;
      }
      return true;
    }
    if (source?.type === "group") {
      if (target?.type !== "prompt") return false;
      if (edgesRef.current.some((e) => e.target === connection.target)) return false;
      return true;
    }
    // 产出边：提示词节点连到结果图片（生成结果自动连线，也可手动拖）
    if (source?.type === "prompt") {
      return target?.type === "image";
    }
    return false;
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      recordHistory();
      setEdges((eds) => addEdge(connection, eds));
    },
    [recordHistory, setEdges],
  );

  const handleEdgeDoubleClick = useCallback(
    (edge: Edge) => {
      if (!edgesRef.current.some((item) => item.id === edge.id)) return;
      recordHistory();
      setEdges((current) => current.filter((item) => item.id !== edge.id));
      pushLog("已删除连线");
    },
    [pushLog, recordHistory, setEdges],
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
          // 保留动画类（node-enter/node-exiting/enter-delay-N），只切换高亮类
          const cls = [extractAnimClasses(n.className), related ? "node-related" : ""]
            .filter(Boolean)
            .join(" ") || undefined;
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
      recordHistory();
      setNodes((nds) => [...nds, ...canvasEntriesToNodes(images, nds).map((n, i) => withEnterAnim(n, i))]);
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
      cancelAllTasks();
      const wf = await workflowLoad(name);
      const { nodes: loadedNodes, edges: loadedEdges } = workflowToCanvas(wf.nodes, wf.edges, wf.missing);
      historyRef.current.clear();
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      refreshHistoryControls();
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
        recordHistory();
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
    [recordHistory, setNodes, pushLog],
  );

  /* ---------------- 删除动画：标记 node-exiting → 200ms 后真正移除 ---------------- */
  const removeNodesWithFade = useCallback(
    (ids: Set<string>) => {
      if (!ids.size) return;
      // reduced-motion：不播动画，直接同步移除
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
        setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
        return;
      }
      // 标记退场动画（只对仍存在的节点）
      setNodes((nds) =>
        nds.map((n) =>
          ids.has(n.id) ? { ...n, className: [n.className, "node-exiting"].filter(Boolean).join(" ") } : n,
        ),
      );
      // 200ms 后真正移除；二次校验：节点仍标记 node-exiting 才删
      // （撤销/重做恢复的节点 className 无 node-exiting，不误删）
      const timer = window.setTimeout(() => {
        ids.forEach((id) => pendingRemovalRef.current.delete(id));
        const dead = new Set(
          nodesRef.current
            .filter((n) => ids.has(n.id) && n.className?.includes("node-exiting"))
            .map((n) => n.id),
        );
        if (!dead.size) return;
        setNodes((nds) => nds.filter((n) => !dead.has(n.id)));
        setEdges((eds) => eds.filter((e) => !dead.has(e.source) && !dead.has(e.target)));
      }, FADE_DURATION);
      ids.forEach((id) => pendingRemovalRef.current.set(id, timer));
    },
    [setEdges, setNodes],
  );

  /** 删除节点：播退场动画后移除节点与其所有连线（不删文件，删除文件是显式操作） */
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      recordHistory();
      queueRef.current?.cancel(nodeId);
      removeNodesWithFade(new Set([nodeId]));
      pushLog("已删除节点（文件保留）");
    },
    [pushLog, recordHistory, removeNodesWithFade],
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

  /** 新建节点定位：画布视口中心 + 错开偏移（实例未就绪回退固定坐标） */
  const getCreatePosition = useCallback((count: number): { x: number; y: number } => {
    const rf = rfInstanceRef.current;
    const el = canvasRef.current;
    if (!rf || !el) return { x: 160, y: 100 };
    const rect = el.getBoundingClientRect();
    const center = rf.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    return {
      x: center.x + (count % 6) * 30,
      y: center.y + (count % 4) * 30,
    };
  }, []);

  /** 工具栏按钮：新建提示词卡片（视口中心定位 + 入场动画） */
  const handleCreatePrompt = useCallback(() => {
    recordHistory();
    setNodes((nds) => {
      const pos = getCreatePosition(nds.length);
      return [
        ...nds,
        withEnterAnim({
          id: `prompt-${Date.now()}`,
          type: "prompt" as const,
          position: pos,
          data: {
            prompt: "",
            size: config.sizes[0]?.value ?? "1024x1024",
            quality: defaultQuality,
            outputDir: config.defaultOutputDir,
            status: "idle" as const,
          },
        }, nds.length),
      ];
    });
    pushLog("已新建提示词卡片");
  }, [config, defaultQuality, getCreatePosition, recordHistory, setNodes, pushLog]);

  /** 新建图片组节点（聚合多图后连到提示词统一管理；视口中心定位 + 入场动画） */
  const handleCreateGroup = useCallback(() => {
    recordHistory();
    setNodes((nds) => {
      const pos = getCreatePosition(nds.length);
      return [
        ...nds,
        withEnterAnim({
          id: `group-${Date.now()}`,
          type: "group" as const,
          position: pos,
          data: { name: "图片组", imageCount: 0, totalSize: 0 },
        }, nds.length),
      ];
    });
    pushLog("已新建图片组，把图片连进来即可");
  }, [getCreatePosition, recordHistory, setNodes, pushLog]);

  /** 批量删除：播退场动画后移除所有选中节点及其连线（文件保留） */
  const handleDeleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    recordHistory();
    removeNodesWithFade(ids);
    setSelectedCount(0);
    selectedIdsRef.current = new Set();
    pushLog(`已删除 ${ids.size} 个选中节点（文件保留）`);
  }, [pushLog, recordHistory, removeNodesWithFade]);

  /* ---------------- 运行编排：单节点（入边快照）+ 结果回流 + 全部运行（并发 2） ---------------- */
  const runNodeInternal = useCallback(
    async (nodeId: string, context: GenerationRunContext) => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== "prompt") return;
      const data = node.data;
      if (!data.prompt.trim()) {
        const message = "请先输入提示词";
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "failed", message }));
        pushLog(`节点 ${nodeId}：${message}`);
        throw new Error(message);
      }
      // 运行快照：锁定入边参考图集合，运行期间画布编辑不影响本次
      const snapshot = snapshotIncomingAbsPaths(nodes, edges, nodeId);
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
        if (context.isCancelled()) {
          pushLog(`节点 ${nodeId}：任务已取消，结果未回流`);
          return;
        }
        const successfulResults = res.results.filter((result) => result.status === "ok" && result.url);
        if (!successfulResults.length) {
          const reason = res.results
            .filter((result) => result.status === "error")
            .map((result) => result.message)
            .filter(Boolean)
            .join("；") || "服务端没有返回可用结果";
          throw new Error(reason);
        }
        // 结果回流：结果图复制进画布注册表并建节点（放在提示词节点右下方）
        const resultPaths = successfulResults
          .map((r) => new URLSearchParams(r.url!.split("?")[1] ?? "").get("path") ?? "")
          .filter(Boolean);
        if (!resultPaths.length) throw new Error("生成结果缺少可导入的文件路径");
        let resultCount = 0;
        if (resultPaths.length) {
          const importedBatches = await Promise.all(
            resultPaths.map((path) => historyCanvasImport(path)),
          );
          const imported = importedBatches.flatMap((batch) => batch.imported);
          if (!imported.length) throw new Error("生成成功，但结果导入画布失败");
          if (context.isCancelled()) {
            pushLog(`节点 ${nodeId}：任务已取消，结果未回流`);
            return;
          }
          // 节点已被删除则不回流（避免删了节点还冒出结果图）
          const promptNode = nodesRef.current.find((n) => n.id === nodeId);
          if (!promptNode) {
            pushLog(`节点 ${nodeId}：节点已删除，结果未回流`);
          } else {
            // 按 registryId 去重：画布上已存在的同图不再建节点（防节点 id 重复）
            const existingIds = new Set(
              nodesRef.current.filter((n) => n.type === "image").map((n) => n.data.registryId),
            );
            const fresh = imported.filter((e) => !existingIds.has(e.id));
            resultCount = imported.length;
            const baseX = (promptNode.position.x ?? 40) + 340;
            const baseY = (promptNode.position.y ?? 40) + 20;
            setNodes((nds) => {
              // 回调内用最新 nds 二次校验（防 setNodes 之间其他改动导致重复）
              const pn = nds.find((n) => n.id === nodeId);
              if (!pn) return nds;
              const exIds = new Set(
                nds.filter((n) => n.type === "image").map((n) => n.data.registryId),
              );
              const created = fresh
                .filter((entry) => !exIds.has(entry.id))
                .map((entry, i) => withEnterAnim(buildImageNode(entry, { x: baseX, y: baseY + i * 130 }), i));
              return [...nds, ...created];
            });
            // 结果图自动连线：提示词节点 -> 结果图片（产出边，右边出线）
            setEdges((eds) => {
              const existing = new Set(eds.map((edge) => `${edge.source}->${edge.target}`));
              const created = imported
                .map((entry) => ({
                  id: `${nodeId}->img-${entry.id}`,
                  source: nodeId,
                  target: `img-${entry.id}`,
                }))
                .filter((edge) => !existing.has(`${edge.source}->${edge.target}`));
              return [...eds, ...created];
            });
            pushLog(`节点 ${nodeId}：生成 ${resultCount} 张并已回流画布（自动连线）`);
          }
        }
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "done", resultCount, message: undefined }));
      } catch (err) {
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "failed", message: errMessage(err) }));
        pushLog(`节点 ${nodeId} 失败：${errMessage(err)}`);
        throw err;
      } finally {
        window.clearInterval(timer);
      }
    },
    [setNodes, setEdges, pushLog],
  );

  const generationQueue = useMemo(
    () => createGenerationQueue({ concurrency: RUN_CONCURRENCY, run: runNodeInternal }),
    [runNodeInternal],
  );
  queueRef.current = generationQueue;

  useEffect(() => generationQueue.subscribe((tasks) => {
    setQueueTasks(tasks);
    const queuedIds = new Set(tasks.filter((task) => task.status === "queued").map((task) => task.id));
    const cancelledIds = new Set(tasks.filter((task) => task.status === "cancelled").map((task) => task.id));
    setNodes((nds) => nds.map((node) => {
      if (node.type !== "prompt") return node;
      if (queuedIds.has(node.id)) {
        return { ...node, data: { ...node.data, status: "queued", message: undefined } };
      }
      if (cancelledIds.has(node.id)) {
        return { ...node, data: { ...node.data, status: "idle", elapsed: undefined, message: undefined } };
      }
      return node;
    }));
  }), [generationQueue, setNodes]);

  const handleRun = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.type !== "prompt") return;
      if (!node.data.prompt.trim()) {
        pushLog(`节点 ${nodeId}：请先输入提示词`);
        return;
      }
      generationQueue.enqueue(nodeId);
    },
    [generationQueue, pushLog],
  );

  const handleRunAll = useCallback(async () => {
    const all = nodesRef.current.filter((n) => n.type === "prompt");
    const runnable = all
      .filter((n) => n.data.prompt.trim())
      .map((n) => n.id);
    const enqueued = runnable.filter((id) => generationQueue.enqueue(id));
    if (!enqueued.length) {
      pushLog(
        all.length ? "没有待运行的提示词节点（已排除空提示词 / 已调度）" : "画布上没有提示词节点",
      );
      return;
    }
    pushLog(`已排队 ${enqueued.length} 个节点，并发 ${Math.min(RUN_CONCURRENCY, enqueued.length)}`);
    await generationQueue.onIdle();
    pushLog("全部运行完成");
  }, [generationQueue, pushLog]);

  /** 自动整理：手写几何布局所有节点（参考图→提示词→结果图左中右排列），整理后自适应居中 */
  const handleAutoLayout = useCallback(() => {
    const current = nodesRef.current;
    if (!current.length) {
      pushLog("画布为空，无需整理");
      return;
    }
    recordHistory();
    setNodes(autoLayout(current, edgesRef.current));
    pushLog(`已整理 ${current.length} 个节点`);
    // 等 React Flow 连续完成状态提交和节点测量后再读取新坐标。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void rfInstanceRef.current?.fitView({ padding: 0.2, duration: 300 });
      });
    });
  }, [recordHistory, setNodes, pushLog]);

  const handleAutoConnect = useCallback(() => {
    const currentEdges = edgesRef.current;
    const nextEdges = autoConnect(nodesRef.current, currentEdges);
    if (nextEdges.length === currentEdges.length) {
      pushLog("没有发现可自动连接的孤立节点");
      return;
    }
    recordHistory();
    setEdges(nextEdges);
    pushLog(`已自动补充 ${nextEdges.length - currentEdges.length} 条连线`);
  }, [pushLog, recordHistory, setEdges]);

  const handleHistoryImport = useCallback(async (path: string) => {
    try {
      const { imported, skipped } = await historyCanvasImport(path);
      if (!imported.length) {
        pushLog(`历史图片导入失败：${skipped[0]?.reason ?? "文件不可用"}`);
        return;
      }
      recordHistory();
      setNodes((nds) => [...nds, ...canvasEntriesToNodes(imported, nds).map((n, i) => withEnterAnim(n, i))]);
      setShowHistory(false);
      pushLog(`已从生成历史导入 ${imported.length} 张图片`);
    } catch (err) {
      pushLog(`历史图片导入失败：${errMessage(err)}`);
    }
  }, [pushLog, recordHistory, setNodes]);

  const handleUndo = useCallback(() => {
    pendingRemovalRef.current.forEach((timer) => window.clearTimeout(timer));
    pendingRemovalRef.current.clear();
    const previous = historyRef.current.undo({ nodes: nodesRef.current, edges: edgesRef.current });
    if (!previous) return;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    refreshHistoryControls();
    pushLog("已撤销画布操作");
  }, [pushLog, refreshHistoryControls, setEdges, setNodes]);

  const handleRedo = useCallback(() => {
    pendingRemovalRef.current.forEach((timer) => window.clearTimeout(timer));
    pendingRemovalRef.current.clear();
    const next = historyRef.current.redo({ nodes: nodesRef.current, edges: edgesRef.current });
    if (!next) return;
    setNodes(next.nodes);
    setEdges(next.edges);
    refreshHistoryControls();
    pushLog("已重做画布操作");
  }, [pushLog, refreshHistoryControls, setEdges, setNodes]);

  const handleCancelTask = useCallback((id: string) => {
    if (generationQueue.cancel(id)) pushLog(`任务 ${id} 已取消`);
  }, [generationQueue, pushLog]);

  const handleRetryFailed = useCallback(() => {
    const count = generationQueue.retryFailed();
    pushLog(count ? `已重新排队 ${count} 个失败任务` : "没有可重试的失败任务");
  }, [generationQueue, pushLog]);

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
      <div className="flex flex-wrap items-start gap-2">
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <ToolbarButton onClick={() => void handleSave()}>保存工作流</ToolbarButton>
          <ToolbarButton onClick={() => void handleLoad()}>加载工作流</ToolbarButton>
          <ToolbarButton onClick={() => setShowHistory(true)}>生成历史</ToolbarButton>
          <ToolbarButton onClick={handleUndo} disabled={!historyRef.current.canUndo()}>撤销</ToolbarButton>
          <ToolbarButton onClick={handleRedo} disabled={!historyRef.current.canRedo()}>恢复</ToolbarButton>
          <ToolbarButton onClick={handleAutoLayout}>自动整理</ToolbarButton>
          <ToolbarButton onClick={handleAutoConnect}>自动连线</ToolbarButton>
          <ToolbarButton onClick={() => void handleRunAll()} disabled={runningAll}>
            {runningAll ? "运行中..." : "全部运行"}
          </ToolbarButton>
        </div>
      </div>
      {/* 操作帮助：单行小字，画布/节点/连线三类交互用分隔符紧凑展示 */}
      <div className="flex flex-wrap items-center gap-x-1 text-[10px] leading-tight text-neutral-400">
        <span className="font-medium text-neutral-500">画布</span>Shift+拖拽框选 · 滚轮缩放 · 空白拖拽平移 · 双击连线删除
        <span className="text-neutral-300">｜</span>
        <span className="font-medium text-neutral-500">节点</span>悬停显右侧操作栏 · 双击图片放大
        <span className="text-neutral-300">｜</span>
        <span className="font-medium text-neutral-500">连线</span>图片→提示词/图片组 · 图片组→提示词 · 提示词→图片；提示词顶部仅一条入边，多图用图片组聚合
      </div>

      <TaskCenter tasks={queueTasks} onCancel={handleCancelTask} onRetryFailed={handleRetryFailed} />

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
          onEdgeDoubleClick={(_event, edge) => handleEdgeDoubleClick(edge)}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeDragStart={recordHistory}
          onSelectionChange={onSelectionChange}
          onMove={(_event, viewport) => setCanvasZoom(viewport.zoom)}
          onInit={(instance) => {
            rfInstanceRef.current = instance;
            setCanvasZoom(instance.getViewport().zoom);
          }}
          fitView
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{ animated: true }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls />
        </ReactFlow>
        </div>
        <CanvasLog logs={logs} />
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
      <HistoryGallery
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onImport={handleHistoryImport}
      />
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
