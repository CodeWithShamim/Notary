import { toHumanReadable } from '@unicitylabs/sphere-sdk';

/** Base units → human string using the coin's decimals (default UCT=18). */
export function human(amount: string | bigint, decimals = 18): string {
  try {
    const s = toHumanReadable(typeof amount === 'bigint' ? amount : BigInt(amount), decimals);
    // trim trailing zeros but keep at least one decimal-less form
    return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
  } catch {
    return String(amount);
  }
}

export function shortAddr(addr?: string | null, n = 10): string {
  if (!addr) return '—';
  return addr.length <= n * 2 ? addr : `${addr.slice(0, n)}…${addr.slice(-6)}`;
}

export function timeLeft(deadlineAt: number | null): string {
  if (!deadlineAt) return '—';
  const ms = deadlineAt - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function when(at: number): string {
  return new Date(at).toLocaleString();
}
