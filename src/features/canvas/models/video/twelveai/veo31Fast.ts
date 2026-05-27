import type { ImageModelDefinition } from '../../types';

export const TWELVE_AI_VEO_VIDEO_MODEL_ID = '12ai-veo/veo_3_1-fast';

const TWELVE_AI_VEO_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
] as const;

export const imageModel: ImageModelDefinition = {
  id: TWELVE_AI_VEO_VIDEO_MODEL_ID,
  mediaType: 'video',
  displayName: 'Veo 3.1 Fast',
  providerId: '12ai-veo',
  description: 'Google DeepMind Veo 3.1 视频生成大模型 (12AI通道支持)',
  eta: '3min',
  expectedDurationMs: 180000,
  defaultAspectRatio: '16:9',
  defaultResolution: '1080p',
  aspectRatios: TWELVE_AI_VEO_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '4K', label: '4K' },
  ],
  extraParamsSchema: [
    {
      key: 'quality',
      label: '视频生成画质',
      type: 'enum',
      defaultValue: 'high',
      options: [
        { value: 'high', label: '高质量 (High)' },
        { value: 'standard', label: '标准 (Standard)' },
      ],
    },
  ],
  defaultExtraParams: {
    quality: 'high',
  },
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: TWELVE_AI_VEO_VIDEO_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '图生视频 (Image-to-Video)' : '文生视频 (Text-to-Video)',
  }),
};
