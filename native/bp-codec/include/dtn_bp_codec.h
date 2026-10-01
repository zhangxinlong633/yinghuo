#ifndef DTN_BP_CODEC_H
#define DTN_BP_CODEC_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#define DTN_BP_API __declspec(dllexport)
#elif defined(__GNUC__)
#define DTN_BP_API __attribute__((visibility("default")))
#else
#define DTN_BP_API
#endif

typedef struct {
  char *src_eid;
  char *dst_eid;
  uint8_t *payload;
  size_t payload_len;
  int64_t created_at_ms;
  int64_t ttl_ms;
} dtn_bp_decoded_t;

typedef struct {
  int version;
  char *src_eid;
  char *dst_eid;
  int64_t lifetime_ms;
  size_t byte_length;
  char hex32[65]; /* first 32 bytes as hex + NUL; shorter bundles pad unused with shorter string */
} dtn_bp_inspect_t;

DTN_BP_API int dtn_bp_encode(
  const char *src_eid,
  const char *dst_eid,
  const uint8_t *payload,
  size_t payload_len,
  int64_t created_at_ms,
  int64_t ttl_ms,
  uint8_t **out_buf,
  size_t *out_len
); /* 0 = ok */

DTN_BP_API int dtn_bp_decode(const uint8_t *buf, size_t len, dtn_bp_decoded_t *out); /* 0 = ok */
DTN_BP_API int dtn_bp_inspect(const uint8_t *buf, size_t len, dtn_bp_inspect_t *out); /* 0 = ok */
DTN_BP_API void dtn_bp_decoded_free(dtn_bp_decoded_t *v);
DTN_BP_API void dtn_bp_inspect_free(dtn_bp_inspect_t *v);
DTN_BP_API void dtn_bp_free(void *p);

#ifdef __cplusplus
}
#endif

#endif /* DTN_BP_CODEC_H */
