// @ts-ignore
import * as mammoth from 'mammoth';
// @ts-ignore
import * as XLSX from 'xlsx';
// @ts-ignore
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

import { chatCompletion } from '@/commands/ai';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';

try {
  GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} catch (e) {
  console.warn('[ChatService] Failed to set PDF worker path:', e);
}

async function parseDocx(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || '';
  } catch (error) {
    console.error('Failed to parse docx:', error);
    return `[解析 Word 失败: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

async function parseExcel(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let text = '';
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      text += `--- 【工作表: ${sheetName}】 ---\n${csv}\n\n`;
    });
    return text.trim();
  } catch (error) {
    console.error('Failed to parse Excel:', error);
    return `[解析 Excel 失败: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

async function parsePdf(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += `--- 【第 ${i} 页】 ---\n${pageText}\n\n`;
    }
    return fullText.trim();
  } catch (error) {
    console.error('Failed to parse PDF:', error);
    return `[解析 PDF 失败: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

async function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file as base64'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File, maxW = 1024, maxH = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // 保持纵横比，如果超出最大宽高则等比例缩小
        if (width > maxW || height > maxH) {
          if (width > height) {
            height = Math.round((height * maxW) / width);
            width = maxW;
          } else {
            width = Math.round((width * maxH) / height);
            height = maxH;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // 将图片压缩并转换为 jpeg 格式，能减少 90% 以上的文件体积！
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(e.target?.result as string);
        }
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

export async function sendMessage(content: string, attachments: File[], model?: string) {
  const chatStore = useChatStore.getState();
  const settingsStore = useSettingsStore.getState();

  // 默认使用 12ai-text 作为普通对话提供商
  const textProvider = '12ai-text';
  const textConfig = settingsStore.providerConfigs[textProvider];

  // 极具防御性的顶层设计：立刻激活 UI 加载状态，且将整段处理流程全部包在 try-catch 中以防任何未捕获报错！
  chatStore.setIsGenerating(true);

  try {
    const processedAttachments = await Promise.all(
      attachments.map(async (file) => {
        let url = '';
        let textContent = '';
        
        // 核心安全防护：防御 file.type 缺失导致的 `Cannot read properties of undefined (reading 'startsWith')` 阻断崩溃
        const fileType = file.type || '';
        const fileName = file.name || 'unnamed_file';
        const fileSize = file.size || 0;

        if (fileType.startsWith('image/')) {
          url = await compressImage(file);
        } else if (fileType.startsWith('video/')) {
          // 视频文件：读取为 base64 data URL，供 Gemini 多模态 API 直接分析
          url = await fileToBase64DataUrl(file);
        } else if (fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
          // PDF 文件：读取为 base64 data URL，供 Gemini 多模态 API 原生视觉分析（支持图表、排版、扫描件等）
          url = await fileToBase64DataUrl(file);
        } else if (fileType.startsWith('audio/')) {
          // 音频文件：读取为 base64 data URL，供 Gemini 多模态 API 直接分析
          url = await fileToBase64DataUrl(file);
        } else {
          // 对于非图片的文本、Markdown 等文档，我们在前端通过 FileReader 自动将其文本内容读取保存！
          url = URL.createObjectURL(file);
          const nameLower = fileName.toLowerCase();
          
          if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc')) {
            textContent = await parseDocx(file);
          } else if (nameLower.endsWith('.pdf')) {
            textContent = await parsePdf(file);
          } else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
            textContent = await parseExcel(file);
          } else {
            const isTextDoc =
              fileType.startsWith('text/') ||
              nameLower.endsWith('.md') ||
              nameLower.endsWith('.json') ||
              nameLower.endsWith('.txt') ||
              nameLower.endsWith('.js') ||
              nameLower.endsWith('.ts') ||
              nameLower.endsWith('.tsx') ||
              nameLower.endsWith('.css') ||
              nameLower.endsWith('.html');
              
            if (isTextDoc) {
              try {
                const reader = new FileReader();
                textContent = await new Promise<string>((resolve, reject) => {
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error('Read file failed'));
                  reader.readAsText(file);
                });
              } catch (e) {
                console.error('[ChatService] Failed to read text attachment content:', fileName, e);
              }
            }
          }
        }
        return {
          type: fileType.startsWith('image/') 
            ? 'image' 
            : fileType.startsWith('video/') 
              ? 'video' 
              : (fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf'))
                ? 'pdf'
                : fileType.startsWith('audio/')
                  ? 'audio'
                  : 'file',
          url,
          name: fileName,
          size: fileSize,
          content: textContent || undefined,
        } as const;
      })
    );

    chatStore.addMessage({
      role: 'user',
      content,
      attachments: processedAttachments,
    });
    // 获取最新的消息列表，因为刚才 addMessage 后 store 的状态已经更新
    const state = useChatStore.getState();
    const currentSession = state.sessions.find(s => s.id === state.currentSessionId);
    const currentMessages = currentSession ? currentSession.messages : [];

    // 检测并激活智能体知识库，隐式无污染注入 RAG 提示词上下文
    let systemMessageWithRAG = '';
    const firstMsg = currentMessages[0];
    if (firstMsg && firstMsg.role === 'system') {
      const matchedGem = state.gems.find(g => g.systemPrompt === firstMsg.content);
      if (matchedGem && !matchedGem.disableKnowledge && matchedGem.knowledgeFiles?.length > 0) {
        let knowledgeText = '\n\n【供你参考的背景参考知识库内容如下：】\n';
        matchedGem.knowledgeFiles.forEach((file) => {
          knowledgeText += `[参考文件名称: ${file.name}]\n${file.content}\n`;
        });
        knowledgeText += '\n【请务必优先结合上述背景参考知识库内容，为用户给出最专业、最贴合的中文回答。】';
        systemMessageWithRAG = firstMsg.content + knowledgeText;
      }
    }

    // 强力全局双语权威锁定系统指令：完美防范 Gemini/Claude 等大模型泄露英文思维链、草稿或内部规划
    const globalSystemProtection = `

[CRITICAL SYSTEM DIRECTIVES - HIGH PRIORITY]
1. OUTPUT LANGUAGE: All your analyses, descriptions, scripts, and responses MUST be strictly and default in Simplified Chinese (简体中文).
2. NO ENGLISH THINKING TRACES OR REASONING LEAKS: You are strictly forbidden from outputting any English internal reasoning steps, chain of thought, planning, or assessment drafts in the final output text (such as "Analyzing...", "First, I need to...", "Okay, the user greeted me...", "Initial Assessment...", etc.). Direct to the point, directly output the final polished Simplified Chinese results.
3. If the user greets you (e.g. "你好"), reply with a polite, professional, and friendly hello in Simplified Chinese directly, without any English preamble or planning.

【重要核心指令：无论用户使用何种语言或上传何种媒体（图片/文件），你的所有分析、描述、回答均必须严格且默认使用【简体中文】输出。在分析图片、识图识字、回答问题时，请直奔主题并直接给出最终的专业结论，严禁在输出正文中携带任何英文的思维链推导步骤、内部思考草稿（例如 'Analyzing...', 'First, I need to...' 等内部思考过程）。】
`;

    let hasSystem = false;
    const messages = currentMessages.map((msg, index) => {
      const parts: any[] = [];
      let messageContent = msg.content;
      
      // 如果匹配到了智能体知识库，注入修改后的 systemPrompt 提示词
      if (index === 0 && msg.role === 'system') {
        hasSystem = true;
        if (systemMessageWithRAG) {
          messageContent = systemMessageWithRAG + globalSystemProtection;
        } else {
          messageContent = msg.content + globalSystemProtection;
        }
      }

      // 隐式无污染 RAG 附件注入：如果此消息附带了文本/Markdown/代码等附件，我们自动拼接到 content 末尾供大模型阅读
      if (msg.attachments?.length) {
        msg.attachments.forEach((att) => {
          if (att.type === 'file' && att.content) {
            messageContent += `\n\n---\n【用户附加的参考文档: ${att.name}】\n内容如下:\n${att.content}\n---`;
          }
        });
      }

      if (messageContent) {
        parts.push({ type: 'text', text: messageContent });
      }
      
      // 图片、视频、PDF、音频的多模态多媒体分析支持
      if (msg.attachments?.length) {
        msg.attachments.forEach((att) => {
          if (att.type === 'image' && att.url.startsWith('data:')) {
            parts.push({
              type: 'image_url',
              image_url: { url: att.url },
            });
          } else if (att.type === 'video' && att.url.startsWith('data:')) {
            // 视频多模态：将 base64 视频数据作为 video_data 类型传递给后端，由 Rust 端转换为 Gemini inline_data 格式
            parts.push({
              type: 'video_data',
              video_data: { url: att.url },
            });
          } else if (att.type === 'pdf' && att.url.startsWith('data:')) {
            // PDF 多模态：将 base64 PDF 数据传递给后端，由 Rust 端转换为 Gemini inline_data 格式
            parts.push({
              type: 'document_data',
              document_data: { url: att.url },
            });
          } else if (att.type === 'audio' && att.url.startsWith('data:')) {
            // 音频多模态：将 base64 音频数据传递给后端，由 Rust 端转换为 Gemini inline_data 格式
            parts.push({
              type: 'audio_data',
              audio_data: { url: att.url },
            });
          }
        });
      }
      
      return {
        role: msg.role,
        content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
      };
    });

    if (!hasSystem) {
      messages.unshift({
        role: 'system',
        content: globalSystemProtection.trim(),
      });
    }

    const gpt55Config = settingsStore.providerConfigs['12ai-gpt-5-5'];
    const claudeConfig = settingsStore.providerConfigs['12ai-claude'];

    let requestModel = model || textConfig?.model || 'gemini-3.1-pro-preview';
    let requestBaseUrl = '';
    let requestApiKey = '';

    if (requestModel === 'gpt-5.5') {
      requestBaseUrl = gpt55Config?.baseUrl || 'https://cdn.12ai.org';
      requestApiKey = gpt55Config?.apiKey || '';
    } else if (requestModel === 'claude-sonnet-4-6') {
      requestBaseUrl = claudeConfig?.baseUrl || 'https://new.12ai.org';
      requestApiKey = claudeConfig?.apiKey || '';
    } else {
      requestModel = 'gemini-3.1-pro-preview';
      requestBaseUrl = textConfig?.baseUrl || 'https://cdn.12ai.org';
      requestApiKey = textConfig?.apiKey || '';
    }

    if (!requestApiKey || !requestApiKey.trim()) {
      throw new Error('未配置对应模型的 API Key！请打开右上角设置，在 API Key 选项卡中填写密钥后再试。');
    }

    // 将连接与推理超时统一放宽至 300 秒，彻底杜绝视频多模态大文件传输、云端推理较慢、大文档解析耗时或国内代理网络抖动时的虚警超时
    const timeoutMs = 300000;
    const timeoutSeconds = timeoutMs / 1000;

    console.log('[ChatService] Sending message request details:', {
      model: requestModel,
      baseUrl: requestBaseUrl,
      apiKeyLength: requestApiKey ? requestApiKey.length : 0,
      messagesCount: messages.length,
      hasAttachments: attachments.length > 0,
      timeoutMs,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`请求连接超时(${timeoutSeconds}秒)。由于多模态大图传输较慢，或者云端接口看图识文推理耗时较长，请稍后重试或在设置中配置可用的 API 网关代理线路`)), timeoutMs)
    );

    const responseText = await Promise.race([
      chatCompletion({
        messages,
        model: requestModel, // 原汁原味使用官方指定原生模型名称，由 Rust 端完美解析与兼容
        base_url: requestBaseUrl,
        api_key: requestApiKey,
      }),
      timeoutPromise
    ]);

    console.log('[ChatService] Raw response text received from Tauri command:', responseText);

    let finalContent = responseText;
    try {
      if (responseText && responseText.trim()) {
        const parsed = JSON.parse(responseText);
        console.log('[ChatService] Successfully parsed response JSON:', parsed);
        if (parsed.choices && parsed.choices.length > 0 && parsed.choices[0].message) {
          finalContent = parsed.choices[0].message.content || '';
        } else if (parsed.error && parsed.error.message) {
          finalContent = `**API Error:** ${parsed.error.message}`;
        }
      } else {
        finalContent = '*(后端返回了空字符串响应)*';
      }
    } catch (e) {
      console.warn('[ChatService] Response text is not a valid JSON string. Defaulting to raw text.');
    }

    console.log('[ChatService] Final Content successfully prepared for ChatStore:', finalContent);

    chatStore.addMessage({
      role: 'assistant',
      content: finalContent || '*(后端返回内容为空)*',
    });
  } catch (error) {
    console.error('[ChatService] sendMessage caught exception:', error);
    chatStore.addMessage({
      role: 'assistant',
      content: `**发送失败：** ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    chatStore.setIsGenerating(false);
    console.log('[ChatService] sendMessage finally executed. isGenerating set to false.');
  }
}

