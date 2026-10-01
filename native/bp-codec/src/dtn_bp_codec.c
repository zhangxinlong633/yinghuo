#include "dtn_bp_codec.h"

#include "bplib.h"
#include "bplib_cbor.h"
#include "bplib_crc.h"
#include "bplib_eid.h"
#include "bplib_mem.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Time conversion (bplib / RFC 9171):
 * PrimaryBlock.Timestamp.CreateTime and PrimaryBlock.Lifetime are milliseconds,
 * not seconds. bplib's own CBOR tests store a 1 hour lifetime as 3600000.
 * The DTN epoch is 2000-01-01T00:00:00Z, which is 946684800 seconds after the
 * Unix epoch. created_at_ms is Unix milliseconds, so:
 *   CreateTime = created_at_ms - 946684800000
 * ttl_ms is copied straight into Lifetime (already milliseconds).
 */
#define DTN_EPOCH_UNIX_MS ((int64_t)946684800000LL)

/* DecodeBundle only needs a non-NULL instance for non-admin bundles.
 * The pool inside is left uninitialized; administrative records are not
 * supported on this codec-only link. */
static BPLib_Instance_t g_codec_inst;
static int g_crc_ready;

static void ensure_crc(void)
{
    if (!g_crc_ready) {
        BPLib_CRC_Init();
        g_crc_ready = 1;
    }
}

static int parse_ipn(const char *text, BPLib_EID_t *eid)
{
    unsigned long long node = 0;
    unsigned long long service = 0;
    char extra = '\0';
    int matched;

    if (text == NULL) {
        return -1;
    }
    matched = sscanf(text, "ipn:%llu.%llu%c", &node, &service, &extra);
    if (matched != 2) {
        return -1;
    }
    memset(eid, 0, sizeof(*eid));
    eid->Scheme = BPLIB_EID_SCHEME_IPN;
    eid->IpnSspFormat = BPLIB_EID_IPN_SSP_FORMAT_TWO_DIGIT;
    eid->Allocator = 0;
    eid->Node = (uint64_t)node;
    eid->Service = (uint64_t)service;
    return 0;
}

static char *format_eid(const BPLib_EID_t *eid)
{
    char tmp[80];
    int n;

    if (eid->Scheme == BPLIB_EID_SCHEME_DTN) {
        n = snprintf(tmp, sizeof(tmp), "dtn:none");
    } else {
        n = snprintf(tmp, sizeof(tmp), "ipn:%llu.%llu",
                     (unsigned long long)eid->Node,
                     (unsigned long long)eid->Service);
    }
    if (n < 0 || (size_t)n >= sizeof(tmp)) {
        return NULL;
    }
    return strdup(tmp);
}

static void free_blocks(struct BPLib_MEM_Block *block)
{
    while (block != NULL) {
        struct BPLib_MEM_Block *next = block->next;
        free(block);
        block = next;
    }
}

/* Payload bytes live in the blob chain that BPLib_MEM_CopyOutFromOffset reads. */
static struct BPLib_MEM_Block *payload_blob(const uint8_t *payload, size_t len)
{
    struct BPLib_MEM_Block *head = NULL;
    struct BPLib_MEM_Block *tail = NULL;
    size_t off = 0;

    do {
        struct BPLib_MEM_Block *block = calloc(1, sizeof(*block));
        size_t chunk;

        if (block == NULL) {
            free_blocks(head);
            return NULL;
        }
        chunk = len - off;
        if (chunk > BPLIB_MEM_BIG_BLK_DATA_SIZE) {
            chunk = BPLIB_MEM_BIG_BLK_DATA_SIZE;
        }
        if (chunk > 0 && payload != NULL) {
            memcpy(block->user_data.BigData, payload + off, chunk);
        }
        block->used_len = chunk;
        if (head == NULL) {
            head = block;
        } else {
            tail->next = block;
        }
        tail = block;
        off += chunk;
    } while (off < len);

    return head;
}

static void fill_hex32(const uint8_t *buf, size_t len, char out[65])
{
    size_t n = len < 32 ? len : 32;
    size_t i;

    for (i = 0; i < n; i++) {
        snprintf(out + (i * 2), 3, "%02x", buf[i]);
    }
    out[n * 2] = '\0';
}

