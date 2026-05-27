import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { FileText, Bot, User } from 'lucide-react';
import type { ChatMessage, ChatAttachment } from '@/stores/chatStore';

interface ChatMessageListProps {
  messages: ChatMessage[];
  isGenerating?: boolean;
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.type === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block mt-2">
        <img
          src={attachment.url}
          alt={attachment.name || 'Image attachment'}
          className="max-w-[200px] max-h-[150px] rounded-md object-cover border border-white/10 hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }

  if (attachment.type === 'video') {
    return (
      <div className="mt-2 text-xs text-purple-700 bg-purple-50 p-2 rounded border border-purple-200 inline-flex items-center gap-1">
        <span>🎬 Video: {attachment.name}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 text-xs text-blue-700 bg-blue-50 p-2 rounded border border-blue-200 inline-flex items-center gap-1">
      <FileText className="w-3 h-3 text-blue-500" />
      <span>File: {attachment.name}</span>
    </div>
  );
}

export function ChatMessageList({ messages, isGenerating }: ChatMessageListProps) {
  const visibleMessages = messages.filter((msg) => msg.role !== 'system');

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 custom-scrollbar">
      {visibleMessages.length === 0 && (
        <div className="text-center text-gray-400 mt-10 text-sm font-medium">
          暂无消息。发送消息开始与智能体对话吧！
        </div>
      )}
      
      {visibleMessages.map((msg) => {
        const isAssistant = msg.role === 'assistant';
        const isError = isAssistant && msg.content && (msg.content.startsWith('发送失败') || msg.content.includes('发送失败') || msg.content.includes('API Error'));

        // 样式智能分流
        let bubbleClass = '';
        let proseClass = '';
        
        if (isError) {
          // 遵循用户指令：背景优化为浅色（淡雅温馨的浅玫瑰色），字体为绝对清晰的黑色
          bubbleClass = 'bg-rose-100/95 border border-rose-300 rounded-tl-none text-gray-900 shadow-md';
          proseClass = 'prose-stone text-gray-950 font-semibold';
        } else if (isAssistant) {
          // 整体优化浅色：机器人回复采用优雅乳白配高级石板灰黑字
          bubbleClass = 'bg-white border border-gray-200 rounded-tl-none text-gray-800 shadow-sm';
          proseClass = 'prose-slate text-gray-800';
        } else {
          // 整体优化浅色：用户消息采用温暖精美的冰蓝色气泡，搭配深蓝黑色字体
          bubbleClass = 'bg-blue-50 border border-blue-150 rounded-tr-none text-blue-950 shadow-sm';
          proseClass = 'prose-slate text-blue-950 font-medium';
        }

        return (
          <div key={msg.id} className={`flex gap-3 ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isAssistant ? 'bg-blue-100 text-blue-600 border border-blue-200' : 'bg-green-100 text-green-600 border border-green-200'}`}>
              {isAssistant ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
            
            <div className={`max-w-[85%] rounded-lg p-3 ${bubbleClass}`}>
              <div className={`prose ${proseClass} prose-sm max-w-none break-words overflow-hidden [&_p]:text-[13px] [&_p]:leading-relaxed [&_li]:text-[13px] [&_li]:leading-relaxed [&_h1]:text-[14px] [&_h2]:text-[14px] [&_h3]:text-[14px] [&_p]:my-1 [&_li]:my-0.5 [&_ul]:my-1 [&_ol]:my-1`}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                  {msg.content}
                </ReactMarkdown>
              </div>

              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {msg.attachments.map((att, i) => (
                    <AttachmentPreview key={i} attachment={att} />
                  ))}
                </div>
              )}

              {msg.generatedImageUrl && (
                <div className="mt-3">
                  <a href={msg.generatedImageUrl} target="_blank" rel="noreferrer">
                    <img
                      src={msg.generatedImageUrl}
                      alt="Generated"
                      className="max-w-full rounded-md border border-white/10 shadow-lg"
                    />
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {isGenerating && (
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 animate-pulse" />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg rounded-tl-none p-3 px-4 flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}
    </div>
  );
}
