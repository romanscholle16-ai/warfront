import { TICKS_PER_MINUTE } from '@warfront/shared';

export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function rate(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${value >= 0 ? '+' : ''}${rounded}`;
}

/** Ticks → "1m 20s", for build/train/research timers. */
export function ticksToClock(ticks: number): string {
  const totalSeconds = Math.max(0, Math.ceil((ticks / TICKS_PER_MINUTE) * 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function costLine(cost: Partial<Record<string, number>>): string {
  const icons: Record<string, string> = {
    money: '💰', food: '🌾', oil: '🛢', materials: '🧱', research: '🔬',
  };
  return Object.entries(cost)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${icons[k] ?? k} ${compact(v ?? 0)}`)
    .join('  ');
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

export const RESOURCE_ICONS: Record<string, string> = {
  money: '💰', food: '🌾', oil: '🛢', materials: '🧱', research: '🔬',
};
