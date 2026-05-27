import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export interface ChatAttachment {
  type: 'image' | 'video' | 'file' | 'pdf' | 'audio';
  url: string; // data URL or path
  name?: string;
  size?: number;
  content?: string; // 存储文本、代码或文档类文件的文本内容，用于多模态注入
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachment[];
  generatedImageUrl?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface ChatGemFile {
  name: string;
  type: string;
  content: string; // 文本内容或 base64
}

export interface ChatGem {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  knowledgeFiles: ChatGemFile[];
  disableKnowledge: boolean;
  createdAt: number;
}

interface ChatState {
  isOpen: boolean;
  isGenerating: boolean;
  sessions: ChatSession[];
  currentSessionId: string | null;
  gems: ChatGem[];
  setIsOpen: (isOpen: boolean) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  createNewSession: (initialTitle?: string, initialSystemPrompt?: string) => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, newTitle: string) => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  updateMessage: (id: string, partial: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  
  // 智能体管理方法
  addGem: (
    name: string, 
    description: string, 
    systemPrompt: string, 
    knowledgeFiles: ChatGemFile[], 
    disableKnowledge: boolean
  ) => void;
  updateGem: (
    id: string,
    name: string,
    description: string,
    systemPrompt: string,
    knowledgeFiles: ChatGemFile[],
    disableKnowledge: boolean
  ) => void;
  deleteGem: (id: string) => void;
}

const DEFAULT_GEMS: ChatGem[] = [
  {
    id: 'default-gem-1',
    name: 'Seedance2.0运镜提示词',
    description: '专业的电影镜头和运镜描述词自动转化应用',
    systemPrompt: '你是一个运镜专家。根据用户输入的故事场景或分镜说明，提供专业的运镜提示词（例如：推、拉、摇、移、特写、俯拍等），使用生动且简短的中文格式输出。',
    knowledgeFiles: [],
    disableKnowledge: false,
    createdAt: 1779058440,
  },
  {
    id: 'default-gem-2',
    name: 'Seedance 2.0 视频素材提示词',
    description: '用于生成视频大模型所需的极精细画面和运镜提示词',
    systemPrompt: '你是一个AI视频生成大师。你的任务是将用户的中文描述转化为高质量的AI视频生成提示词。请提供画面主体、灯光、色彩、质感及微表情等描述，并用结构化的语言输出。',
    knowledgeFiles: [],
    disableKnowledge: false,
    createdAt: 1779058440,
  }
];

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      isOpen: false,
      isGenerating: false,
      sessions: [],
      currentSessionId: null,
      gems: DEFAULT_GEMS,
      
      setIsOpen: (isOpen) => set({ isOpen }),
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      
      createNewSession: (initialTitle, initialSystemPrompt) => {
        set((state) => {
          // 如果没有智能体设定，且当前第一个 session 已经是空的“新对话”，则直接切换过去，不重复创建
          if (!initialSystemPrompt && state.sessions.length > 0 && state.sessions[0].messages.length === 0) {
             return { currentSessionId: state.sessions[0].id };
          }
          const newSessionId = uuidv4();
          const initialMessages: ChatMessage[] = initialSystemPrompt 
            ? [{ id: uuidv4(), role: 'system', content: initialSystemPrompt, createdAt: Date.now() }]
            : [];
          return {
            sessions: [
              {
                id: newSessionId,
                title: initialTitle || '新对话',
                messages: initialMessages,
                updatedAt: Date.now(),
              },
              ...state.sessions,
            ],
            currentSessionId: newSessionId,
          };
        });
      },

      switchSession: (id) => set({ currentSessionId: id }),
      
      deleteSession: (id) => set((state) => {
         const newSessions = state.sessions.filter(s => s.id !== id);
         let newCurrentId = state.currentSessionId;
         if (newCurrentId === id) {
           newCurrentId = newSessions.length > 0 ? newSessions[0].id : null;
         }
         return { sessions: newSessions, currentSessionId: newCurrentId };
      }),

      renameSession: (id, newTitle) => set((state) => {
         const sessions = [...state.sessions];
         const sessionIndex = sessions.findIndex(s => s.id === id);
         if (sessionIndex !== -1) {
           sessions[sessionIndex] = { ...sessions[sessionIndex], title: newTitle, updatedAt: Date.now() };
           return { sessions };
         }
         return state;
      }),

      addMessage: (message) => {
        const id = uuidv4();
        const newMessage = { ...message, id, createdAt: Date.now() };

        set((state) => {
          let sessionId = state.currentSessionId;
          const sessions = [...state.sessions];
          
          if (!sessionId) {
            sessionId = uuidv4();
            const newTitle = message.role === 'user' ? (message.content.slice(0, 15) || '新对话') : '新对话';
            sessions.unshift({
              id: sessionId,
              title: newTitle,
              messages: [newMessage],
              updatedAt: Date.now(),
            });
            return { sessions, currentSessionId: sessionId };
          } else {
            const sessionIndex = sessions.findIndex(s => s.id === sessionId);
            if (sessionIndex !== -1) {
              const session = sessions[sessionIndex];
              const userMsgs = session.messages.filter(m => m.role !== 'system');
              const updatedSession = { ...session, messages: [...session.messages, newMessage], updatedAt: Date.now() };
              
              if (userMsgs.length === 0 && message.role === 'user') {
                 updatedSession.title = message.content.slice(0, 15) || '新对话';
              }
              
              sessions[sessionIndex] = updatedSession;
              
              if (sessionIndex > 0) {
                 const [active] = sessions.splice(sessionIndex, 1);
                 sessions.unshift(active);
              }
              
              return { sessions };
            }
          }
          return state;
        });
        return id;
      },

      updateMessage: (id, partial) =>
        set((state) => {
            const sessionId = state.currentSessionId;
            if (!sessionId) return state;
            
            const sessions = [...state.sessions];
            const sessionIndex = sessions.findIndex(s => s.id === sessionId);
            if (sessionIndex !== -1) {
              const session = sessions[sessionIndex];
              const updatedSession = {
                ...session,
                messages: session.messages.map((msg) =>
                  msg.id === id ? { ...msg, ...partial } : msg
                ),
                updatedAt: Date.now(),
              };
              sessions[sessionIndex] = updatedSession;
              return { sessions };
            }
            return state;
        }),

      clearMessages: () => set((state) => {
          const sessionId = state.currentSessionId;
          if (!sessionId) return state;
          const sessions = [...state.sessions];
          const sessionIndex = sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex !== -1) {
            sessions[sessionIndex] = { ...sessions[sessionIndex], messages: [], updatedAt: Date.now() };
            return { sessions };
          }
          return state;
      }),
      
      addGem: (name, description, systemPrompt, knowledgeFiles, disableKnowledge) => set((state) => ({
        gems: [
          ...state.gems,
          {
            id: uuidv4(),
            name,
            description,
            systemPrompt,
            knowledgeFiles,
            disableKnowledge,
            createdAt: Date.now(),
          }
        ]
      })),
      
      updateGem: (id, name, description, systemPrompt, knowledgeFiles, disableKnowledge) => set((state) => {
        const gems = [...state.gems];
        const idx = gems.findIndex(g => g.id === id);
        if (idx !== -1) {
          gems[idx] = {
            ...gems[idx],
            name,
            description,
            systemPrompt,
            knowledgeFiles,
            disableKnowledge,
          };
          return { gems };
        }
        return state;
      }),

      deleteGem: (id) => set((state) => ({
        gems: state.gems.filter(g => g.id !== id)
      })),
    }),
    {
      name: 'chat-storage',
      version: 4, // 升级为 4
      partialize: (state) => {
        // 深度脱水保护：在持久化到 LocalStorage 前，自动剔除所有超大 Base64 图片数据和文档 RAG 内容，防御 QuotaExceededError 5MB 物理爆仓！
        const dehydratedSessions = state.sessions.map((session) => ({
          ...session,
          messages: session.messages.map((msg) => ({
            ...msg,
            attachments: msg.attachments?.map((att) => ({
              ...att,
              // 如果附件是 Base64 大图，只保留轻量级名字和占位说明，不保存巨大 Base64
              url: att.url?.startsWith('data:') ? `[已安全脱水过滤的 Base64 图片占位符]` : att.url,
              // 文本文档的 RAG content 内容也只在发送时起效，无须在 LocalStorage 中重复存盘
              content: undefined,
            })),
          })),
        }));

        return {
          sessions: dehydratedSessions,
          currentSessionId: state.currentSessionId,
          gems: state.gems,
        };
      },
      migrate: (persistedState: any, version: number) => {
        let state = persistedState;
        if (version === 1) {
          const oldState = persistedState as any;
          const oldMessages = oldState.messages || [];
          if (oldMessages.length > 0) {
            const defaultSession: ChatSession = {
              id: uuidv4(),
              title: '历史对话',
              messages: oldMessages,
              updatedAt: Date.now(),
            };
            state = {
              sessions: [defaultSession],
              currentSessionId: defaultSession.id,
            } as any;
          } else {
            state = { sessions: [], currentSessionId: null } as any;
          }
        }
        
        // V2/V3 to V4 migration: Add description and knowledge parameters
        const typedState = state as any;
        if (!typedState.gems || typedState.gems.length === 0) {
           typedState.gems = DEFAULT_GEMS;
        } else {
           typedState.gems = typedState.gems.map((g: any) => ({
              ...g,
              id: g.id || uuidv4(),
              name: g.name || '新 Gem',
              description: g.description || '',
              systemPrompt: g.systemPrompt || '',
              knowledgeFiles: g.knowledgeFiles || [],
              disableKnowledge: g.disableKnowledge !== undefined ? g.disableKnowledge : false,
              createdAt: g.createdAt || Date.now(),
           }));
        }
        return typedState;
      },
    }
  )
);

// 自动清洗陈旧 LocalStorage 爆仓数据的顶级自愈引擎
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = localStorage.getItem('chat-storage');
    if (raw && raw.length > 1.5 * 1024 * 1024) { // 如果历史数据超过 1.5MB
      console.warn('[ChatStorage] Detected oversized storage, auto-clearing base64 URLs...');
      const parsed = JSON.parse(raw);
      if (parsed.state && parsed.state.sessions) {
        parsed.state.sessions = parsed.state.sessions.map((session: any) => ({
          ...session,
          messages: session.messages.map((msg: any) => ({
            ...msg,
            attachments: msg.attachments?.map((att: any) => ({
              ...att,
              url: att.url?.startsWith('data:') ? '[已自愈清洗的陈旧 Base64 图片]' : att.url,
              content: undefined,
            })),
          })),
        }));
        localStorage.setItem('chat-storage', JSON.stringify(parsed));
        console.log('[ChatStorage] Auto-clear oversized storage succeeded.');
      }
    }
  }
} catch (e) {
  console.error('[ChatStorage] Failed to run oversized storage auto-clear:', e);
}
