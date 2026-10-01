import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';

export type BpDecoded = {
  srcEid: string;
  dstEid: string;
  payload: Buffer;
  createdAtMs: number;
  ttlMs: number;
};

export type BpInspect = {
  version: number;
  srcEid: string;
  dstEid: string;
  lifetimeMs: number;
  byteLength: number;
  hex32: string;
};

const DtnBpDecoded = koffi.struct('dtn_bp_decoded_t', {
  src_eid: 'char *',
  dst_eid: 'char *',
  payload: 'uint8_t *',
  payload_len: 'size_t',
  created_at_ms: 'int64_t',
  ttl_ms: 'int64_t',
});

const DtnBpInspect = koffi.struct('dtn_bp_inspect_t', {
  version: 'int',
  src_eid: 'char *',
  dst_eid: 'char *',
  lifetime_ms: 'int64_t',
  byte_length: 'size_t',
  hex32: 'char [65]',
});

type BpCodecNative = {
  dtn_bp_encode: (
    srcEid: string,
    dstEid: string,
    payload: Buffer,
    payloadLen: number,
    createdAtMs: number | bigint,
    ttlMs: number | bigint,
    outBuf: unknown,
    outLen: unknown,
  ) => number;
  dtn_bp_decode: (buf: Buffer, len: number, out: unknown) => number;
  dtn_bp_inspect: (buf: Buffer, len: number, out: unknown) => number;
  dtn_bp_decoded_free: (v: unknown) => void;
  dtn_bp_inspect_free: (v: unknown) => void;
  dtn_bp_free: (p: unknown) => void;
};

let native: BpCodecNative | null = null;

/** Monorepo root: apps/relay/src/bp → ../../../.. */
function monorepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function defaultLibPath(): string {
  if (process.env.DTN_BP_CODEC_LIB) {
    return path.resolve(process.env.DTN_BP_CODEC_LIB);
  }
  const libName =
    process.platform === 'darwin' ? 'libdtn_bp_codec.dylib' : 'libdtn_bp_codec.so';
  return path.resolve(monorepoRoot(), 'native/bp-codec/build', libName);
}

function ensureLoaded(): BpCodecNative {
  if (!native) {
    throw new Error('BP codec not loaded: call loadBpCodec() first');
  }
  return native;
}

export function loadBpCodec(libPath?: string): void {
  const resolved = libPath ?? defaultLibPath();
  if (!fs.existsSync(resolved)) {
    throw new Error(`BP codec library not found: ${resolved}`);
  }

  const lib = koffi.load(resolved);
  native = {
    dtn_bp_encode: lib.func(
      'int dtn_bp_encode(const char *src_eid, const char *dst_eid, const uint8_t *payload, size_t payload_len, int64_t created_at_ms, int64_t ttl_ms, _Out_ uint8_t **out_buf, _Out_ size_t *out_len)',
    ),
    dtn_bp_decode: lib.func(
      'int dtn_bp_decode(const uint8_t *buf, size_t len, _Out_ dtn_bp_decoded_t *out)',
    ),
    dtn_bp_inspect: lib.func(
      'int dtn_bp_inspect(const uint8_t *buf, size_t len, _Out_ dtn_bp_inspect_t *out)',
    ),
    dtn_bp_decoded_free: lib.func('void dtn_bp_decoded_free(dtn_bp_decoded_t *v)'),
    dtn_bp_inspect_free: lib.func('void dtn_bp_inspect_free(dtn_bp_inspect_t *v)'),
    dtn_bp_free: lib.func('void dtn_bp_free(void *p)'),
  };
}

export function encodeBundle(input: {
  srcEid: string;
  dstEid: string;
  payload: Buffer | string;
  createdAtMs: number;
  ttlMs: number;
}): Buffer {
  const n = ensureLoaded();
  const payload =
    typeof input.payload === 'string' ? Buffer.from(input.payload, 'utf8') : input.payload;

  const outBuf: unknown[] = [null];
  const outLen: unknown[] = [0];
  const rc = n.dtn_bp_encode(
    input.srcEid,
    input.dstEid,
    payload,
    payload.length,
    input.createdAtMs,
    input.ttlMs,
    outBuf,
    outLen,
  );
  if (rc !== 0) {
    throw new Error(`dtn_bp_encode failed with code ${rc}`);
  }

  const ptr = outBuf[0];
  const len = Number(outLen[0]);
  try {
    const bytes = koffi.decode(ptr, 'uint8_t', len) as number[];
    return Buffer.from(bytes);
  } finally {
    n.dtn_bp_free(ptr);
  }
}

export function decodeBundle(buf: Buffer): BpDecoded {
  const n = ensureLoaded();
  const out = koffi.alloc(DtnBpDecoded, 1);
  const rc = n.dtn_bp_decode(buf, buf.length, out);
  if (rc !== 0) {
    throw new Error(`dtn_bp_decode failed with code ${rc}`);
  }

  try {
    const raw = koffi.decode(out, DtnBpDecoded) as {
      src_eid: string;
      dst_eid: string;
      payload: unknown;
      payload_len: number | bigint;
      created_at_ms: number | bigint;
      ttl_ms: number | bigint;
    };
    const payloadLen = Number(raw.payload_len);
    const payloadBytes = koffi.decode(raw.payload, 'uint8_t', payloadLen) as number[];
    return {
      srcEid: raw.src_eid,
      dstEid: raw.dst_eid,
      payload: Buffer.from(payloadBytes),
      createdAtMs: Number(raw.created_at_ms),
      ttlMs: Number(raw.ttl_ms),
    };
  } finally {
    n.dtn_bp_decoded_free(out);
  }
}

export function inspectBundle(buf: Buffer): BpInspect {
  const n = ensureLoaded();
  const out = koffi.alloc(DtnBpInspect, 1);
  const rc = n.dtn_bp_inspect(buf, buf.length, out);
  if (rc !== 0) {
    throw new Error(`dtn_bp_inspect failed with code ${rc}`);
  }

  try {
    const raw = koffi.decode(out, DtnBpInspect) as {
      version: number;
      src_eid: string;
      dst_eid: string;
      lifetime_ms: number | bigint;
      byte_length: number | bigint;
      hex32: string;
    };
    return {
      version: raw.version,
      srcEid: raw.src_eid,
      dstEid: raw.dst_eid,
      lifetimeMs: Number(raw.lifetime_ms),
      byteLength: Number(raw.byte_length),
      hex32: raw.hex32,
    };
  } finally {
    n.dtn_bp_inspect_free(out);
  }
}
