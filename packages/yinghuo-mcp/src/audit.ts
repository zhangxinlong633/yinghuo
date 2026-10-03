export type AuditEvent = {
  t: number;
  tool: string;
  ok: boolean;
  mode: string;
  error?: string;
};

export function formatAuditLine(ev: AuditEvent): string {
  return JSON.stringify(ev);
}
