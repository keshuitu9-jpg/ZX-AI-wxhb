import type { ImageModelDefinition } from '../../types';

export const TWELVE_AI_GEMINI_PRO_IMAGE_MODEL_ID =
  '12ai-gemini-image/gemini-3-pro-image-preview';

const GEMINI_PRO_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const;

export const imageModel: ImageModelDefinition = {
  id: TWELVE_AI_GEMINI_PRO_IMAGE_MODEL_ID,
  mediaType: 'image',
  displayName: 'Gemini 3 Pro Image Preview',
  providerId: '12ai-gemini-image',
  description: '12AI Gemini 3 Pro Image Preview generation and editing',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '2K',
  aspectRatios: GEMINI_PRO_IMAGE_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
  ],
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: TWELVE_AI_GEMINI_PRO_IMAGE_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit mode' : 'Generate mode',
  }),
};
