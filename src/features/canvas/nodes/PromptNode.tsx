import { memo, useCallback, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { ClipboardList, Trash2, Copy, Check, Plus, ArrowLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type PromptNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type PromptNodeProps = NodeProps & {
  id: string;
  data: PromptNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 380;
const MIN_WIDTH = 260;
const MIN_HEIGHT = 200;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;

export const PromptNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: PromptNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  // 从全局 persisted 状态管理库 settingsStore 读取通用提示词数据和操作 API
  const globalPrompts = useSettingsStore((state) => state.globalPrompts) ?? [];
  const addGlobalPrompt = useSettingsStore((state) => state.addGlobalPrompt);
  const updateGlobalPrompt = useSettingsStore((state) => state.updateGlobalPrompt);
  const deleteGlobalPrompt = useSettingsStore((state) => state.deleteGlobalPrompt);

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.prompt, data);
  const resolvedWidth = Math.max(MIN_WIDTH, Math.round(width ?? DEFAULT_WIDTH));
  const resolvedHeight = Math.max(MIN_HEIGHT, Math.round(height ?? DEFAULT_HEIGHT));

  // 内部双层视图跳转控制：activePromptId 为 null 表示标题列表页，非 null 表示该项的详情编辑页
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 获取当前查看详情的提示词项
  const activePrompt = globalPrompts.find((item) => item.id === activePromptId);

  // 一键复制提示词到剪贴板并附带微动提示
  const handleCopy = useCallback((itemId: string, content: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation(); // 阻止穿透，防止在列表视图点击复制按钮时跳转进入详情页
    }
    if (!content.trim()) {
      return;
    }
    void navigator.clipboard.writeText(content);
    setCopiedId(itemId);
    setTimeout(() => {
      setCopiedId(null);
    }, 1500);
  }, []);

  // 新增提示词项并直接跳转进它的详情编辑页
  const handleAddNewPrompt = useCallback(() => {
    const newId = addGlobalPrompt('', '');
    setActivePromptId(newId);
    setShowDeleteConfirm(false);
  }, [addGlobalPrompt]);

  // 返回列表并重置二次确认状态
  const handleBackToList = useCallback(() => {
    setActivePromptId(null);
    setShowDeleteConfirm(false);
  }, []);

  // 删除当前正编辑的提示词项并返回列表
  const handleDeleteActivePrompt = useCallback(() => {
    if (activePromptId) {
      deleteGlobalPrompt(activePromptId);
      setActivePromptId(null);
      setShowDeleteConfirm(false);
    }
  }, [activePromptId, deleteGlobalPrompt]);

  return (
    <div
      className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-1.5 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ClipboardList className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <NodeResizeHandle
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
      />

      {/* 主滚动交互区：nodrag nowheel 防止画布拖拽穿透干扰录入与滚动 */}
      <div className="nodrag nowheel flex flex-1 flex-col overflow-hidden px-1 py-1.5 pt-8">
        
        {activePromptId === null || !activePrompt ? (
          /* ==================== 1. 列表视图 (List View) ==================== */
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 custom-scrollbar">
              {globalPrompts.length > 0 ? (
                globalPrompts.map((item) => {
                  const isCopied = copiedId === item.id;
                  const displayTitle = item.title.trim() || '未命名提示词';
                  
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActivePromptId(item.id)}
                      className="group/item flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border-dark/30 bg-bg-dark/30 hover:bg-white/5 hover:border-accent/30 cursor-pointer transition-all duration-150"
                    >
                      {/* 左侧：图标 + 标题 */}
                      <div className="flex items-center gap-2 overflow-hidden flex-1">
                        <ClipboardList className="h-3.5 w-3.5 text-text-muted shrink-0 group-hover/item:text-accent transition-colors" />
                        <span className={`text-xs font-medium truncate ${item.title.trim() ? 'text-text-dark' : 'text-text-muted/50 italic'}`}>
                          {displayTitle}
                        </span>
                      </div>

                      {/* 右侧：复制图标或一键进入的箭头 */}
                      <div className="flex items-center gap-1 shrink-0">
                        {item.content.trim() && (
                          <button
                            onClick={(e) => handleCopy(item.id, item.content, e)}
                            className={`p-1.5 rounded transition-all duration-150
                              ${isCopied
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                                : 'hover:bg-white/10 text-text-muted hover:text-text-dark'}`}
                            title="复制这组提示词"
                          >
                            {isCopied ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-text-muted/40 group-hover/item:text-text-muted/80 transition-colors" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted/40 text-xs">
                  <ClipboardList className="h-8 w-8 mb-2 stroke-[1.2]" />
                  <span>暂无常用提示词，点击下方按钮添加</span>
                </div>
              )}
            </div>

            {/* 底部新增常用提示词大按钮 */}
            <button
              onClick={handleAddNewPrompt}
              className="mt-2 flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg border border-dashed border-border-dark/60 bg-bg-dark/30 hover:bg-white/5 text-xs text-text-muted hover:text-text-dark transition-all duration-150 font-medium active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              <span>{t('node.prompt.addBtn')}</span>
            </button>
          </div>
        ) : (
          /* ==================== 2. 详情视图 (Detail View) ==================== */
          <div className="flex flex-col flex-1 overflow-hidden space-y-3">
            {/* 头部返回控制 */}
            <div className="flex items-center">
              <button
                onClick={handleBackToList}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-dark font-medium transition-colors py-1 px-1.5 rounded hover:bg-white/5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>返回列表</span>
              </button>
            </div>

            {/* 编辑主体卡片 */}
            <div className="flex-1 flex flex-col space-y-2.5 rounded-lg border border-border-dark/45 bg-bg-dark/45 p-3">
              {/* 提示词标题编辑 */}
              <div className="flex flex-col space-y-1">
                <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">提示词分类标题</span>
                <input
                  type="text"
                  className="w-full bg-transparent text-xs font-semibold text-text-dark outline-none border-b border-border-dark/40 focus:border-accent/40 pb-1.5"
                  placeholder={t('node.prompt.titlePlaceholder')}
                  value={activePrompt.title}
                  onChange={(e) => updateGlobalPrompt(activePrompt.id, { title: e.target.value })}
                />
              </div>

              {/* 提示词内容编辑 */}
              <div className="flex-1 flex flex-col space-y-1 overflow-hidden">
                <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">提示词详细内容</span>
                <textarea
                  className="w-full flex-1 bg-transparent text-xs text-text-muted leading-relaxed outline-none placeholder:text-text-muted/30 resize-none pr-1 custom-scrollbar focus:text-text-dark transition-colors"
                  placeholder={t('node.prompt.placeholder')}
                  value={activePrompt.content}
                  onChange={(e) => updateGlobalPrompt(activePrompt.id, { content: e.target.value })}
                />
              </div>
            </div>

            {/* 详情操作底部工具条 */}
            <div className="flex items-center justify-between gap-3 pt-1">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1 bg-rose-500/10 rounded-lg p-0.5 border border-rose-500/20 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    onClick={handleDeleteActivePrompt}
                    className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-all duration-150"
                  >
                    确认删除
                  </button>
                  <div className="h-3.5 w-[1px] bg-rose-500/30" />
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-dark transition-all duration-150"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-text-muted hover:bg-rose-500/10 hover:text-rose-400 border border-transparent hover:border-rose-500/20 transition-all duration-150"
                  title="永久删除此提示词"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>删除</span>
                </button>
              )}

              <button
                onClick={() => handleCopy(activePrompt.id, activePrompt.content)}
                className={`flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-semibold shadow-sm transition-all duration-150 active:scale-[0.98] border
                  ${copiedId === activePrompt.id
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-accent/15 text-accent hover:bg-accent/25 border-accent/20 hover:border-accent/40'}`}
              >
                {copiedId === activePrompt.id ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{t('node.prompt.copySuccess')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>一键复制</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

PromptNode.displayName = 'PromptNode';