static int copy_payload(const uint8_t *buf, size_t len, const BPLib_Bundle_t *bundle,
                        uint8_t **out_payload, size_t *out_len)
{
    size_t off = bundle->blocks.PayloadHeader.DataOffsetStart;
    size_t n = bundle->blocks.PayloadHeader.DataSize;
    uint8_t *copy;

    if (n > len || off > len - n) {
        return -1;
    }
    copy = malloc(n == 0 ? 1 : n);
    if (copy == NULL) {
        return -1;
    }
    if (n > 0) {
        memcpy(copy, buf + off, n);
    }
    *out_payload = copy;
    *out_len = n;
    return 0;
}

int dtn_bp_encode(
    const char *src_eid,
    const char *dst_eid,
    const uint8_t *payload,
    size_t payload_len,
    int64_t created_at_ms,
    int64_t ttl_ms,
    uint8_t **out_buf,
    size_t *out_len)
{
    BPLib_Bundle_t bundle;
    struct BPLib_MEM_Block *blob;
    int64_t create_dtn_ms;
    size_t cap;
    BPLib_Status_t status = BPLIB_ERROR;

    if (out_buf == NULL || out_len == NULL || src_eid == NULL || dst_eid == NULL) {
        return 1;
    }
    if (payload_len > 0 && payload == NULL) {
        return 1;
    }
    if (ttl_ms < 0 || created_at_ms < DTN_EPOCH_UNIX_MS) {
        return 1;
    }
    *out_buf = NULL;
    *out_len = 0;

    memset(&bundle, 0, sizeof(bundle));
    if (parse_ipn(src_eid, &bundle.blocks.PrimaryBlock.SrcEID) != 0 ||
        parse_ipn(dst_eid, &bundle.blocks.PrimaryBlock.DestEID) != 0) {
        return 1;
    }

    create_dtn_ms = created_at_ms - DTN_EPOCH_UNIX_MS;
    bundle.blocks.PrimaryBlock.ReportToEID = BPLIB_EID_DTN_NONE;
    bundle.blocks.PrimaryBlock.Timestamp.CreateTime = (uint64_t)create_dtn_ms;
    bundle.blocks.PrimaryBlock.Timestamp.SequenceNumber = 0;
    bundle.blocks.PrimaryBlock.Lifetime = (uint64_t)ttl_ms;
    bundle.blocks.PrimaryBlock.CrcType = BPLib_CRC_Type_CRC16;
    bundle.blocks.PrimaryBlock.RequiresEncode = true;
    bundle.blocks.PrimaryBlock.BundleProcFlags = 0;
    bundle.Meta.LocalBundle = true;

    bundle.blocks.PayloadHeader.BlockType = BPLib_BlockType_Payload;
    bundle.blocks.PayloadHeader.BlockNum = 1;
    bundle.blocks.PayloadHeader.BlockProcFlags = 0;
    bundle.blocks.PayloadHeader.CrcType = BPLib_CRC_Type_CRC16;
    bundle.blocks.PayloadHeader.RequiresEncode = true;
    bundle.blocks.PayloadHeader.DataOffsetStart = 0;
    bundle.blocks.PayloadHeader.DataSize = payload_len;

    blob = payload_blob(payload, payload_len);
    if (blob == NULL) {
        return 1;
    }
    bundle.blob = blob;

    ensure_crc();
    cap = payload_len + 2048;
    if (cap < 4096) {
        cap = 4096;
    }
    for (;;) {
        uint8_t *buf = malloc(cap);
        size_t copied = 0;

        if (buf == NULL) {
            free_blocks(blob);
            return 1;
        }
        status = BPLib_CBOR_EncodeBundle(&bundle, buf, cap, &copied);
        if (status == BPLIB_SUCCESS) {
            *out_buf = buf;
            *out_len = copied;
            break;
        }
        free(buf);
        if (cap >= (size_t)1024 * 1024) {
            break;
        }
        cap *= 2;
    }
    free_blocks(blob);
    return status == BPLIB_SUCCESS ? 0 : (int)status;
}

