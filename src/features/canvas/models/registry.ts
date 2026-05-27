import type {
  ImageModelDefinition,
  ImageModelRuntimeContext,
  ModelProviderDefinition,
  ResolutionOption,
} from './types';

import { provider as twelveAiTextProvider } from './providers/12aiText';
import { provider as twelveAiGpt55Provider } from './providers/12aiGpt55';
import { provider as twelveAiClaudeProvider } from './providers/12aiClaude';
import { provider as twelveAiGeminiImageProvider } from './providers/12aiGeminiImage';
import { provider as twelveAiGptImageProvider } from './providers/12aiGptImage';
import { provider as twelveAiVeoProvider } from './providers/12aiVeo';

const modelModules = import.meta.glob<{ imageModel: ImageModelDefinition }>(
  ['./image/**/*.ts', './video/**/*.ts'],
  { eager: true }
);

const ENABLED_PROVIDER_IDS = new Set([
  '12ai-text',
  '12ai-gpt-5-5',
  '12ai-claude',
  '12ai-gemini-image',
  '12ai-gpt-image',
  '12ai-veo',
]);

const ENABLED_IMAGE_MODEL_IDS = new Set([
  '12ai-gemini-image/gemini-3-pro-image-preview',
  '12ai-gpt-image/gpt-image-2',
  '12ai-veo/veo_3_1-fast',
]);

const rawProviders = [
  twelveAiTextProvider,
  twelveAiGpt55Provider,
  twelveAiClaudeProvider,
  twelveAiGeminiImageProvider,
  twelveAiGptImageProvider,
  twelveAiVeoProvider,
];

const providers: ModelProviderDefinition[] = rawProviders
  .filter((provider): provider is ModelProviderDefinition => Boolean(provider))
  .filter((provider) => ENABLED_PROVIDER_IDS.has(provider.id))
  .sort((a, b) => a.id.localeCompare(b.id));

const imageModels: ImageModelDefinition[] = Object.values(modelModules)
  .map((module) => module.imageModel)
  .filter((model): model is ImageModelDefinition => Boolean(model))
  .filter((model) => ENABLED_IMAGE_MODEL_IDS.has(model.id))
  .sort((a, b) => a.id.localeCompare(b.id));

const providerMap = new Map<string, ModelProviderDefinition>(
  providers.map((provider) => [provider.id, provider])
);
const imageModelMap = new Map<string, ImageModelDefinition>(
  imageModels.map((model) => [model.id, model])
);

export const DEFAULT_IMAGE_MODEL_ID = '12ai-gpt-image/gpt-image-2';

const imageModelAliasMap = new Map<string, string>([
  ['12ai/gpt-image-2', '12ai-gpt-image/gpt-image-2'],
]);

export function listImageModels(): ImageModelDefinition[] {
  return imageModels;
}

export function listModelProviders(): ModelProviderDefinition[] {
  return providers;
}

export function getImageModel(modelId: string): ImageModelDefinition {
  const resolvedModelId = imageModelAliasMap.get(modelId) ?? modelId;
  return imageModelMap.get(resolvedModelId) ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!;
}

export function resolveImageModelRequest(
  model: ImageModelDefinition,
  context: Parameters<ImageModelDefinition['resolveRequest']>[0]
): ReturnType<ImageModelDefinition['resolveRequest']> {
  return model.resolveRequest(context);
}

export function resolveImageModelResolutions(
  model: ImageModelDefinition,
  context: ImageModelRuntimeContext = {}
): ResolutionOption[] {
  const resolvedOptions = model.resolveResolutions?.(context);
  return resolvedOptions && resolvedOptions.length > 0 ? resolvedOptions : model.resolutions;
}

export function resolveImageModelResolution(
  model: ImageModelDefinition,
  requestedResolution: string | undefined,
  context: ImageModelRuntimeContext = {}
): ResolutionOption {
  const resolutionOptions = resolveImageModelResolutions(model, context);

  return (
    (requestedResolution
      ? resolutionOptions.find((item) => item.value === requestedResolution)
      : undefined) ??
    resolutionOptions.find((item) => item.value === model.defaultResolution) ??
    resolutionOptions[0] ??
    model.resolutions[0]
  );
}

export function getModelProvider(providerId: string): ModelProviderDefinition {
  return (
    providerMap.get(providerId) ?? {
      id: 'unknown',
      name: 'Unknown Provider',
      label: 'Unknown',
    }
  );
}
