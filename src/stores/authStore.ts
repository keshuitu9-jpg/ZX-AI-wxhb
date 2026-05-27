import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface LicenseStatus {
  authorized: boolean;
  machine_id: string;
  reason: string | null;
  licensed_to: string | null;
  expires: string | null;
}

interface AuthState {
  isAuthorized: boolean;
  isReady: boolean;
  machineId: string;
  licensedTo: string | null;
  expires: string | null;
  reason: string | null;
  /** 启动时调用一次：同步授权状态与机器码 */
  hydrate: () => Promise<void>;
  /** 用户提交的授权码：调用后端 activate_license */
  activate: (token: string) => Promise<{ ok: boolean; message?: string }>;
  /** 解绑当前机器（删除 license.bin） */
  deactivate: () => Promise<void>;
}

const initialStatus: Omit<AuthState, 'hydrate' | 'activate' | 'deactivate'> = {
  isAuthorized: false,
  isReady: false,
  machineId: '',
  licensedTo: null,
  expires: null,
  reason: null,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialStatus,

  hydrate: async () => {
    if (!isTauri()) {
      // 浏览器调试模式：跳过授权门，避免无法调试 UI
      set({
        ...initialStatus,
        isAuthorized: true,
        isReady: true,
        machineId: 'BROWSER-DEV',
        reason: '浏览器开发模式：跳过授权校验',
      });
      return;
    }

    // 开发模式（tauri dev）：跳过授权校验
    if (import.meta.env.DEV) {
      try {
        const status = await invoke<LicenseStatus>('check_license');
        set({
          isAuthorized: true,
          isReady: true,
          machineId: status.machine_id,
          licensedTo: 'Developer',
          expires: null,
          reason: '开发模式：跳过授权校验',
        });
      } catch {
        set({
          ...initialStatus,
          isAuthorized: true,
          isReady: true,
          machineId: 'DEV-MODE',
          reason: '开发模式：跳过授权校验',
        });
      }
      return;
    }

    try {
      const status = await invoke<LicenseStatus>('check_license');
      set({
        isAuthorized: status.authorized,
        isReady: true,
        machineId: status.machine_id,
        licensedTo: status.licensed_to,
        expires: status.expires,
        reason: status.reason,
      });
    } catch (err) {
      let machineId = '';
      try {
        machineId = await invoke<string>('get_machine_id');
      } catch {
        // ignore
      }
      set({
        ...initialStatus,
        machineId,
        isReady: true,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  },

  activate: async (token: string) => {
    if (!isTauri()) {
      return { ok: false, message: '当前环境不支持激活' };
    }
    try {
      const status = await invoke<LicenseStatus>('activate_license', { token });
      set({
        isAuthorized: status.authorized,
        isReady: true,
        machineId: status.machine_id,
        licensedTo: status.licensed_to,
        expires: status.expires,
        reason: status.reason,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  },

  deactivate: async () => {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke('deactivate_license');
    } finally {
      set({
        isAuthorized: false,
        licensedTo: null,
        expires: null,
        reason: '已解除当前机器授权',
      });
    }
  },
}));
