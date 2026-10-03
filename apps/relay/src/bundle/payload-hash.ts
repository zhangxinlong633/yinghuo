import { createHash } from 'node:crypto';

export function payloadSha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function payloadHashOk(payload: string, expected?: string): boolean {
  if (expected == null || expected === '') return true;
  return payloadSha256(payload) === expected;
}
