#include "dtn_bp_codec.h"

#include <stdio.h>
#include <string.h>

int main(void)
{
    const uint8_t hello[] = "hello";
    uint8_t *buf = NULL;
    size_t len = 0;
    dtn_bp_decoded_t decoded;
    dtn_bp_inspect_t inspected;
    int status;

    status = dtn_bp_encode("ipn:1.1", "ipn:3.1", hello, 5, 1700000000000LL, 3600000, &buf, &len);
    if (status != 0 || buf == NULL || len == 0) {
        fprintf(stderr, "encode failed: %d\n", status);
        return 1;
    }

    memset(&decoded, 0, sizeof(decoded));
    status = dtn_bp_decode(buf, len, &decoded);
    if (status != 0) {
        fprintf(stderr, "decode failed: %d\n", status);
        dtn_bp_free(buf);
        return 1;
    }
    if (decoded.payload_len != 5 || memcmp(decoded.payload, "hello", 5) != 0) {
        fprintf(stderr, "payload mismatch\n");
        dtn_bp_decoded_free(&decoded);
        dtn_bp_free(buf);
        return 1;
    }
    if (strcmp(decoded.src_eid, "ipn:1.1") != 0 || strcmp(decoded.dst_eid, "ipn:3.1") != 0) {
        fprintf(stderr, "eid mismatch src=%s dst=%s\n", decoded.src_eid, decoded.dst_eid);
        dtn_bp_decoded_free(&decoded);
        dtn_bp_free(buf);
        return 1;
    }
    if (decoded.ttl_ms != 3600000 || decoded.created_at_ms != 1700000000000LL) {
        fprintf(stderr, "time mismatch created=%lld ttl=%lld\n",
                (long long)decoded.created_at_ms, (long long)decoded.ttl_ms);
        dtn_bp_decoded_free(&decoded);
        dtn_bp_free(buf);
        return 1;
    }

    memset(&inspected, 0, sizeof(inspected));
    status = dtn_bp_inspect(buf, len, &inspected);
    if (status != 0 || inspected.version != 7 || inspected.byte_length != len ||
        inspected.lifetime_ms != 3600000 || inspected.hex32[0] == '\0') {
        fprintf(stderr, "inspect failed: %d version=%d\n", status, inspected.version);
        dtn_bp_inspect_free(&inspected);
        dtn_bp_decoded_free(&decoded);
        dtn_bp_free(buf);
        return 1;
    }

    printf("ok bytes=%zu hex=%s src=%s dst=%s\n",
           inspected.byte_length, inspected.hex32, inspected.src_eid, inspected.dst_eid);

    dtn_bp_inspect_free(&inspected);
    dtn_bp_decoded_free(&decoded);
    dtn_bp_free(buf);
    return 0;
}
