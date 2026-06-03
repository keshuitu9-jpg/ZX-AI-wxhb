import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  PRICE_DISPLAY_CURRENCY_MODES,
  type PriceDisplayCurrencyMode,
} from '@/features/canvas/pricing/types';

export type UiRadiusPreset = 'compact' | 'default' | 'large';
export type ThemeTonePreset = 'neutral' | 'warm' | 'cool';
export type CanvasEdgeRoutingMode = 'spline' | 'orthogonal' | 'smartOrthogonal';
export type ProviderApiKeys = Record<string, string>;
export interface ProviderRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  preferAsync?: boolean;
}
export type ProviderRuntimeConfigMap = Record<string, ProviderRuntimeConfig>;

const SUPPORTED_PROVIDER_IDS = [
  '12ai-text',
  '12ai-gpt-5-5',
  '12ai-claude',
  '12ai-gemini-image',
  '12ai-gpt-image',
  '12ai-veo',
] as const;

const SHARED_12AI_PROVIDER_IDS = [
  '12ai-gpt-image',
  '12ai-gemini-image',
  '12ai-text',
  '12ai-gpt-5-5',
  '12ai-claude',
  '12ai-veo',
] as const;

const DEFAULT_PROVIDER_API_KEYS: Record<(typeof SUPPORTED_PROVIDER_IDS)[number], string> = {
  '12ai-text': '',
  '12ai-gpt-5-5': '',
  '12ai-claude': '',
  '12ai-gemini-image': '',
  '12ai-gpt-image': '',
  '12ai-veo': '',
};

// 默认 baseUrl 和 model 留空，客户自行录入


const DEFAULT_PROVIDER_BASE_URLS: Record<(typeof SUPPORTED_PROVIDER_IDS)[number], string> = {
  '12ai-text': '',
  '12ai-gpt-5-5': '',
  '12ai-claude': '',
  '12ai-gemini-image': '',
  '12ai-gpt-image': '',
  '12ai-veo': '',
};

const DEFAULT_PROVIDER_MODELS: Record<(typeof SUPPORTED_PROVIDER_IDS)[number], string> = {
  '12ai-text': '',
  '12ai-gpt-5-5': '',
  '12ai-claude': '',
  '12ai-gemini-image': '',
  '12ai-gpt-image': '',
  '12ai-veo': '',
};

interface SettingsState {
  isHydrated: boolean;
  apiKeys: ProviderApiKeys;
  providerConfigs: ProviderRuntimeConfigMap;
  hideProviderGuidePopover: boolean;
  downloadPresetPaths: string[];
  useUploadFilenameAsNodeTitle: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  storyboardGenAutoInferEmptyFrame: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  enableStoryboardGenGridPreviewShortcut: boolean;
  showStoryboardGenAdvancedRatioControls: boolean;
  showNodePrice: boolean;
  priceDisplayCurrencyMode: PriceDisplayCurrencyMode;
  usdToCnyRate: number;
  preferDiscountedPrice: boolean;
  uiRadiusPreset: UiRadiusPreset;
  themeTonePreset: ThemeTonePreset;
  accentColor: string;
  canvasEdgeRoutingMode: CanvasEdgeRoutingMode;
  autoCheckAppUpdateOnLaunch: boolean;
  enableUpdateDialog: boolean;
  setProviderApiKey: (providerId: string, key: string) => void;
  setProviderBaseUrl: (providerId: string, baseUrl: string) => void;
  setProviderModel: (providerId: string, model: string) => void;
  setProviderConfig: (providerId: string, config: Partial<ProviderRuntimeConfig>) => void;
  setHideProviderGuidePopover: (hide: boolean) => void;
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setEnableStoryboardGenGridPreviewShortcut: (enabled: boolean) => void;
  setShowStoryboardGenAdvancedRatioControls: (enabled: boolean) => void;
  setShowNodePrice: (enabled: boolean) => void;
  setPriceDisplayCurrencyMode: (mode: PriceDisplayCurrencyMode) => void;
  setUsdToCnyRate: (rate: number) => void;
  setPreferDiscountedPrice: (enabled: boolean) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setThemeTonePreset: (preset: ThemeTonePreset) => void;
  setAccentColor: (color: string) => void;
  setCanvasEdgeRoutingMode: (mode: CanvasEdgeRoutingMode) => void;
  setAutoCheckAppUpdateOnLaunch: (enabled: boolean) => void;
  setEnableUpdateDialog: (enabled: boolean) => void;
  
