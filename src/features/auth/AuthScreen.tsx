import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

export function AuthScreen() {
  const machineId = useAuthStore((state) => state.machineId);
  const reason = useAuthStore((state) => state.reason);
  const activate = useAuthStore((state) => state.activate);

  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('请粘贴管理员发回的授权码');
      return;
    }
    setSubmitting(true);
    const result = await activate(token);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message ?? '激活失败');
    }
  };

  return (
    <div className="w-full h-full min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 font-sans">
      <div className="w-full max-w-md p-8 bg-zinc-900 border border-zinc-800 shadow-2xl rounded-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight mb-2 text-white">知晓AI无限画布授权激活</h1>
          <p className="text-zinc-400 text-sm">
            一机一码授权。请把下方机器码发送给管理员，管理员会回发授权码，粘贴后即可激活。
          </p>
        </div>

        <div className="mb-6 p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl">
          <p className="text-xs text-zinc-500 mb-2 font-semibold tracking-wider uppercase">
            您的专属机器码
          </p>
          <div className="flex items-center justify-between bg-zinc-900 px-4 py-3 rounded-lg border border-zinc-700/50 gap-3">
            <code className="text-blue-400 font-mono text-base font-bold tracking-wider break-all">
              {machineId || '获取中...'}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!machineId}
              className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded-md transition-colors font-medium border border-zinc-700"
            >
              {copied ? '已复制 ✓' : '复制'}
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="license-token" className="block text-sm font-medium text-zinc-300 mb-2">
              授权码
            </label>
            <textarea
              id="license-token"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError('');
              }}
              placeholder="SBLIC1-..."
              rows={4}
              className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono text-xs leading-relaxed"
              autoComplete="off"
              autoFocus
              spellCheck={false}
            />
            {error && (
              <p className="mt-2 text-sm text-red-400 font-medium">{error}</p>
            )}
            {!error && reason && (
              <p className="mt-2 text-xs text-amber-400/80">提示：{reason}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 transition-all"
          >
            {submitting ? '验证中...' : '立即激活'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-zinc-500">知晓AI-无限画布 © 2026</p>
        </div>
      </div>
    </div>
  );
}
