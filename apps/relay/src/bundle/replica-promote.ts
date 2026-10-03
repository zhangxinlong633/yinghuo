import { payloadHashOk } from './payload-hash';

export function replicaPromoteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.DTN_REPLICA_PROMOTE ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

export type PromoteSkip =
  | 'not-replica'
  | 'promote-off'
  | 'primary-alive'
  | 'no-hash'
  | 'corrupt'
  | 'missing-custodian';

export function canPromoteReplica(input: {
  replicaRole?: 'primary' | 'replica';
  replicaOf?: string;
  payload: string;
  payloadSha256?: string;
  unhealthyIds: Iterable<string>;
  promoteEnabled: boolean;
}): { ok: true } | { ok: false; reason: PromoteSkip } {
  if (!input.promoteEnabled) return { ok: false, reason: 'promote-off' };
  if (input.replicaRole !== 'replica') return { ok: false, reason: 'not-replica' };
  if (!input.replicaOf) return { ok: false, reason: 'missing-custodian' };
  const down = new Set(input.unhealthyIds);
  if (!down.has(input.replicaOf)) return { ok: false, reason: 'primary-alive' };
  if (!input.payloadSha256) return { ok: false, reason: 'no-hash' };
  if (!payloadHashOk(input.payload, input.payloadSha256)) {
    return { ok: false, reason: 'corrupt' };
  }
  return { ok: true };
}
