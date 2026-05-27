import { useState, useRef } from 'react';
import { Paperclip, Send, Image as ImageIcon, Video, FileText, Music, X } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string, files: File[]) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 40), 200)}px`;
    }
  };

  const handleSend = () => {
    if (!text.trim() && files.length === 0) return;
    onSend(text, files);
    setText('');
    setFiles([]);
    setTimeout(adjustHeight, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const newFiles = Array.from(selectedFiles);
      setFiles((prev) => [...prev, ...newFiles]);
    }
    // reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const renderFileIcon = (file: File) => {
    const nameLower = file.name.toLowerCase();
    if (file.type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-blue-400" />;
    if (file.type.startsWith('video/')) return <Video className="w-4 h-4 text-purple-400" />;
    if (file.type.startsWith('audio/')) return <Music className="w-4 h-4 text-orange-400" />;
    if (nameLower.endsWith('.pdf')) return <FileText className="w-4 h-4 text-red-500" />;
    if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc')) return <FileText className="w-4 h-4 text-blue-500" />;
    if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) return <FileText className="w-4 h-4 text-green-600" />;
    return <FileText className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="flex flex-col border-t border-gray-200 bg-white/95 p-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 max-h-[80px] overflow-y-auto">
          {files.map((file, i) => (
            <div key={`${file.name}-${file.size}-${i}`} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700">
              {renderFileIcon(file)}
              <span className="truncate max-w-[120px]">{file.name}</span>
              <button onClick={() => removeFile(i)} className="p-0.5 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="Upload attachments"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,video/*,audio/*,text/plain,.md,.docx,.doc,.pdf,.xlsx,.xls"
        />
        
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="输入消息，使用 /imagine 生成图片，Shift + Enter 换行..."
          className="flex-1 max-h-[200px] min-h-[40px] bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-blue-500/60 focus:bg-white resize-y custom-scrollbar transition-colors"
          style={{ height: '40px' }}
          rows={1}
        />
        
        <button
          onClick={handleSend}
          disabled={disabled || (!text.trim() && files.length === 0)}
          className="p-2 bg-blue-600/80 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-30 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