  // 全局通用提示词管理相关
  globalPrompts: GlobalPromptItem[];
  addGlobalPrompt: (title: string, content: string) => string;
  updateGlobalPrompt: (id: string, patch: Partial<Omit<GlobalPromptItem, 'id'>>) => void;
  deleteGlobalPrompt: (id: string) => void;
}

export interface GlobalPromptItem {
  id: string;
  title: string;
  content: string;
}

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return '#3B82F6';
  }
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function normalizeApiKey(input: string): string {
  return input.trim();
}

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/g, '');
}

function normalizeProviderModel(input: string): string {
  return input.trim();
}

function normalizePriceDisplayCurrencyMode(
  input: PriceDisplayCurrencyMode | string | null | undefined
): PriceDisplayCurrencyMode {
  return PRICE_DISPLAY_CURRENCY_MODES.includes(input as PriceDisplayCurrencyMode)
    ? (input as PriceDisplayCurrencyMode)
    : 'auto';
}

function normalizeUsdToCnyRate(input: number | string | null | undefined): number {
  const numeric = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 7.2;
  }

  return Math.min(100, Math.max(0.01, Math.round(numeric * 100) / 100));
}

function normalizeCanvasEdgeRoutingMode(
  input: CanvasEdgeRoutingMode | string | null | undefined
): CanvasEdgeRoutingMode {
  if (input === 'orthogonal' || input === 'smartOrthogonal' || input === 'spline') {
    return input;
  }
  return 'spline';
}

function normalizeApiKeys(input: ProviderApiKeys | null | undefined): ProviderApiKeys {
  return SUPPORTED_PROVIDER_IDS.reduce<ProviderApiKeys>((acc, providerId) => {
    const source = input?.[providerId];
    acc[providerId] =
      typeof source === 'string'
        ? normalizeApiKey(source)
        : DEFAULT_PROVIDER_API_KEYS[providerId];
    return acc;
  }, {});
}

function createDefaultProviderRuntimeConfig(
  providerId: (typeof SUPPORTED_PROVIDER_IDS)[number]
): ProviderRuntimeConfig {
  return {
    apiKey: DEFAULT_PROVIDER_API_KEYS[providerId],
    baseUrl: DEFAULT_PROVIDER_BASE_URLS[providerId],
    model: DEFAULT_PROVIDER_MODELS[providerId],
  };
}

function normalizeProviderConfigs(
  input: ProviderRuntimeConfigMap | null | undefined,
  fallbackApiKeys?: ProviderApiKeys | null
): ProviderRuntimeConfigMap {
  return SUPPORTED_PROVIDER_IDS.reduce<ProviderRuntimeConfigMap>((acc, providerId) => {
    const defaults = createDefaultProviderRuntimeConfig(providerId);
    const source = input?.[providerId];
    const fallbackApiKey = fallbackApiKeys?.[providerId];
    acc[providerId] = {
      apiKey:
        typeof source?.apiKey === 'string'
          ? normalizeApiKey(source.apiKey)
          : typeof fallbackApiKey === 'string'
            ? normalizeApiKey(fallbackApiKey)
            : defaults.apiKey,
      baseUrl:
        typeof source?.baseUrl === 'string'
          ? normalizeBaseUrl(source.baseUrl)
          : defaults.baseUrl,
      model:
        typeof source?.model === 'string'
          ? normalizeProviderModel(source.model)
          : defaults.model,
      preferAsync: typeof source?.preferAsync === 'boolean' ? source.preferAsync : true,
    };
    return acc;
  }, {});
}