static int decode_bundle(const uint8_t *buf, size_t len, BPLib_Bundle_t *bundle)
{
    BPLib_Status_t status;

    if (buf == NULL || len == 0 || bundle == NULL) {
        return 1;
    }
    memset(bundle, 0, sizeof(*bundle));
    ensure_crc();
    status = BPLib_CBOR_DecodeBundle(&g_codec_inst, buf, len, bundle);
    return status == BPLIB_SUCCESS ? 0 : (int)status;
}

int dtn_bp_decode(const uint8_t *buf, size_t len, dtn_bp_decoded_t *out)
{
    BPLib_Bundle_t bundle;
    int status;
    char *src;
    char *dst;
    uint8_t *payload = NULL;
    size_t payload_len = 0;

    if (out == NULL) {
        return 1;
    }
    memset(out, 0, sizeof(*out));
    status = decode_bundle(buf, len, &bundle);
    if (status != 0) {
        return status;
    }
    if (copy_payload(buf, len, &bundle, &payload, &payload_len) != 0) {
        return 1;
    }
    src = format_eid(&bundle.blocks.PrimaryBlock.SrcEID);
    dst = format_eid(&bundle.blocks.PrimaryBlock.DestEID);
    if (src == NULL || dst == NULL) {
        free(src);
        free(dst);
        free(payload);
        return 1;
    }
    if (bundle.blocks.PrimaryBlock.Timestamp.CreateTime >
            (uint64_t)INT64_MAX - (uint64_t)DTN_EPOCH_UNIX_MS ||
        bundle.blocks.PrimaryBlock.Lifetime > (uint64_t)INT64_MAX) {
        free(src);
        free(dst);
        free(payload);
        return 1;
    }
    out->src_eid = src;
    out->dst_eid = dst;
    out->payload = payload;
    out->payload_len = payload_len;
    out->created_at_ms =
        (int64_t)bundle.blocks.PrimaryBlock.Timestamp.CreateTime + DTN_EPOCH_UNIX_MS;
    out->ttl_ms = (int64_t)bundle.blocks.PrimaryBlock.Lifetime;
    return 0;
}

int dtn_bp_inspect(const uint8_t *buf, size_t len, dtn_bp_inspect_t *out)
{
    BPLib_Bundle_t bundle;
    int status;
    char *src;
    char *dst;

    if (out == NULL) {
        return 1;
    }
    memset(out, 0, sizeof(*out));
    status = decode_bundle(buf, len, &bundle);
    if (status != 0) {
        return status;
    }
    src = format_eid(&bundle.blocks.PrimaryBlock.SrcEID);
    dst = format_eid(&bundle.blocks.PrimaryBlock.DestEID);
    if (src == NULL || dst == NULL) {
        free(src);
        free(dst);
        return 1;
    }
    if (bundle.blocks.PrimaryBlock.Lifetime > (uint64_t)INT64_MAX) {
        free(src);
        free(dst);
        return 1;
    }
    /* Decode rejects any version other than BPLIB_BUNDLE_PROTOCOL_VERSION.
     * bplib does not store the version field on the bundle object. */
    out->version = (int)BPLIB_BUNDLE_PROTOCOL_VERSION;
    out->src_eid = src;
    out->dst_eid = dst;
    out->lifetime_ms = (int64_t)bundle.blocks.PrimaryBlock.Lifetime;
    out->byte_length = len;
    fill_hex32(buf, len, out->hex32);
    return 0;
}

void dtn_bp_decoded_free(dtn_bp_decoded_t *v)
{
    if (v == NULL) {
        return;
    }
    free(v->src_eid);
    free(v->dst_eid);
    free(v->payload);
    memset(v, 0, sizeof(*v));
}

void dtn_bp_inspect_free(dtn_bp_inspect_t *v)
{
    if (v == NULL) {
        return;
    }
    free(v->src_eid);
    free(v->dst_eid);
    v->src_eid = NULL;
    v->dst_eid = NULL;
}

void dtn_bp_free(void *p)
{
    free(p);
}
