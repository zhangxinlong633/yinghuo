# libdtn_bp_codec

Thin C wrapper around NASA bplib `BPLib_CBOR_EncodeBundle` / `BPLib_CBOR_DecodeBundle`.

## codec-only 链接

macOS 上完整 bplib 构建会因为缺少 NASA OSAL 头文件 `osapi.h` 失败。本目录因此只编译 bplib `ci/cbor` 源码，加上它们直接调用的 CRC、EID、内存拷贝实现，并链接 QCBOR v1.5.1。

`BPLib_CBOR_DecodeBundle` 仍需要一个 `BPLib_Instance_t *`。包装里放了一个零初始化实例，只用于满足该签名。节点配置与统计计数是空桩（`BPLib_NC_GetNodeConfigValue`、`BPLib_AS_Increment`），不启动 OSAL、存储或转发。

主块布局来自 bplib 的 CBOR 编码器，不是手写的另一套 primary block。

## Build

```bash
cd native/bp-codec
./scripts/fetch-deps.sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/dtn_bp_codec_smoke
```

macOS 产物：`build/libdtn_bp_codec.dylib`。
