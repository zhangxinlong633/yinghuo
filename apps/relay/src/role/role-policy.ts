/** Mission roles (vision) plus legacy daemon aliases. */
export type MissionRole = 'ground' | 'orbiter' | 'lander' | 'cruise';
export type LegacyRole = 'endpoint' | 'relay' | 'hybrid';
export type NodeRole = MissionRole | LegacyRole;

export type RoleCapabilities = {
  /** Canonical mission role after alias resolve. */
  mission: MissionRole;
  /** May inject application traffic via POST /api/send. */
  canInject: boolean;
  /** May store-and-forward bundles not destined locally. */
  canRelay: boolean;
  /** Short custody / waiting semantic for status + console. */
  custodySemantics: string;
  /** One-line route bias description. */
  routeBias: string;
};

const LEGACY_TO_MISSION: Record<LegacyRole, MissionRole> = {
  endpoint: 'lander',
  relay: 'orbiter',
  hybrid: 'cruise',
};

/** Penalty (ms) added to wait+delay when preferring / avoiding neighbor roles. */
export const ROLE_PENALTY_MS = {
  prefer: 0,
  neutral: 2_000,
  avoid: 5_000,
} as const;

export function isNodeRole(value: string): value is NodeRole {
  return (
    value === 'ground' ||
    value === 'orbiter' ||
    value === 'lander' ||
    value === 'cruise' ||
    value === 'endpoint' ||
    value === 'relay' ||
    value === 'hybrid'
  );
}

export function resolveMissionRole(role: NodeRole | string): MissionRole {
  if (role === 'ground' || role === 'orbiter' || role === 'lander' || role === 'cruise') {
    return role;
  }
  if (role === 'endpoint' || role === 'relay' || role === 'hybrid') {
    return LEGACY_TO_MISSION[role];
  }
  return 'lander';
}

export function roleCapabilities(role: NodeRole | string): RoleCapabilities {
  const mission = resolveMissionRole(role);
  switch (mission) {
    case 'ground':
      return {
        mission,
        canInject: true,
        canRelay: false,
        custodySemantics: '等待上行／对中继开窗后再交班',
        routeBias: '偏好 orbiter 邻居',
      };
    case 'orbiter':
      return {
        mission,
        canInject: false,
        canRelay: true,
        custodySemantics: '中继保管，开窗后排空缓冲区',
        routeBias: '骨干：更近 + 低 cost；同成本偏好其它 orbiter',
      };
    case 'lander':
      return {
        mission,
        canInject: true,
        canRelay: false,
        custodySemantics: '等待轨道器过顶后再上交',
        routeBias: '强偏好 orbiter；避免直连 ground（除非唯一）',
      };
    case 'cruise':
      return {
        mission,
        canInject: true,
        canRelay: true,
        custodySemantics: '深空长保管，遇接触弧再交班',
        routeBias: '有窗优先交出；偏好 ground／orbiter 出口',
      };
  }
}

/**
 * Extra cost (ms) for routing from `meRole` via neighbor `nbRole`.
 * Lower is better; used as costMs = wait + delay + penalty.
 */
export function roleRoutePenalty(meRole: NodeRole | string, nbRole: NodeRole | string): number {
  const me = resolveMissionRole(meRole);
  const nb = resolveMissionRole(nbRole);
  if (me === 'lander') {
    if (nb === 'orbiter') return ROLE_PENALTY_MS.prefer;
    if (nb === 'ground') return ROLE_PENALTY_MS.avoid;
    return ROLE_PENALTY_MS.neutral;
  }
  if (me === 'ground') {
    if (nb === 'orbiter') return ROLE_PENALTY_MS.prefer;
    if (nb === 'lander') return ROLE_PENALTY_MS.avoid;
    return ROLE_PENALTY_MS.neutral;
  }
  if (me === 'orbiter') {
    if (nb === 'orbiter') return ROLE_PENALTY_MS.prefer;
    return ROLE_PENALTY_MS.neutral;
  }
  // cruise
  if (nb === 'orbiter' || nb === 'ground') return ROLE_PENALTY_MS.prefer;
  return ROLE_PENALTY_MS.neutral;
}

export function parseRole(raw: string | undefined, fallback: NodeRole = 'endpoint'): NodeRole {
  if (raw && isNodeRole(raw)) return raw;
  return fallback;
}
