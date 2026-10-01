import type { RelayBundle } from '../bundle/bundle.types';
import type { RelayRuntimeConfig } from '../config';
import { encodeBundle, type BpDecoded } from './bp-codec';
import { eidForNode, nodeForEid } from './eid';

/** Permanent wire-encode failure (unknown node, bad EID scheme, codec reject). */
export class WireEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireEncodeError';
  }
}

export function toWireBundle(bundle: RelayBundle, cfg: RelayRuntimeConfig): Buffer {
  const srcEid = eidForNode(cfg, bundle.src);
  const dstEid = eidForNode(cfg, bundle.dst);
  if (!srcEid || !dstEid) {
    throw new WireEncodeError(`unknown node for wire encode src=${bundle.src} dst=${bundle.dst}`);
  }
  try {
    return encodeBundle({
      srcEid,
      dstEid,
      payload: bundle.payload,
      createdAtMs: bundle.createdAt,
      ttlMs: bundle.ttlMs,
    });
  } catch (err: unknown) {
    if (err instanceof WireEncodeError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new WireEncodeError(msg);
  }
}

export type BundleFromDecoded =
  | { ok: true; bundle: RelayBundle }
  | { ok: false; eid: string };

/** Map decoded EIDs back to plan node names. Unknown EID is a reject, not a guess. */
export function bundleFromDecoded(
  decoded: BpDecoded,
  cfg: RelayRuntimeConfig,
  id: string,
): BundleFromDecoded {
  const src = nodeForEid(cfg, decoded.srcEid);
  if (!src) return { ok: false, eid: decoded.srcEid };
  const dst = nodeForEid(cfg, decoded.dstEid);
  if (!dst) return { ok: false, eid: decoded.dstEid };
  return {
    ok: true,
    bundle: {
      id: id || `${src}-${decoded.createdAtMs}`,
      src,
      dst,
      payload: decoded.payload.toString('utf8'),
      createdAt: decoded.createdAtMs,
      ttlMs: decoded.ttlMs,
      hops: [],
      delivered: false,
    },
  };
}
