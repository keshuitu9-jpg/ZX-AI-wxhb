import {
  generateImage,
  getGenerateImageJob,
  setApiKey,
  setProviderConfig,
  submitGenerateImageJob,
} from '@/commands/ai';
import { imageUrlToDataUrl, persistImageLocally, createPreviewDataUrl } from '@/features/canvas/application/imageData';

import type { AiGateway, GenerateImagePayload } from '../application/ports';

async function normalizeReferenceImages(payload: GenerateImagePayload): Promise<string[] | undefined> {
  const isKieModel = payload.providerId === 'kie';
  const isFalModel = payload.providerId === 'fal';
  return payload.referenceImages
    ? await Promise.all(
      payload.referenceImages.map(async (imageUrl) => {
        // 先对所有参考图片进行压缩，最大尺寸 1024，并转为高压 base64，防止原图超过 5M 导致上传拦截
        const compressedDataUrl = await createPreviewDataUrl(imageUrl, 1024);
        
        return isKieModel || isFalModel
          ? await imageUrlToDataUrl(compressedDataUrl) // 传入已经是 DataUrl 的内容，此方法会直接返回
          : await persistImageLocally(compressedDataUrl); // 将压缩后的图存为本地缓存文件供 Rust 端读取
      })
    )
    : undefined;
}

export const tauriAiGateway: AiGateway = {
  setApiKey,
  setProviderConfig: async (config) => {
    await setProviderConfig({
      provider: config.provider,
      api_key: config.apiKey,
      base_url: config.baseUrl,
      model: config.model,
      prefer_async: config.preferAsync,
    });
  },
  generateImage: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);

    return await generateImage({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  submitGenerateImageJob: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    return await submitGenerateImageJob({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  getGenerateImageJob,
};