function providerConfigsToApiKeys(configs: ProviderRuntimeConfigMap): ProviderApiKeys {
  return Object.entries(configs).reduce<ProviderApiKeys>((acc, [providerId, config]) => {
    acc[providerId] = normalizeApiKey(config.apiKey);
    return acc;
  }, {});
}

function updateProviderConfigMap(
  configs: ProviderRuntimeConfigMap,
  providerId: string,
  patch: Partial<ProviderRuntimeConfig>
): ProviderRuntimeConfigMap {
  const normalizedCurrent = normalizeProviderConfigs(configs);
  const current = normalizedCurrent[providerId] ?? {
    apiKey: '',
    baseUrl: '',
    model: '',
  };

  return {
    ...normalizedCurrent,
    [providerId]: {
      apiKey:
        patch.apiKey !== undefined ? normalizeApiKey(patch.apiKey) : current.apiKey,
      baseUrl:
        patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : current.baseUrl,
      model:
        patch.model !== undefined ? normalizeProviderModel(patch.model) : current.model,
      preferAsync: patch.preferAsync !== undefined ? patch.preferAsync : current.preferAsync,
    },
  };
}

export function resolveProviderRequestModel(
  providerId: string,
  fallbackRequestModel: string,
  providerConfigs: ProviderRuntimeConfigMap | null | undefined
): string {
  const configuredModel = providerConfigs?.[providerId]?.model?.trim();
  if (!configuredModel) {
    return fallbackRequestModel;
  }

  const prefix = `${providerId}/`;
  return configuredModel.startsWith(prefix)
    ? configuredModel
    : `${prefix}${configuredModel}`;
}

export function resolveProviderApiKey(
  providerId: string,
  providerConfigs: ProviderRuntimeConfigMap | null | undefined,
  apiKeys: ProviderApiKeys | null | undefined
): string {
  const directKey = normalizeApiKey(providerConfigs?.[providerId]?.apiKey ?? apiKeys?.[providerId] ?? '');
  if (directKey || !providerId.startsWith('12ai-')) {
    return directKey;
  }

  for (const sharedProviderId of SHARED_12AI_PROVIDER_IDS) {
    if (sharedProviderId === providerId) {
      continue;
    }
    const sharedKey = normalizeApiKey(
      providerConfigs?.[sharedProviderId]?.apiKey ?? apiKeys?.[sharedProviderId] ?? ''
    );
    if (sharedKey) {
      return sharedKey;
    }
  }

  return '';
}

export function hasConfiguredApiKey(apiKeys: ProviderApiKeys): boolean {
  return getConfiguredApiKeyCount(apiKeys) > 0;
}

