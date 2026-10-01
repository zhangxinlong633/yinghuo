/*
 * codec-only link stubs.
 *
 * NASA bplib's full node (OSAL / osapi.h) does not build on this Darwin host.
 * Decode still calls BPLib_NC_GetNodeConfigValue for the max bundle length, and
 * the extension-block encoder references BPLib_AS_Increment. Neither needs a
 * live node for primary+payload bundles.
 */

#include "bplib_as.h"
#include "bplib_nc.h"

uint32_t BPLib_NC_GetNodeConfigValue(BPLib_NC_Config_t Config)
{
    (void)Config;
    /* No node-config table in the codec-only link. Ceiling is above
     * BPLIB_MAX_BUNDLE_LEN so a normal demo bundle is not rejected. */
    return 1048576u;
}

void BPLib_AS_Increment(BPLib_EID_t EID, BPLib_AS_Counter_t Counter, uint32_t Amount)
{
    (void)EID;
    (void)Counter;
    (void)Amount;
}
