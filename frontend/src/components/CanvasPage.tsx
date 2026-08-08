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
  workflowToCanvas,
} from "../workflow";
import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";

/** 全部运行并发上限（单次生成 30-120s，防止打爆 API） */
const RUN_CONCURRENCY = 2;

interface CanvasPageProps {
  config: AppConfig;
}

export default function CanvasPage({ config }: CanvasPageProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
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

  /* ---------------- 连线：类型硬约束（图片 -> 提示词 | 图片组；图片组 -> 提示词） ---------------- */
  const isValidConnection: IsValidConnection = useCallback((connection) => {
    const source = nodesRef.current.find((n) => n.id === connection.source);
    const target = nodesRef.current.find((n) => n.id === connection.target);
    if (source?.type === "image") {
      return target?.type === "prompt" || target?.type === "group";
    }
    if (source?.type === "group") {
      return target?.type === "prompt";
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

  /* ---------------- 图片双击动作：放大预览 / 生成提示词卡片 ---------------- */
  const handleZoom = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (node?.type === "image") {
      setZoomImage(node.data.absPath);
      setZoomName(node.data.name);
    }
  }, []);

  /** 以某图片为参考：新建提示词卡片并自动连线（图片 -> 提示词） */
  const handleCreatePromptFromImage = useCallback(
    (imageNodeId: string) => {
      const imageNode = nodesRef.current.find((n) => n.id === imageNodeId);
      if (!imageNode || imageNode.type !== "image") return;
      const promptId = `prompt-${Date.now()}`;
      setNodes((nds) => [
        ...nds,
        {
          id: promptId,
          type: "prompt" as const,
          position: { x: imageNode.position.x + 240, y: imageNode.position.y + 20 },
          data: {
            prompt: "",
            size: config.sizes[0]?.value ?? "1024x1024",
            quality: config.qualities[0] ?? "low",
            outputDir: config.defaultOutputDir,
            status: "idle" as const,
          },
        },
      ]);
      setEdges((eds) => [...eds, { id: `edge-${Date.now()}`, source: imageNodeId, target: promptId }]);
      pushLog("已创建提示词卡片并连线该图片");
    },
    [config, setNodes, setEdges, pushLog],
  );

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
    [setNodes, pushLog],
  );

  const handleRun = useCallback(
    (nodeId: string) => {
      void runNodeInternal(nodeId);
    },
    [runNodeInternal],
  );

  const handleRunAll = useCallback(async () => {
    const promptNodes = nodesRef.current.filter((n) => n.type === "prompt");
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
  }, [runNodeInternal, pushLog]);

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
      image: (props: object) => (
        <ImageNode
          {...(props as React.ComponentProps<typeof ImageNode>)}
          onReplace={handleReplaceImage}
          onDelete={handleDeleteNode}
          onZoom={handleZoom}
          onCreatePromptFromImage={handleCreatePromptFromImage}
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
      handleCreatePromptFromImage,
      sizeOptions,
      qualityOptions,
    ],
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
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => void handleImportDir()}>
          导入目录
        </button>
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={handleCreateGroup}>
          新建图片组
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
        <span className="text-muted text-xs">
          双击空白新建提示词节点 · 双击图片可放大/生成提示词卡片 · 图片可连提示词或图片组
        </span>
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

      {/* 保存工作流弹窗：固定目录 output/workflows/，只选名字 */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowSaveModal(false)}
        >
          <div
            className="w-[26rem] max-w-[92vw] rounded-lg bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">保存工作流</h3>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmSave();
              }}
              placeholder="输入工作流名字（存到 output/workflows/）"
              autoFocus
              className="field-control mb-3"
            />
            {workflows.length > 0 && (
              <div className="mb-3 max-h-36 overflow-auto rounded-lg border border-neutral-200">
                {workflows.map((w) => (
                  <button
                    key={w.name}
                    type="button"
                    onClick={() => setSaveName(w.name)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
                  >
                    <span className="truncate">{w.name}</span>
                    <span className="shrink-0 text-[10px] text-neutral-400">{w.modified}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setShowSaveModal(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn-primary !py-1 text-xs"
                disabled={!saveName.trim()}
                onClick={() => void confirmSave()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载工作流弹窗：列出已保存的工作流选择 */}
      {showLoadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowLoadModal(false)}
        >
          <div
            className="w-[26rem] max-w-[92vw] rounded-lg bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">加载工作流</h3>
            <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
              {workflows.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  onClick={() => void loadByName(w.name)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
                >
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-[10px] text-neutral-400">{w.modified}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setShowLoadModal(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 放大预览（图片双击菜单「放大预览」触发）：点遮罩任意处退出，名字显示在图片下方外部 */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 p-6"
          onClick={() => setZoomImage(null)}
        >
          <img
            src={`/api/image?path=${encodeURIComponent(zoomImage)}`}
            alt="预览"
            className="max-h-[80vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="mt-3 max-w-[80vw] truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {zoomName}
          </div>
          <div className="mt-1 text-[10px] text-white/50">点击空白处关闭</div>
        </div>
      )}
    </div>
  );
}
