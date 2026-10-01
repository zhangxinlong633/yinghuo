import type { DualContact, DualContactPlan, DualNodeConfig } from '../bundle/bundle.types';
import { isNodeRole } from '../role/role-policy';

export type PlanValidationResult =
  | { ok: true; plan: DualContactPlan }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateSchedule(schedule: unknown, label: string, errors: string[]): void {
  if (!isRecord(schedule)) {
    errors.push(`${label}: schedule required`);
    return;
  }
  const type = schedule.type ?? 'cyclic';
  if (type === 'absolute') {
    if (!Array.isArray(schedule.windows) || schedule.windows.length === 0) {
      errors.push(`${label}: absolute schedule needs non-empty windows`);
      return;
    }
    schedule.windows.forEach((w, i) => {
      if (!isRecord(w)) {
        errors.push(`${label}.windows[${i}]: object required`);
        return;
      }
      const start =
        typeof w.offsetStartMs === 'number'
          ? w.offsetStartMs
          : typeof w.startMs === 'number'
            ? w.startMs
            : NaN;
      const end =
        typeof w.offsetEndMs === 'number'
          ? w.offsetEndMs
          : typeof w.endMs === 'number'
            ? w.endMs
            : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        errors.push(`${label}.windows[${i}]: start/end ms required`);
      } else if (end <= start) {
        errors.push(`${label}.windows[${i}]: end must be > start`);
      }
    });
    return;
  }
  if (type !== 'cyclic') {
    errors.push(`${label}: schedule.type must be cyclic or absolute`);
    return;
  }
  for (const key of ['periodMs', 'openOffsetMs', 'openDurationMs'] as const) {
    const n = schedule[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      errors.push(`${label}: ${key} must be a non-negative number`);
    }
  }
  const period = schedule.periodMs as number | undefined;
  const dur = schedule.openDurationMs as number | undefined;
  if (typeof period === 'number' && typeof dur === 'number' && period > 0 && dur > period) {
    errors.push(`${label}: openDurationMs cannot exceed periodMs`);
  }
}

function validateNode(node: unknown, index: number, errors: string[]): void {
  if (!isRecord(node)) {
    errors.push(`nodes[${index}]: object required`);
    return;
  }
  if (typeof node.name !== 'string' || !node.name) {
    errors.push(`nodes[${index}]: name required`);
  }
  if (node.role != null && typeof node.role === 'string' && !isNodeRole(node.role)) {
    errors.push(`nodes[${index}]: unknown role ${node.role}`);
  }
  if (node.port != null && (typeof node.port !== 'number' || !Number.isFinite(node.port))) {
    errors.push(`nodes[${index}]: port must be a number`);
  }
}

function validateContact(contact: unknown, index: number, errors: string[]): void {
  if (!isRecord(contact)) {
    errors.push(`contacts[${index}]: object required`);
    return;
  }
  if (typeof contact.a !== 'string' || !contact.a) errors.push(`contacts[${index}]: a required`);
  if (typeof contact.b !== 'string' || !contact.b) errors.push(`contacts[${index}]: b required`);
  if (typeof contact.delayMs !== 'number' || !Number.isFinite(contact.delayMs) || contact.delayMs < 0) {
    errors.push(`contacts[${index}]: delayMs must be a non-negative number`);
  }
  validateSchedule(contact.schedule, `contacts[${index}]`, errors);
}

/**
 * Structural validation of a contact plan (pre- or post-normalize).
 * Does not mutate input.
 */
export function validateContactPlan(
  raw: unknown,
  opts: { nodeId: string; graphMode: boolean },
): PlanValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['plan must be a JSON object'] };
  }
  if (!Array.isArray(raw.nodes)) errors.push('nodes array required');
  else raw.nodes.forEach((n, i) => validateNode(n, i, errors));

  if (!Array.isArray(raw.contacts)) errors.push('contacts array required');
  else raw.contacts.forEach((c, i) => validateContact(c, i, errors));

  if (errors.length) return { ok: false, errors };

  const plan = raw as unknown as DualContactPlan;
  const nodeId = opts.nodeId;
  const node = plan.nodes.find((n: DualNodeConfig) => n.name === nodeId);
  if (!node && !opts.graphMode) {
    errors.push(`NODE_ID=${nodeId} not found in plan.nodes`);
  }
  if (!opts.graphMode) {
    const local = plan.contacts.find(
      (c: DualContact) => c.a === nodeId || c.b === nodeId,
    );
    if (!local) errors.push(`no contact involving NODE_ID=${nodeId}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan };
}
