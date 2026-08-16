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
  historyCanvasImport,
  selectFolder,
  workflowList,
  workflowLoad,
  workflowSave,
} from "../api";
import { createCanvasHistory } from "../canvasHistory";
import { errMessage } from "../format";
import { useGenerationTask, type GenerationTaskView } from "../useGenerationTask";
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
  collectIncomingImages,
  computeCounts,
  extractAnimClasses,
  layoutPromptResults,
  layoutSelection,
  nodeSize,
  stripAnimClasses,
  updatePromptNode,
  updateSelectedPromptOutputDirs,
  withEnterAnim,
  workflowToCanvas,
} from "../workflow";
import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";
import HistoryGallery from "./HistoryGallery";
import { PromptImportModal } from "./PromptImportModal";
import { WorkflowLoadModal, WorkflowSaveModal, ZoomModal } from "./WorkflowModals";
import { buildPromptNodes, type PromptCardSpec } from "../promptContract";

/** 节点删除退场动画时长（与 .node-exiting 的 fade-out 0.2s 一致） */
const FADE_DURATION = 200;

/** fitView 允许的最小缩放：画布节点很多时仍能一屏全览（低于 ReactFlow minZoom 属性，仅 fitView 生效） */
const MIN_FIT_ZOOM = 0.02;

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
  /** 当前选中的节点数（右键拖拽框选 / Ctrl+点击加选多选后显示批量删除） */
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedPromptCount, setSelectedPromptCount] = useState(0);
  const [pickingSelectedOutputDir, setPickingSelectedOutputDir] = useState(false);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  /** 右键拖拽框选：拖拽起点（flow 坐标，null=未拖拽）。
   *   React Flow 默认 Shift+左键框选已通过 selectionKeyCode={null} 禁用，改为右键直接拖拽多选；
   *   Ctrl(Windows)/Cmd(Mac)+点击加选走 React Flow 原生 multiSelectionKeyCode（见组件 props）。 */
  const boxSelectRef = useRef<{ startFlow: { x: number; y: number } } | null>(null);
  const [boxRect, setBoxRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const historyRef = useRef(createCanvasHistory());
  const [, setHistoryVersion] = useState(0);
  /** 生成任务：统一提交-轮询（服务端任务管线，经典表单与画布共用） */
  const generationTask = useGenerationTask();
  // 解构稳定成员供回调依赖：generationTask 对象每次渲染重建（tasks 数组新建），
  // 若回调依赖整个对象会导致 nodeTypes 重建 → React Flow 全节点重挂载 → 入场动画重播闪烁。
  // 成员函数由 useCallback 缓存，引用恒定，可安全进入依赖数组。
  const {
    cancel: cancelGenerationTask,
    submit: submitGenerationTask,
    subscribe: subscribeGenerationTask,
  } = generationTask;
  /** 提示词节点 → taskId（提交成功时登记，终态订阅回调解除；防重复提交 + 删除节点时取消定位） */
  const nodeTaskRef = useRef(new Map<string, string>());
  /** taskId → 提示词节点（订阅回调按此定位节点驱动状态） */
  const taskNodeRef = useRef(new Map<string, string>());
  const runningAll = generationTask.tasks.some((task) => task.status === "queued" || task.status === "running");
  /** 放大预览：当前预览的图片绝对路径（null 关闭）与文件名 */
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomName, setZoomName] = useState("");
  /** 保存/加载工作流弹窗 */
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  /** 粘贴导入提示词卡片弹窗 */
  const [showImportModal, setShowImportModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [workflows, setWorkflows] = useState<{ name: string; modified: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 替换图片：待替换的目标节点 + 专用文件选择 */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const pendingReplaceRef = useRef<string | null>(null);

  /** 待真正移除的节点 id -> 定时器（退场动画播完后再删；撤销/恢复/卸载需清理） */
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
    generationTask.tasks
      .filter((task) => task.status === "queued" || task.status === "running")
      .forEach((task) => void cancelGenerationTask(task.taskId));
  }, [cancelGenerationTask, generationTask.tasks]);

  /** 一屏全览：等 React Flow 完成状态提交和节点测量后 fitView。
   *  minZoom 显式放宽：节点很多时允许缩到很小，保证"全部显示在画面中"。
   *  不用 ReactFlow 初始 fitView prop——空画布时它会被延迟到"第一个节点出现"才执行，
   *  导致新建/上传后视口突然放大跳动。 */
  const fitCanvasToContent = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void rfInstanceRef.current?.fitView({ padding: 0.15, duration: 300, minZoom: MIN_FIT_ZOOM });
      });
    });
  }, []);

  const restoreCanvas = useCallback(
    (restoredNodes: WorkflowNode[], restoredEdges: WorkflowEdge[]) => {
      historyRef.current.clear();
      setNodes(restoredNodes);
      setEdges(restoredEdges);
      refreshHistoryControls();
      fitCanvasToContent();
    },
    [fitCanvasToContent, refreshHistoryControls, setEdges, setNodes],
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

  /* ---------------- 入场动画收尾：动画播完即剥离 node-enter 类 ----------------
   * 节点 className 上的 node-enter/enter-delay-N 是运行时一次性视觉标记，若残留，
   * 任何一次节点重挂载（nodeTypes 变化、工作流加载等）都会重播入场动画 → 闪烁。
   * 用事件委托监听画布容器内动画结束，按 data-id 定位节点并剥离动画类。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onAnimationEnd = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const wrapper = target?.closest<HTMLElement>("[data-id]");
      if (!wrapper) return;
      const nodeId = wrapper.dataset.id;
      if (!nodeId) return;
      // 只在入场动画结束（而非退场 fade-out）时清理；退场动画由删除流程负责
      if (event.type === "animationend" && (event as AnimationEvent).animationName === "enter-up") {
        setNodes((nds) => {
          const node = nds.find((n) => n.id === nodeId);
          if (!node || !node.className?.includes("node-enter")) return nds;
          const cleaned = stripAnimClasses(node.className);
          return nds.map((n) => (n.id === nodeId ? { ...n, className: cleaned } : n));
        });
      }
    };
    canvas.addEventListener("animationend", onAnimationEnd);
    return () => canvas.removeEventListener("animationend", onAnimationEnd);
  }, [setNodes]);

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
    setSelectedPromptCount(selected.filter((node) => node.type === "prompt").length);
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
      // 新图放在画布视口中心（与新建卡片同约定），避免落在视口外/左上角
      const origin = getCreatePosition();
      setNodes((nds) => [...nds, ...canvasEntriesToNodes(images, nds, origin).map((n, i) => withEnterAnim(n, i))]);
      pushLog(`已上传 ${images.length} 张图片到画布`);
    } catch (err) {
      pushLog(`上传失败：${errMessage(err)}`);
    }
  };

  const handleSave = useCallback(async () => {
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
  }, [nodes.length, pushLog]);

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
      const { path } = await workflowSave({
        name,
        nodes: nodes.map((node) => ({ ...node, className: stripAnimClasses(node.className) })),
        edges,
      });
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
      // 工作流整体替换：旧任务映射一并清空（旧节点 id 可能与新工作流撞号）
      nodeTaskRef.current.clear();
      taskNodeRef.current.clear();
      const wf = await workflowLoad(name);
      const { nodes: loadedNodes, edges: loadedEdges } = workflowToCanvas(wf.nodes, wf.edges, wf.missing);
      historyRef.current.clear();
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      refreshHistoryControls();
      fitCanvasToContent();
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
                url: entry.url,
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
      // （撤销/恢复后的节点 className 无 node-exiting，不误删）
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

  /** 删除节点：播退场动画后移除节点与其所有连线（不删文件，删除文件是显式操作）；有进行中的任务则一并取消 */
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      recordHistory();
      // 按 nodeTaskRef 定位取消，避免删除后结果回流冒出图片节点
      // （提交中占位为 ""，此时映射已登记但无真实 taskId，跳过取消、仅清映射）
      const taskId = nodeTaskRef.current.get(nodeId);
      if (taskId !== undefined) {
        nodeTaskRef.current.delete(nodeId);
        taskNodeRef.current.delete(taskId);
        if (taskId) void cancelGenerationTask(taskId);
      }
      removeNodesWithFade(new Set([nodeId]));
      pushLog("已删除节点（文件保留）");
    },
    [cancelGenerationTask, pushLog, recordHistory, removeNodesWithFade],
  );

  /* ---------------- 图片双击动作：放大预览 ---------------- */
  const handleZoom = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    // 缺失节点无 absPath，不弹预览（红框已提示）
    if (node?.type === "image" && node.data.absPath) {
      setZoomImage(node.data.absPath);
      setZoomName(node.data.name);
    }
  }, []);

  /** 默认质量：优先 high（用户要求） */
  const defaultQuality = config.qualities.includes("high") ? "high" : config.qualities[0] ?? "low";

  /** 最近一次新建/上传落点：连续创建时阶梯错开（每次 +30px），视口移动或隔段时间后回到中心。
   *  不用全局节点数做偏移——节点一多新内容会越偏越远，用户感知为"不在画面中央"。 */
  const lastCreatePosRef = useRef<{ x: number; y: number } | null>(null);

  /** 新建节点定位：画布视口中心（实例未就绪回退固定坐标），连续创建阶梯错开避免完全重叠 */
  const getCreatePosition = useCallback((): { x: number; y: number } => {
    const rf = rfInstanceRef.current;
    const el = canvasRef.current;
    if (!rf || !el) return { x: 160, y: 100 };
    const rect = el.getBoundingClientRect();
    const center = rf.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const last = lastCreatePosRef.current;
    // 视口基本没动（落点与上次相近）→ 阶梯错开；否则回到视口中心
    if (last && Math.abs(last.x - center.x) < 200 && Math.abs(last.y - center.y) < 200) {
      const next = { x: last.x + 30, y: last.y + 30 };
      lastCreatePosRef.current = next;
      return next;
    }
    lastCreatePosRef.current = center;
    return center;
  }, []);

  /** 工具栏按钮：新建提示词卡片（视口中心定位 + 入场动画） */
  const handleCreatePrompt = useCallback(() => {
    recordHistory();
    setNodes((nds) => {
      const pos = getCreatePosition();
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

  /** 契约导入建卡：解析出的合法卡片批量生成提示词节点（视口中心定位 + 入场动画） */
  const handleImportCards = useCallback(
    (cards: PromptCardSpec[]) => {
      if (!cards.length) return;
      recordHistory();
      const origin = getCreatePosition();
      setNodes((nds) => [
        ...nds,
        ...buildPromptNodes(
          cards,
          { sizes: config.sizes, defaultQuality, defaultOutputDir: config.defaultOutputDir },
          origin,
        ).map((node, i) => withEnterAnim(node, nds.length + i)),
      ]);
      setShowImportModal(false);
      pushLog(`已从契约导入 ${cards.length} 张提示词卡片`);
    },
    [config, defaultQuality, getCreatePosition, pushLog, recordHistory, setNodes],
  );

  /** 新建图片组节点（聚合多图后连到提示词统一管理；视口中心定位 + 入场动画） */
  const handleCreateGroup = useCallback(() => {
    recordHistory();
    setNodes((nds) => {
      const pos = getCreatePosition();
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
    setSelectedPromptCount(0);
    selectedIdsRef.current = new Set();
    pushLog(`已删除 ${ids.size} 个选中节点（文件保留）`);
  }, [pushLog, recordHistory, removeNodesWithFade]);

  /** 批量设置选区内提示词输出目录：混合选区自动忽略图片与图片组，一次修改对应一次撤销。 */
  const handleSetSelectedOutputDir = useCallback(async () => {
    const selectedIds = selectedIdsRef.current;
    const firstSelectedPrompt = nodesRef.current.find(
      (node) => node.type === "prompt" && selectedIds.has(node.id),
    );
    if (!firstSelectedPrompt || firstSelectedPrompt.type !== "prompt" || pickingSelectedOutputDir) return;
    setPickingSelectedOutputDir(true);
    try {
      const { path } = await selectFolder(firstSelectedPrompt.data.outputDir);
      if (!path) return;
      const result = updateSelectedPromptOutputDirs(nodesRef.current, selectedIds, path);
      if (!result.changedCount) {
        pushLog("所选提示词卡片已使用该输出路径");
        return;
      }
      recordHistory();
      setNodes(result.nodes);
      pushLog(`已设置 ${result.changedCount} 张提示词卡片的输出路径`);
    } catch (err) {
      pushLog(`批量设置输出路径失败：${errMessage(err)}`);
    } finally {
      setPickingSelectedOutputDir(false);
    }
  }, [pickingSelectedOutputDir, pushLog, recordHistory, setNodes]);

  /* ---------------- 运行编排：单节点提交（入边快照）+ 结果回流 + 全部运行（服务端并发队列） ---------------- */
  /** 结果回流：done 快照 → 结果图复制进画布注册表并建节点（放提示词节点右下方）+ 自动连线，返回回流张数 */
  const reflowResults = useCallback(
    async (nodeId: string, task: GenerationTaskView): Promise<number> => {
      const successfulResults = (task.results ?? []).filter((r) => r.status === "ok" && r.url);
      const resultPaths = successfulResults
        .map((r) => new URLSearchParams(r.url!.split("?")[1] ?? "").get("path") ?? "")
        .filter(Boolean);
      if (!resultPaths.length) return 0;
      try {
        const importedBatches = await Promise.all(resultPaths.map((path) => historyCanvasImport(path)));
        const imported = importedBatches.flatMap((batch) => batch.imported);
        if (!imported.length) {
          pushLog(`节点 ${nodeId}：生成成功，但结果导入画布失败`);
          return 0;
        }
        // 节点已被删除则不回流（避免删了节点还冒出结果图）
        const promptNode = nodesRef.current.find((n) => n.id === nodeId);
        if (!promptNode) {
          pushLog(`节点 ${nodeId}：节点已删除，结果未回流`);
          return 0;
        }
        // 按 registryId 去重：画布上已存在的同图不再建节点（防节点 id 重复）
        const existingIds = new Set(
          nodesRef.current.filter((n) => n.type === "image").map((n) => n.data.registryId),
        );
        const fresh = imported.filter((entry) => !existingIds.has(entry.id));
        const outputEdges: WorkflowEdge[] = imported.map((entry) => ({
          id: `${nodeId}->img-${entry.id}`,
          source: nodeId,
          target: `img-${entry.id}`,
        }));
        setNodes((nds) => {
          // 回调内用最新 nds 二次校验（防 setNodes 之间其他改动导致重复）
          const pn = nds.find((n) => n.id === nodeId);
          if (!pn) return nds;
          const exIds = new Set(
            nds.filter((n) => n.type === "image").map((n) => n.data.registryId),
          );
          const created = fresh
            .filter((entry) => !exIds.has(entry.id))
            .map((entry, i) => withEnterAnim(buildImageNode(entry, pn.position), i));
          const nextNodes = [...nds, ...created];
          return layoutPromptResults(nextNodes, [...edgesRef.current, ...outputEdges], nodeId);
        });
        // 结果图自动连线：提示词节点 -> 结果图片（产出边，向下流动）
        setEdges((eds) => {
          const existing = new Set(eds.map((edge) => `${edge.source}->${edge.target}`));
          const created = outputEdges.filter((edge) => !existing.has(`${edge.source}->${edge.target}`));
          return [...eds, ...created];
        });
        pushLog(`节点 ${nodeId}：生成 ${imported.length} 张并已回流画布（自动连线）`);
        return imported.length;
      } catch (err) {
        pushLog(`节点 ${nodeId}：结果回流失败：${errMessage(err)}`);
        return 0;
      }
    },
    [pushLog, setEdges, setNodes],
  );

  /** 提交单个提示词节点：锁定入边参考图快照 → 服务端异步生成（后续状态由订阅回调驱动） */
  const runNodeInternal = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.type !== "prompt") return;
      const data = node.data;
      if (!data.prompt.trim()) {
        pushLog(`节点 ${nodeId}：请先输入提示词`);
        return;
      }
      // 双层守卫：节点状态 + 任务映射，防快速重复点击重复提交
      if (data.status === "queued" || data.status === "running") return;
      if (nodeTaskRef.current.has(nodeId)) return;
      // 同步登记占位：submit 是异步的，映射若在 await 之后才登记，快速连点会在
      // submit 完成前双双通过守卫重复提交（旧 generationQueue 是同步登记，此处保持同等语义）。
      // 成功后再覆盖为真实 taskId，失败时清除占位。
      nodeTaskRef.current.set(nodeId, "");
      // 运行快照：锁定入边参考图集合，运行期间画布编辑不影响本次；
      // 缺图守卫：参考图文件缺失（加载的工作流里 registry 条目丢失）时不静默跳过——
      // 明确报错中止，避免不带参考图悄悄生成出错误结果。
      const refImages = collectIncomingImages(nodesRef.current, edgesRef.current, nodeId);
      const missingRefs = refImages.filter((n) => n.type === "image" && !n.data.absPath).length;
      if (missingRefs > 0) {
        nodeTaskRef.current.delete(nodeId);
        pushLog(`节点 ${nodeId}：${missingRefs} 张参考图文件缺失，请先替换或删除后再运行`);
        return;
      }
      const snapshot = refImages
        .map((n) => (n.type === "image" ? n.data.absPath : undefined))
        .filter((p): p is string => Boolean(p));
      setNodes((nds) => updatePromptNode(nds, nodeId, { status: "queued", elapsed: 0, message: undefined }));
      pushLog(`节点 ${nodeId} 已提交，参考图：[${snapshot.length} 张]`);
      try {
        const taskId = await submitGenerationTask({
          prompt: data.prompt,
          refPaths: snapshot,
          files: [],
          size: data.size,
          quality: data.quality,
          outputDir: data.outputDir,
          win: 0,
        });
        nodeTaskRef.current.set(nodeId, taskId);
        taskNodeRef.current.set(taskId, nodeId);
      } catch (err) {
        nodeTaskRef.current.delete(nodeId);
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "failed", message: errMessage(err) }));
        pushLog(`节点 ${nodeId} 提交失败：${errMessage(err)}`);
      }
    },
    [submitGenerationTask, pushLog, setNodes],
  );

  /** 等待画布无活动任务（任务映射清空即全部终态），供「全部运行」收尾 */
  const waitCanvasIdle = useCallback(async () => {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (nodeTaskRef.current.size === 0) resolve();
        else window.setTimeout(check, 500);
      };
      check();
    });
  }, []);

  /* ---------------- 任务订阅：taskId → 节点映射，状态驱动 + 终态回流/失败/取消 ---------------- */
  useEffect(() => {
    return subscribeGenerationTask((taskId, view) => {
      const nodeId = taskNodeRef.current.get(taskId);
      if (!nodeId) return;
      if (view.status === "queued") {
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "queued", elapsed: 0, message: undefined }));
      } else if (view.status === "running") {
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "running", elapsed: view.elapsed }));
      } else if (view.status === "done") {
        // 终态：解除映射（只处理一次），状态先落 done，回流完成后补张数
        nodeTaskRef.current.delete(nodeId);
        taskNodeRef.current.delete(taskId);
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "done", message: undefined }));
        void reflowResults(nodeId, view).then((count) => {
          if (count > 0) setNodes((nds) => updatePromptNode(nds, nodeId, { resultCount: count }));
        });
      } else if (view.status === "failed") {
        nodeTaskRef.current.delete(nodeId);
        taskNodeRef.current.delete(taskId);
        setNodes((nds) =>
          updatePromptNode(nds, nodeId, { status: "failed", elapsed: undefined, message: view.error ?? "生成失败" }),
        );
        pushLog(`节点 ${nodeId} 失败：${view.error ?? "未知错误"}`);
      } else if (view.status === "cancelled") {
        nodeTaskRef.current.delete(nodeId);
        taskNodeRef.current.delete(taskId);
        setNodes((nds) => updatePromptNode(nds, nodeId, { status: "idle", elapsed: undefined, message: undefined }));
        pushLog(`节点 ${nodeId}：任务已取消`);
      }
    });
  // subscribe 引用稳定，依赖只取解构成员，避免每次任务状态刷新都重建订阅（重建不会丢事件，但没必要）。
    }, [subscribeGenerationTask, pushLog, reflowResults, setNodes]);

  const handleRun = useCallback(
    (nodeId: string) => {
      void runNodeInternal(nodeId);
    },
    [runNodeInternal],
  );

  const handleRunAll = useCallback(async () => {
    const all = nodesRef.current.filter((n) => n.type === "prompt");
    const runnable = all
      .filter((n) => n.data.prompt.trim())
      .filter((n) => !nodeTaskRef.current.has(n.id));
    if (!runnable.length) {
      pushLog(
        all.length ? "没有待运行的提示词节点（已排除空提示词 / 运行中）" : "画布上没有提示词节点",
      );
      return;
    }
    pushLog(`已提交 ${runnable.length} 个节点（服务端并发队列）`);
    // 先等所有提交完成登记（避免 waitCanvasIdle 把未登记阶段误判为空），再等全部终态
    await Promise.all(runnable.map((n) => runNodeInternal(n.id)));
    await waitCanvasIdle();
    pushLog("全部运行完成");
  }, [pushLog, runNodeInternal, waitCanvasIdle]);

  /** 自动整理：有选中节点时只整理选中的（局部三段式，其余原位）；否则全局三段式布局。整理后自适应居中 */
  const handleAutoLayout = useCallback(() => {
    const current = nodesRef.current;
    if (!current.length) {
      pushLog("画布为空，无需整理");
      return;
    }
    const selected = selectedIdsRef.current;
    recordHistory();
    if (selected.size > 0) {
      setNodes(layoutSelection(current, edgesRef.current, selected));
      pushLog(`已整理 ${selected.size} 个选中节点`);
    } else {
      setNodes(autoLayout(current, edgesRef.current));
      pushLog(`已整理 ${current.length} 个节点`);
    }
    fitCanvasToContent();
  }, [fitCanvasToContent, recordHistory, setNodes, pushLog]);

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
      // 与上传同约定：导入的图片放在画布视口中心
      const origin = getCreatePosition();
      setNodes((nds) => [...nds, ...canvasEntriesToNodes(imported, nds, origin).map((n, i) => withEnterAnim(n, i))]);
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

  const handleRestore = useCallback(() => {
    pendingRemovalRef.current.forEach((timer) => window.clearTimeout(timer));
    pendingRemovalRef.current.clear();
    const next = historyRef.current.restore({ nodes: nodesRef.current, edges: edgesRef.current });
    if (!next) return;
    setNodes(next.nodes);
    setEdges(next.edges);
    refreshHistoryControls();
    pushLog("已恢复画布操作");
  }, [pushLog, refreshHistoryControls, setEdges, setNodes]);

  /** 运行所选：只挑选中节点里的提示词卡片提交（图片/图片组自动忽略，混合选区不受影响）。
   *  空提示词/运行中的卡片跳过，与「全部运行」同一守卫语义。 */
  const handleRunSelected = useCallback(() => {
    const selected = nodesRef.current.filter(
      (node): node is Extract<WorkflowNode, { type: "prompt" }> =>
        node.type === "prompt" && selectedIdsRef.current.has(node.id),
    );
    const runnable = selected.filter(
      (node) => node.data.prompt.trim() && !nodeTaskRef.current.has(node.id),
    );
    if (!runnable.length) {
      pushLog(
        selected.length
          ? "所选提示词卡片均不可运行（空提示词或运行中）"
          : "所选节点中没有提示词卡片",
      );
      return;
    }
    runnable.forEach((node) => void runNodeInternal(node.id));
    pushLog(`已提交 ${runnable.length} 张提示词卡片（服务端并发队列）`);
  }, [pushLog, runNodeInternal]);

  /* ---------------- 画布快捷键：Ctrl+A 全选 / Ctrl+Z 撤销 / Ctrl+Y 恢复 / Ctrl+S 保存 / Delete 删除选中 ----------------
   * 跳过输入框聚焦（提示词/保存名等文本框内按键走浏览器原生行为）；
   * Delete 走退场动画删除（与按钮一致），React Flow 默认 Backspace 裸删已禁用（deleteKeyCode={null}）。 */
  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.closest("input, textarea, select, [contenteditable]") !== null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "a") {
        // 全选：阻止浏览器默认"选中页面文字"，改选画布全部节点。
        // 直接把 selected 标记写进 nodes，React Flow 会同步 selection 并触发 onSelectionChange，
        // 从而刷新 selectedCount / highlight 与工具栏「删除所选」。
        event.preventDefault();
        if (!nodesRef.current.length) return;
        setNodes((nds) => (nds.some((n) => !n.selected) ? nds.map((n) => ({ ...n, selected: true })) : nds));
        pushLog(`已全选 ${nodesRef.current.length} 个节点`);
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRestore();
        } else {
          handleUndo();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRestore();
        return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (event.key === "Delete" && selectedIdsRef.current.size > 0) {
        event.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDeleteSelected, handleRestore, handleSave, handleUndo, pushLog, setNodes]);

  /* ---------------- 右键拖拽框选（替代 React Flow 默认 Shift+左键框选） ----------------
   * React Flow 默认 selectionKeyCode='Shift' 已禁用（selectionKeyCode={null}）；
   * 右键按下→拖拽→松开：起点与终点用 screenToFlowPosition 换算到画布坐标，
   * 松开时按「节点完全包含于选框」（与 React Flow 默认 selectionMode=full 一致）落定选中，
   * 直接写 selected 标记——与 Ctrl+A 全选同机制，React Flow 会同步 selection 并触发 onSelectionChange，
   * 从而刷新 selectedCount / 高亮与选中操作栏。
   * 右键菜单屏蔽走 window 捕获阶段：拖拽期间（含指针移出画布、在工具栏/空白处松开）浏览器
   * 默认菜单一律不弹出；画布内非输入区右键同样屏蔽（文本框/输入框保留原生粘贴/复制菜单）。 */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    /** 右键是否按下（按下到松开期间全局屏蔽 contextmenu，含指针拖出画布的情况） */
    const rightDownRef = { current: false };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return;
      const rf = rfInstanceRef.current;
      if (!rf) return;
      // 文本框/输入框内右键仍走原生菜单，不启动框选
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      rightDownRef.current = true;
      const startFlow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      boxSelectRef.current = { startFlow };
      setBoxRect({ x: startFlow.x, y: startFlow.y, width: 0, height: 0 });
      // 屏蔽右键按下的原生行为（文本选中/拖拽虚影），只保留框选
      event.preventDefault();
    };

    const onMouseMove = (event: MouseEvent) => {
      const drag = boxSelectRef.current;
      const rf = rfInstanceRef.current;
      if (!drag || !rf) return;
      const curFlow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setBoxRect({
        x: Math.min(drag.startFlow.x, curFlow.x),
        y: Math.min(drag.startFlow.y, curFlow.y),
        width: Math.abs(curFlow.x - drag.startFlow.x),
        height: Math.abs(curFlow.y - drag.startFlow.y),
      });
    };

    const onMouseUp = (event: MouseEvent) => {
      // 注意：这里不能清 rightDownRef——Windows 上 contextmenu 在右键松开之后才触发，
      // 提前清除会让"拖出画布后松开"的默认菜单漏网；由 onWindowContextMenu 处理完再清。
      const drag = boxSelectRef.current;
      const rf = rfInstanceRef.current;
      if (!drag || !rf) return;
      boxSelectRef.current = null;
      const curFlow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const rect = {
        x: Math.min(drag.startFlow.x, curFlow.x),
        y: Math.min(drag.startFlow.y, curFlow.y),
        width: Math.abs(curFlow.x - drag.startFlow.x),
        height: Math.abs(curFlow.y - drag.startFlow.y),
      };
      setBoxRect(null);
      // 几乎没有拖动（视为右键单击）：不改动当前选中
      if (rect.width < 2 && rect.height < 2) return;
      setNodes((nds) => {
        let changed = false;
        const next = nds.map((n) => {
          const size = nodeSize(n);
          const inside =
            n.position.x >= rect.x &&
            n.position.y >= rect.y &&
            n.position.x + size.width <= rect.x + rect.width &&
            n.position.y + size.height <= rect.y + rect.height;
          if (inside === !!n.selected) return n;
          changed = true;
          return { ...n, selected: inside };
        });
        return changed ? next : nds;
      });
    };

    /** window 捕获阶段统一屏蔽：右键按下（含拖拽出画布后松开）任何位置都不弹浏览器菜单；
     *  非拖拽时只屏蔽画布内非输入区（文本框/输入框保留原生粘贴/复制菜单）。
     *  每次处理后清除右键标志，避免残留导致后续右键菜单被永久屏蔽。 */
    const onWindowContextMenu = (event: MouseEvent) => {
      const wasRightDown = rightDownRef.current;
      rightDownRef.current = false;
      if (wasRightDown) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (el.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // 拖拽中途窗口失焦（Alt+Tab 等）时复位，避免残留拖拽状态
    const onWindowBlur = () => {
      rightDownRef.current = false;
      if (boxSelectRef.current) {
        boxSelectRef.current = null;
        setBoxRect(null);
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onWindowContextMenu, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onWindowContextMenu, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [setNodes]);

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
          <ToolbarButton onClick={() => setShowImportModal(true)}>粘贴导入</ToolbarButton>
          <ToolbarButton onClick={handleCreateGroup}>新建图片组</ToolbarButton>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <ToolbarButton onClick={() => void handleSave()}>保存工作流</ToolbarButton>
          <ToolbarButton onClick={() => void handleLoad()}>加载工作流</ToolbarButton>
          <ToolbarButton onClick={() => setShowHistory(true)}>生成历史</ToolbarButton>
          <ToolbarButton onClick={handleUndo} disabled={!historyRef.current.canUndo()}>撤销</ToolbarButton>
          <ToolbarButton onClick={handleRestore} disabled={!historyRef.current.canRestore()}>恢复</ToolbarButton>
          <ToolbarButton onClick={handleAutoLayout}>自动整理</ToolbarButton>
          <ToolbarButton onClick={handleAutoConnect}>自动连线</ToolbarButton>
          <ToolbarButton onClick={() => void handleRunAll()} disabled={runningAll}>
            {runningAll ? "运行中..." : "全部运行"}
          </ToolbarButton>
        </div>
      </div>
      {/* 操作帮助：单行小字，画布/节点/连线三类交互用分隔符紧凑展示（与 README「画布工作流」章节保持一致） */}
      <div className="flex flex-wrap items-center gap-x-1 text-[10px] leading-tight text-neutral-400">
        <span className="font-medium text-neutral-500">画布</span>右键拖拽框选 · Ctrl+点击加选 · 滚轮缩放 · 空白拖拽平移 · 双击连线删除 · 左下角「适应视图」一屏全览 · Ctrl+A 全选 · Ctrl+Z 撤销 / Ctrl+Y 恢复 · Delete 删除选中 · Ctrl+S 保存
        <span className="text-neutral-300">｜</span>
        <span className="font-medium text-neutral-500">节点</span>悬停显右侧操作栏 · 选中后右上角操作栏可运行所选/自动整理/设输出路径/删除 · 双击图片放大（弹窗内滚轮缩放、拖拽平移） · 拖动右下角拉伸
        <span className="text-neutral-300">｜</span>
        <span className="font-medium text-neutral-500">连线</span>图片→提示词/图片组 · 图片组→提示词 · 提示词→图片；提示词顶部仅一条入边，多图用图片组聚合
      </div>

      {/* 画布 */}
      <div className="panel-card relative min-h-0 flex-1 overflow-hidden">
        {/* 选中操作栏：任意选中 ≥1 个节点即出现；「运行所选/设置输出路径」只作用于提示词卡片，
            图片与图片组自动忽略（混合选区不误伤）；「自动整理」局部重排选中节点；「删除所选」作用于全部。 */}
        {selectedCount >= 1 && (
          <div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 p-1 shadow">
            {selectedPromptCount > 0 && (
              <button
                type="button"
                onClick={handleRunSelected}
                title={`运行 ${selectedPromptCount} 张选中的提示词卡片（只运行提示词，图片/图片组忽略）`}
                className="nodrag btn-primary !px-2 !py-1 text-xs"
              >
                运行所选 ({selectedPromptCount})
              </button>
            )}
            <button
              type="button"
              onClick={handleAutoLayout}
              title="局部整理选中的节点，其余保持原位"
              className="nodrag btn-ghost !px-2 !py-1 text-xs"
            >
              自动整理 ({selectedCount})
            </button>
            {selectedPromptCount > 0 && (
              <button
                type="button"
                onClick={() => void handleSetSelectedOutputDir()}
                disabled={pickingSelectedOutputDir}
                title={selectedPromptCount ? `设置 ${selectedPromptCount} 张提示词卡片的输出路径` : "所选节点中没有提示词卡片"}
                className="nodrag btn-ghost !px-2 !py-1 text-xs"
              >
                {pickingSelectedOutputDir ? "选择中..." : `设置输出路径 (${selectedPromptCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="nodrag btn-ghost !border-red-200 !px-2 !py-1 text-xs text-red-500"
            >
              删除所选 ({selectedCount})
            </button>
          </div>
        )}
        <div ref={canvasRef} className="relative h-full w-full">
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
          minZoom={0.05}
          maxZoom={2}
          defaultEdgeOptions={{ animated: true }}
          deleteKeyCode={null}
          selectionKeyCode={null}
          // 显式启用 Ctrl(Windows)/Cmd(Mac)+点击多选：React Flow 默认 multiSelectionKeyCode='Meta'
          // 只匹配 Mac 的 Cmd，Windows 的 Ctrl 不生效，需传数组同时覆盖两种修饰键
          multiSelectionKeyCode={["Meta", "Control"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          {/* 左下角控制钮：fitView 显式放宽 minZoom，节点再多也能一屏全览 */}
          <Controls fitViewOptions={{ padding: 0.15, minZoom: MIN_FIT_ZOOM, maxZoom: 2 }} />
        </ReactFlow>
        {/* 右键拖拽框选的选框（画布坐标转屏幕坐标定位，pointer-events-none 不挡交互） */}
        {boxRect &&
          (() => {
            const rf = rfInstanceRef.current;
            const el = canvasRef.current;
            if (!rf || !el) return null;
            const p1 = rf.flowToScreenPosition({ x: boxRect.x, y: boxRect.y });
            const p2 = rf.flowToScreenPosition({
              x: boxRect.x + boxRect.width,
              y: boxRect.y + boxRect.height,
            });
            const rect = el.getBoundingClientRect();
            return (
              <div
                className="pointer-events-none absolute z-[1002] rounded-sm border border-brand/80 bg-brand/10"
                style={{
                  left: p1.x - rect.left,
                  top: p1.y - rect.top,
                  width: p2.x - p1.x,
                  height: p2.y - p1.y,
                }}
              />
            );
          })()}
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
      {showImportModal && (
        <PromptImportModal
          sizes={config.sizes}
          onConfirm={handleImportCards}
          onClose={() => setShowImportModal(false)}
        />
      )}
      {zoomImage && (
        <ZoomModal imagePath={zoomImage} name={zoomName} onClose={() => setZoomImage(null)} />
      )}
    </div>
  );
}
