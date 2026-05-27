import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, Sparkles, SquarePen, MessageSquare, Trash2, Pencil, Plus, Gem, Heart, Info, Undo, Redo, CircleAlert, X, Check } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { sendMessage } from '../application/chatService';

export function AIChatbot() {
  const isOpen = useChatStore((state) => state.isOpen);
  const setIsOpen = useChatStore((state) => state.setIsOpen);
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const isGenerating = useChatStore((state) => state.isGenerating);
  
  const createNewSession = useChatStore((state) => state.createNewSession);
  const switchSession = useChatStore((state) => state.switchSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const renameSession = useChatStore((state) => state.renameSession);

  // 智能体相关
  const gems = useChatStore((state) => state.gems);
  const addGem = useChatStore((state) => state.addGem);
  const updateGem = useChatStore((state) => state.updateGem);
  const deleteGem = useChatStore((state) => state.deleteGem);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.1-pro-preview');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  
  // 新建侧边栏智能体与对话的删除确认状态
  const [deletingGemId, setDeletingGemId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // 新建/修改智能体弹窗状态
  const [isCreateGemOpen, setIsCreateGemOpen] = useState(false);
  const [editingGemId, setEditingGemId] = useState<string | null>(null);
  const [gemName, setGemName] = useState('');
  const [gemDescription, setGemDescription] = useState('');
  const [gemPrompt, setGemPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [disableKnowledge, setDisableKnowledge] = useState(false);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  // 撤销重做提示词栈
  const [gemPromptHistory, setGemPromptHistory] = useState<string[]>([]);
  const [gemPromptRedoHistory, setGemPromptRedoHistory] = useState<string[]>([]);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession ? currentSession.messages : [];

  const startEditing = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingSessionId(id);
    setEditTitleValue(currentTitle);
  };

  const handleRename = (id: string) => {
    if (editTitleValue.trim()) {
      renameSession(id, editTitleValue.trim());
    }
    setEditingSessionId(null);
  };

  const handleKeyDownRename = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleRename(id);
    } else if (e.key === 'Escape') {
      setEditingSessionId(null);
    }
  };

  // 知识库文件解析上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setUploadedFiles((prev) => [
          ...prev,
          {
            name: file.name,
            type: file.type,
            content: text || '',
          },
        ]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  // 指令撤销
  const handleUndo = () => {
    if (gemPromptHistory.length > 0) {
      const prev = gemPromptHistory[gemPromptHistory.length - 1];
      setGemPromptRedoHistory((redo) => [...redo, gemPrompt]);
      setGemPrompt(prev);
      setGemPromptHistory((hist) => hist.slice(0, -1));
    }
  };

  // 指令重做
  const handleRedo = () => {
    if (gemPromptRedoHistory.length > 0) {
      const next = gemPromptRedoHistory[gemPromptRedoHistory.length - 1];
      setGemPromptHistory((hist) => [...hist, gemPrompt]);
      setGemPrompt(next);
      setGemPromptRedoHistory((redo) => redo.slice(0, -1));
    }
  };

  // AI 润色小彩蛋
  const handleAISparkle = () => {
    if (!gemPrompt.trim()) {
      setGemPrompt(
        '你是一位专业的园艺师，熟悉天然草坪和本土植物，可以帮助人们规划水源合理的庭园。你需要考虑地理位置、气候条件，以及当地 of 本土植物。你的专业背景能提供高度准确、环保的园艺指导。'
      );
    } else {
      setGemPrompt((prev) => prev.trim() + ' 作为一名顶尖的专业智能体，请始终确保你的回答条理井然、重点精确、论述客观，并优先满足用户的核心诉求。');
    }
  };

  // 保存/修改智能体应用
  const handleSaveGem = () => {
    setHasAttemptedSave(true);
    if (!gemName.trim()) {
      return;
    }

    if (editingGemId) {
      updateGem(
        editingGemId,
        gemName.trim(),
        gemDescription.trim(),
        gemPrompt.trim(),
        uploadedFiles,
        disableKnowledge
      );
    } else {
      addGem(
        gemName.trim(),
        gemDescription.trim(),
        gemPrompt.trim(),
        uploadedFiles,
        disableKnowledge
      );
    }

    // 重置并关闭
    setIsCreateGemOpen(false);
    setEditingGemId(null);
    setGemName('');
    setGemDescription('');
    setGemPrompt('');
    setUploadedFiles([]);
    setDisableKnowledge(false);
    setHasAttemptedSave(false);
    setGemPromptHistory([]);
    setGemPromptRedoHistory([]);
  };

  // 当消息更新时滚动到底部
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      const list = scrollRef.current.querySelector('.custom-scrollbar');
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    }
  }, [messages, isGenerating, isOpen, currentSessionId]);

  const handleSend = async (text: string, files: File[]) => {
    try {
      console.log('[AIChatbot] Starting to send message via handleSend:', { text, filesCount: files.length, model: selectedModel });
      await sendMessage(text, files, selectedModel);
      console.log('[AIChatbot] handleSend completed successfully.');
    } catch (err) {
      console.error('[AIChatbot] handleSend met a critical error:', err);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="absolute bottom-6 left-6 z-50 p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-xl shadow-black/50 transition-transform hover:scale-105 active:scale-95 flex items-center gap-2 group"
      >
        <Bot className="w-6 h-6 group-hover:animate-bounce" />
        <span className="font-medium pr-1">知晓AI对话</span>
      </button>
    );
  }

  return (
    <div 
      className="absolute bottom-6 left-6 z-50 w-[700px] h-[600px] min-w-[500px] max-w-[90vw] min-h-[400px] max-h-[85vh] flex flex-row bg-white/95 backdrop-blur-xl border border-gray-200/90 rounded-2xl shadow-2xl shadow-gray-400/30 overflow-hidden resize animate-fade-in"
    >
      {/* Sidebar */}
      <div className="w-[200px] flex-shrink-0 border-r border-gray-200/85 bg-gray-50/70 flex flex-col">
        <div className="p-3">
          <button 
            onClick={() => createNewSession()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm shadow-blue-500/10 transition-colors text-sm font-medium"
          >
            <SquarePen className="w-4 h-4" />
            发起新对话
          </button>
        </div>
        
        {/* 我的智能体分类 */}
        <div className="px-3 py-1.5 flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wider select-none">
          <span>我的智能体</span>
          <button 
            onClick={() => {
              setEditingGemId(null);
              setGemName('');
              setGemDescription('');
              setGemPrompt('');
              setUploadedFiles([]);
              setDisableKnowledge(false);
              setHasAttemptedSave(false);
              setGemPromptHistory([]);
              setGemPromptRedoHistory([]);
              setIsCreateGemOpen(true);
            }}
            className="p-1 hover:bg-gray-200/60 rounded text-gray-400 hover:text-gray-800 transition-colors"
            title="添加智能体应用"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        
        <div className="px-2 pb-2 space-y-1.5 max-h-[180px] overflow-y-auto custom-scrollbar border-b border-gray-200/40">
          {gems?.map((gem) => (
            <div
              key={gem.id}
              onClick={() => createNewSession(gem.name, gem.systemPrompt)}
              className="group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors text-sm"
              title={gem.description ? `${gem.name}\n${gem.description}` : gem.name}
            >
              <div className="flex flex-col overflow-hidden flex-1 mr-1">
                <div className="flex items-center gap-2">
                  <Gem className="w-3.5 h-3.5 shrink-0 text-blue-500 group-hover:animate-pulse" />
                  <span className="truncate font-medium">{gem.name}</span>
                </div>
                {gem.description && (
                  <span className="text-[10px] text-gray-400 truncate pl-5 transition-colors group-hover:text-gray-500">
                    {gem.description}
                  </span>
                )}
              </div>
              <div className={`flex items-center gap-1 shrink-0 ${deletingGemId === gem.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
                {deletingGemId === gem.id ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGem(gem.id);
                        setDeletingGemId(null);
                      }}
                      className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-600 transition-all"
                      title="确认删除此智能体"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingGemId(null);
                      }}
                      className="p-1 hover:bg-gray-200/60 rounded text-gray-500 hover:text-gray-800 transition-all"
                      title="取消"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGemId(gem.id);
                        setGemName(gem.name);
                        setGemDescription(gem.description || '');
                        setGemPrompt(gem.systemPrompt);
                        setUploadedFiles(gem.knowledgeFiles || []);
                        setDisableKnowledge(gem.disableKnowledge || false);
                        setGemPromptHistory([]);
                        setGemPromptRedoHistory([]);
                        setHasAttemptedSave(false);
                        setIsCreateGemOpen(true);
                      }}
                      className="p-1 hover:bg-gray-200/60 rounded text-gray-500 hover:text-gray-800 transition-all"
                      title="修改智能体"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingGemId(gem.id);
                      }}
                      className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-600 transition-all"
                      title="删除此智能体"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {(!gems || gems.length === 0) && (
            <div className="text-center py-3 text-xs text-gray-400 italic">
              暂无智能体，点击 + 创建
            </div>
          )}
        </div>
 
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          对话
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {sessions.map((session) => (
            <div 
              key={session.id}
              onClick={() => {
                if (editingSessionId !== session.id) {
                  switchSession(session.id);
                }
              }}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${
                currentSessionId === session.id 
                  ? 'bg-blue-50 text-blue-600 font-semibold border-l-2 border-blue-500 shadow-sm' 
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
                <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                {editingSessionId === session.id ? (
                  <input
                    autoFocus
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onBlur={() => handleRename(session.id)}
                    onKeyDown={(e) => handleKeyDownRename(e, session.id)}
                    className="flex-1 bg-white border border-blue-400 rounded px-1.5 py-0.5 text-sm text-gray-800 outline-none w-full min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate">{session.title}</span>
                )}
              </div>
              
              {editingSessionId !== session.id && (
                <div className={`flex items-center gap-1 shrink-0 ${deletingSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
                  {deletingSessionId === session.id ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                          setDeletingSessionId(null);
                        }}
                        className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-600 transition-all"
                        title="确认删除此会话"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingSessionId(null);
                        }}
                        className="p-1 hover:bg-gray-200/60 rounded text-gray-500 hover:text-gray-800 transition-all"
                        title="取消"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => startEditing(e, session.id, session.title)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-800 transition-all"
                        title="重命名"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingSessionId(session.id);
                        }}
                        className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-600 transition-all"
                        title="删除会话"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
 
      {/* Main Chat Area */}
      <div ref={scrollRef} className="flex-1 flex flex-col min-w-0 bg-gray-50/20">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/80 bg-white/95">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 rounded-md text-blue-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-gray-800 tracking-wide truncate max-w-[200px]">
              {currentSession?.title || '知晓AI对话'}
            </h3>
          </div>
          
          <div className="flex items-center gap-2">
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-700 outline-none focus:border-blue-500/60"
            >
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
              <option value="gpt-5.5">gpt-5.5</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            </select>
 
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 text-gray-500 hover:text-gray-800 rounded-md transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Message List */}
        <ChatMessageList messages={messages} isGenerating={isGenerating} />

        {/* Input Area */}
        <ChatInput onSend={handleSend} disabled={isGenerating} />
      </div>

      {/* 新建智能体弹窗 (Create Gem Dialog Overlay) - 使用 React Portal 挂载到 document.body 彻底突破高度限制 */}
      {isCreateGemOpen && createPortal(
        <div 
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => {
            setIsCreateGemOpen(false);
            setEditingGemId(null);
            setGemName('');
            setGemDescription('');
            setGemPrompt('');
            setUploadedFiles([]);
            setDisableKnowledge(false);
            setHasAttemptedSave(false);
            setGemPromptHistory([]);
            setGemPromptRedoHistory([]);
          }}
        >
          <div 
            className="w-[460px] max-h-[90vh] bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col text-gray-800 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0 bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-700 shadow-inner">
                  <Heart className="w-5 h-5 fill-current text-gray-500" />
                </div>
                <span className="text-base font-bold text-gray-900">{editingGemId ? '修改智能体' : '新智能体'}</span>
              </div>
              <button
                onClick={() => {
                  setIsCreateGemOpen(false);
                  setEditingGemId(null);
                  setGemName('');
                  setGemDescription('');
                  setGemPrompt('');
                  setUploadedFiles([]);
                  setDisableKnowledge(false);
                  setHasAttemptedSave(false);
                  setGemPromptHistory([]);
                  setGemPromptRedoHistory([]);
                }}
                className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-full transition-colors"
                title="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Contents - 设定严格的最大滚动高度保障按钮可见 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5 max-h-[60vh]">
              
              {/* 名称 */}
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-900">名称</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="为你的智能体命名"
                    value={gemName}
                    onChange={(e) => {
                      setGemName(e.target.value);
                      if (e.target.value.trim()) {
                         setHasAttemptedSave(false);
                      }
                    }}
                    className={`w-full bg-white border rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors ${
                      hasAttemptedSave && !gemName.trim()
                        ? 'border-red-500 focus:border-red-500 pr-10'
                        : 'border-gray-200 focus:border-blue-500/60'
                    }`}
                  />
                  {hasAttemptedSave && !gemName.trim() && (
                    <CircleAlert className="absolute right-3.5 top-3.5 w-4 h-4 text-red-500" />
                  )}
                </div>
                {hasAttemptedSave && !gemName.trim() && (
                  <p className="text-xs text-red-500 font-medium pl-1 animate-pulse">
                    你需要为智能体命名，然后才能开始测试。
                  </p>
                )}
              </div>

              {/* 说明 */}
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-900">说明</label>
                <input
                  type="text"
                  placeholder="介绍你的智能体并说明它的用途"
                  value={gemDescription}
                  onChange={(e) => setGemDescription(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500/60 focus:outline-none transition-colors"
                />
              </div>

              {/* 指令 */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-semibold text-gray-900">指令</label>
                  <div className="group relative">
                    <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-50 text-center">
                      设定智能体的行为模式与专业角色背景
                    </div>
                  </div>
                </div>
                <div className="relative border border-gray-200 rounded-xl focus-within:border-blue-500/60 bg-white overflow-hidden transition-colors">
                  <textarea
                    placeholder="例如：你是一位园艺师，熟悉天然草坪和本土植物，可以帮助人们规划水源合理的庭园。你需要考虑地理位置、气候条件，以及当地的本土植物..."
                    value={gemPrompt}
                    onChange={(e) => {
                      if (gemPrompt && gemPrompt !== e.target.value) {
                        setGemPromptHistory(prev => [...prev.slice(-20), gemPrompt]);
                      }
                      setGemPrompt(e.target.value);
                    }}
                    className="w-full h-32 bg-transparent px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none resize-none custom-scrollbar border-none"
                  />
                  {/* 编辑区左下角的 Undo, Redo, Sparkles 工具条 */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/50 border-t border-gray-100">
                    <button
                      type="button"
                      disabled={gemPromptHistory.length === 0}
                      onClick={handleUndo}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      title="撤销"
                    >
                      <Undo className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={gemPromptRedoHistory.length === 0}
                      onClick={handleRedo}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      title="重做"
                    >
                      <Redo className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleAISparkle}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-blue-500 hover:text-blue-600 transition-colors ml-auto"
                      title="AI 润色优化指令"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 知识 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-semibold text-gray-900">知识</label>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-50 text-center">
                        添加文本或文档，供智能体在问答中参考
                      </div>
                    </div>
                  </div>
                  
                  {/* 上传按钮 */}
                  <label 
                    htmlFor="gem-file-upload" 
                    className="p-1.5 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-lg cursor-pointer transition-colors"
                    title="添加参考文件"
                  >
                    <Plus className="w-4 h-4" />
                  </label>
                  <input
                    type="file"
                    id="gem-file-upload"
                    className="hidden"
                    multiple
                    accept=".txt,.md,.json,.js,.ts,.tsx,.html,.css"
                    onChange={handleFileUpload}
                  />
                </div>

                <div className="border border-gray-200 bg-gray-50/50 rounded-xl p-3 min-h-[70px] space-y-2">
                  {uploadedFiles.length === 0 ? (
                    <div className="text-center py-4 text-xs text-gray-400 select-none">
                      添加文件，供你的智能体在对话中参考。
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-1.5 max-h-[120px] overflow-y-auto custom-scrollbar">
                      {uploadedFiles.map((file, idx) => (
                        <div 
                          key={idx} 
                          className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs text-gray-700 shadow-sm"
                        >
                          <span className="truncate flex-1 font-medium mr-2">{file.name}</span>
                          <button 
                            type="button"
                            onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-600 p-0.5 hover:bg-red-50 rounded transition-colors shrink-0"
                            title="移除此知识文件"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 停用知识引用 */}
                <div className="flex items-center gap-2 pt-1 pl-1 select-none">
                  <input
                    type="checkbox"
                    id="disable-knowledge-check"
                    checked={disableKnowledge}
                    onChange={(e) => setDisableKnowledge(e.target.checked)}
                    className="w-4 h-4 border-gray-300 rounded text-blue-600 focus:ring-blue-500 focus:ring-2 transition-colors cursor-pointer"
                  />
                  <label 
                    htmlFor="disable-knowledge-check" 
                    className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer flex items-center gap-1 font-medium"
                  >
                    <span>停用知识引用</span>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-500 cursor-help" />
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-44 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-50 text-center">
                        勾选后，智能体将不参考上传的背景知识文件
                      </div>
                    </div>
                  </label>
                </div>

              </div>

            </div>

            {/* Footer Buttons - 永远放置于弹窗最底部 flex 布局中 */}
            <div className="flex justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={() => {
                  setIsCreateGemOpen(false);
                  setEditingGemId(null);
                  setGemName('');
                  setGemDescription('');
                  setGemPrompt('');
                  setUploadedFiles([]);
                  setDisableKnowledge(false);
                  setHasAttemptedSave(false);
                  setGemPromptHistory([]);
                  setGemPromptRedoHistory([]);
                }}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 rounded-xl transition-colors text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={handleSaveGem}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors text-sm font-semibold shadow-md shadow-blue-500/20"
              >
                {editingGemId ? '保存修改' : '保存创建'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
