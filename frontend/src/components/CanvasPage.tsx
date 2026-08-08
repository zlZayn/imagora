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
  const [logs, setLogs] = useState<string[]>([]);
  /** 高亮核验：悬停/选中的提示词节点（高亮其入边与关联图片） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const runningRef = useRef<Set<string>>(new Set());
  /** 放大预览：当前预览的图片绝对路径（null 关闭） */
  const [zoomImage, setZoomImage] = useState<string | null>(null);
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
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      if (source?.type === "image") {
        return target?.type === "prompt" || target?.type === "group";
      }
      if (source?.type === "group") {
        return target?.type === "prompt";
      }
      return false;
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

  /* ---------------- 引用计数 / 分组计数：由连线推导，随 edges 变化刷新 ---------------- */
  useEffect(() => {
    const { refCounts, groupCounts } = computeCounts(nodes, edges);
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
          if (n.data.imageCount !== count) {
            changed = true;
            return { ...n, data: { ...n.data, imageCount: count } };
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
    const first = selected[0];
    setHighlightId(first && first.type === "prompt" ? first.id : null);
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
  const handleZoom = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type === "image") {
        setZoomImage(node.data.absPath);
      }
    },
    [nodes],
  );

  /** 以某图片为参考：新建提示词卡片并自动连线（图片 -> 提示词） */
  const handleCreatePromptFromImage = useCallback(
    (imageNodeId: string) => {
      const imageNode = nodes.find((n) => n.id === imageNodeId);
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
    [nodes, config, setNodes, setEdges, pushLog],
  );

  /** 新建图片组节点（聚合多图后连到提示词统一管理） */
  const handleCreateGroup = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: `group-${Date.now()}`,
        type: "group" as const,
        position: { x: 280 + (nds.length % 6) * 30, y: 260 + (nds.length % 4) * 30 },
        data: { name: "图片组", imageCount: 0 },
      },
    ]);
    pushLog("已新建图片组，把图片连进来即可");
  }, [setNodes, pushLog]);

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

      {/* 放大预览（图片双击菜单「放大预览」触发） */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setZoomImage(null)}
        >
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={`/api/image?path=${encodeURIComponent(zoomImage)}`}
              alt="预览"
              className="max-h-[78vh] max-w-[84vw] object-contain"
            />
            <div className="mt-2 flex justify-end gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500" title={zoomImage}>
                {zoomImage}
              </span>
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setZoomImage(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
