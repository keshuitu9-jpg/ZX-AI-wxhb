import type { ImageModelDefinition } from '../../types';

export const TWELVE_AI_GPT_IMAGE_2_MODEL_ID = '12ai-gpt-image/gpt-image-2';

const TWELVE_AI_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
] as const;

export const imageModel: ImageModelDefinition = {
  id: TWELVE_AI_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'GPT Image 2',
  providerId: '12ai-gpt-image',
  description: 'OpenAI-compatible GPT Image 2 generation and editing via 12AI',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: TWELVE_AI_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: 'auto', label: 'Auto' },
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
  ],
  extraParamsSchema: [
    {
      key: 'quality',
      label: 'Quality',
      type: 'enum',
      defaultValue: 'high',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
    },
  ],
  defaultExtraParams: {
    quality: 'high',
  },
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: TWELVE_AI_GPT_IMAGE_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit mode' : 'Generate mode',
  }),
};