export function getConfiguredApiKeyCount(
  apiKeys: ProviderApiKeys,
  providerIds?: readonly string[]
): number {
  const keysToCount = providerIds
    ? providerIds.map((providerId) => apiKeys[providerId] ?? '')
    : Object.values(apiKeys);

  return keysToCount.reduce((count, key) => {
    return normalizeApiKey(key).length > 0 ? count + 1 : count;
  }, 0);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isHydrated: false,
      providerConfigs: normalizeProviderConfigs(undefined),
      apiKeys: normalizeApiKeys(undefined),
      hideProviderGuidePopover: false,
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      enableStoryboardGenGridPreviewShortcut: false,
      showStoryboardGenAdvancedRatioControls: false,
      showNodePrice: true,
      priceDisplayCurrencyMode: 'auto',
      usdToCnyRate: 7.2,
      preferDiscountedPrice: false,
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      accentColor: '#3B82F6',
      canvasEdgeRoutingMode: 'spline',
      autoCheckAppUpdateOnLaunch: true,
      enableUpdateDialog: true,
      setProviderApiKey: (providerId, key) =>
        set((state) => {
          const providerConfigs = updateProviderConfigMap(state.providerConfigs, providerId, {
            apiKey: key,
          });
          return {
            providerConfigs,
            apiKeys: providerConfigsToApiKeys(providerConfigs),
          };
        }),
      setProviderBaseUrl: (providerId, baseUrl) =>
        set((state) => {
          const providerConfigs = updateProviderConfigMap(state.providerConfigs, providerId, {
            baseUrl,
          });
          return {
            providerConfigs,
            apiKeys: providerConfigsToApiKeys(providerConfigs),
          };
        }),
      setProviderModel: (providerId, model) =>
        set((state) => {
          const providerConfigs = updateProviderConfigMap(state.providerConfigs, providerId, {
            model,
          });
          return {
            providerConfigs,
            apiKeys: providerConfigsToApiKeys(providerConfigs),
          };
        }),
      setProviderConfig: (providerId, config) =>
        set((state) => {
          const providerConfigs = updateProviderConfigMap(state.providerConfigs, providerId, config);
          return {
            providerConfigs,
            apiKeys: providerConfigsToApiKeys(providerConfigs),
          };
        }),
      setHideProviderGuidePopover: (hide) => set({ hideProviderGuidePopover: hide }),
      setDownloadPresetPaths: (paths) => {
        const uniquePaths = Array.from(
          new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))
        ).slice(0, 8);
        set({ downloadPresetPaths: uniquePaths });
      },
      setUseUploadFilenameAsNodeTitle: (enabled) => set({ useUploadFilenameAsNodeTitle: enabled }),
      setStoryboardGenKeepStyleConsistent: (enabled) =>
        set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) =>
        set({ storyboardGenDisableTextInImage: enabled }),
      setStoryboardGenAutoInferEmptyFrame: (enabled) =>
        set({ storyboardGenAutoInferEmptyFrame: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) =>
        set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setEnableStoryboardGenGridPreviewShortcut: (enabled) =>
        set({ enableStoryboardGenGridPreviewShortcut: enabled }),
      setShowStoryboardGenAdvancedRatioControls: (enabled) =>
        set({ showStoryboardGenAdvancedRatioControls: enabled }),
      setShowNodePrice: (enabled) => set({ showNodePrice: enabled }),
      setPriceDisplayCurrencyMode: (priceDisplayCurrencyMode) =>
        set({
          priceDisplayCurrencyMode:
            normalizePriceDisplayCurrencyMode(priceDisplayCurrencyMode),
        }),
      setUsdToCnyRate: (usdToCnyRate) =>
        set({ usdToCnyRate: normalizeUsdToCnyRate(usdToCnyRate) }),
      setPreferDiscountedPrice: (enabled) => set({ preferDiscountedPrice: enabled }),
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setThemeTonePreset: (themeTonePreset) => set({ themeTonePreset }),
      setAccentColor: (color) => set({ accentColor: normalizeHexColor(color) }),
      setCanvasEdgeRoutingMode: (canvasEdgeRoutingMode) =>
        set({ canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(canvasEdgeRoutingMode) }),
      setAutoCheckAppUpdateOnLaunch: (enabled) => set({ autoCheckAppUpdateOnLaunch: enabled }),
      setEnableUpdateDialog: (enabled) => set({ enableUpdateDialog: enabled }),

      // 全局通用提示词实现
      globalPrompts: [
        { id: '1', title: '特写镜头', content: 'Cinematic macro photography, intense facial details, warm candlelight, dramatic shadows, 8k, photorealistic' },
        { id: '2', title: '赛博朋克街景', content: 'Neon rain-slicked cyber streets, towering holographic billboards, flying traffic, highly detailed, octane render, unreal engine 5' }
      ],
      addGlobalPrompt: (title, content) => {
        const newId = Math.random().toString(36).substring(2, 11);
        set((state) => ({
          globalPrompts: [...(state.globalPrompts ?? []), { id: newId, title, content }]
        }));
        return newId;
      },
      updateGlobalPrompt: (id, patch) => {
        set((state) => ({
          globalPrompts: (state.globalPrompts ?? []).map((item) =>
            item.id === id ? { ...item, ...patch } : item
          )
        }));
      },
      deleteGlobalPrompt: (id) => {
        set((state) => ({
          globalPrompts: (state.globalPrompts ?? []).filter((item) => item.id !== id)
        }));
      },
    }),
    {
      name: 'settings-storage',
      version: 17,
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('failed to hydrate settings storage', error);
          }
          useSettingsStore.setState({ isHydrated: true });
        };
      },
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: ProviderApiKeys;
          providerConfigs?: ProviderRuntimeConfigMap;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          hideProviderGuidePopover?: boolean;
          canvasEdgeRoutingMode?: CanvasEdgeRoutingMode | string;
          autoCheckAppUpdateOnLaunch?: boolean;
          enableUpdateDialog?: boolean;
          enableStoryboardGenGridPreviewShortcut?: boolean;
          showStoryboardGenAdvancedRatioControls?: boolean;
          storyboardGenAutoInferEmptyFrame?: boolean;
          showNodePrice?: boolean;
          priceDisplayCurrencyMode?: PriceDisplayCurrencyMode | string;
          usdToCnyRate?: number | string;
          preferDiscountedPrice?: boolean;
          globalPrompts?: GlobalPromptItem[];
        };

        // v17: 强制清空所有 provider 配置（API Key / BaseUrl / Model），客户需自行录入
        const migratedProviderConfigs = normalizeProviderConfigs(undefined);
        const syncedApiKeys = providerConfigsToApiKeys(migratedProviderConfigs);
        const ignoreAtTagWhenCopyingAndGenerating =
          state.ignoreAtTagWhenCopyingAndGenerating ?? true;
          
        const defaultGlobalPrompts: GlobalPromptItem[] = [
          { id: '1', title: '特写镜头', content: 'Cinematic macro photography, intense facial details, warm candlelight, dramatic shadows, 8k, photorealistic' },
          { id: '2', title: '赛博朋克街景', content: 'Neon rain-slicked cyber streets, towering holographic billboards, flying traffic, highly detailed, octane render, unreal engine 5' }
        ];
        const globalPrompts = Array.isArray(state.globalPrompts) ? state.globalPrompts : defaultGlobalPrompts;

        return {
          ...(persistedState as object),
          isHydrated: true,
          providerConfigs: migratedProviderConfigs,
          apiKeys: syncedApiKeys,
          ignoreAtTagWhenCopyingAndGenerating,
          globalPrompts,
          hideProviderGuidePopover: state.hideProviderGuidePopover ?? false,
          canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(state.canvasEdgeRoutingMode),
          autoCheckAppUpdateOnLaunch: state.autoCheckAppUpdateOnLaunch ?? true,
          enableUpdateDialog: state.enableUpdateDialog ?? true,
          enableStoryboardGenGridPreviewShortcut:
            state.enableStoryboardGenGridPreviewShortcut ?? false,
          showStoryboardGenAdvancedRatioControls:
            state.showStoryboardGenAdvancedRatioControls ?? false,
          storyboardGenAutoInferEmptyFrame: state.storyboardGenAutoInferEmptyFrame ?? true,
          showNodePrice: state.showNodePrice ?? true,
          priceDisplayCurrencyMode: normalizePriceDisplayCurrencyMode(
            state.priceDisplayCurrencyMode
          ),
          usdToCnyRate: normalizeUsdToCnyRate(state.usdToCnyRate),
          preferDiscountedPrice: state.preferDiscountedPrice ?? false,
        };
      },
    }
  )
);
