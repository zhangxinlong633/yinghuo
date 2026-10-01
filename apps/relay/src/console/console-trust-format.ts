export function shortPlanVersion(version: string, maxLen = 12): string {
  if (!version) return '—';
  return version.length <= maxLen ? version : version.slice(0, maxLen);
}

export function formatUnhealthyLine(u: { id: string; remainMs?: number }): string {
  if (u.remainMs == null || Number.isNaN(u.remainMs)) return u.id;
  const sec = Math.ceil(u.remainMs / 1000);
  return `${u.id} · ${sec}s`;
}

export function planKeepOldMessage(locale: 'zh' | 'en'): string {
  return locale === 'zh'
    ? '校验失败，仍在用旧计划'
    : 'Validation failed; previous plan remains active';
}