// 专门处理生图逻辑的调用
export async function sendImageGenerationRequest(prompt: string, model: string, provider: string, referenceImages: string[]) {
  const chatStore = useChatStore.getState();
  const settingsStore = useSettingsStore.getState();
  const config = settingsStore.providerConfigs[provider];

  chatStore.addMessage({
    role: 'user',
    content: `[Image Generation Request: ${model}]\n${prompt}`,
  });

  chatStore.setIsGenerating(true);

  try {
    const jobId = await canvasAiGateway.submitGenerateImageJob({
      prompt,
      model: config?.model || model,
      size: '1024x1024',
      aspectRatio: '1:1',
      providerId: provider,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    });

    // 这里我们需要轮询 Job 结果
    let imageUrl = '';
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const status = await canvasAiGateway.getGenerateImageJob(jobId);
      if (status.status === 'succeeded' && status.result) {
        imageUrl = status.result;
        break;
      }
      if (status.status === 'failed' || status.status === 'not_found') {
        throw new Error(status.error || 'Generation failed');
      }
    }

    chatStore.addMessage({
      role: 'assistant',
      content: 'Here is your generated image:',
      generatedImageUrl: imageUrl,
    });

  } catch (error) {
    chatStore.addMessage({
      role: 'assistant',
      content: `**Error generating image:** ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    chatStore.setIsGenerating(false);
  }
}
