# 多主机常驻部署

本机 `npm run relay:earth` 三进程是开发默认。要常驻一台 Linux（开发板、云主机、NAS 上的 LXC），用本文。K8s 教学映射仍见 [`k8s-dtn-scheduling.md`](./k8s-dtn-scheduling.md)，不替代这一档。

参考实例：Ubuntu 24.04 LXC（QNAP Container Station），x86_64，Node 18。仓库放 `/opt/yinghuo`，systemd 拉起 Earth `:3101`、Relay `:3103`、Mars `:3102`。外网用 Tailscale 访问，不必把 22／3101 映射到公网。

## 依赖

```bash
sudo apt-get update
sudo apt-get install -y git build-essential cmake python3 ca-certificates \
  curl nodejs npm libsqlite3-dev
node -v   # >= 18
```

| 包 | 为什么 |
|----|--------|
| `build-essential`／`cmake` | 编 `libdtn_bp_codec.so` |
| `libsqlite3-dev` | bplib 头文件会 `#include <sqlite3.h>`（即使 codec-only） |
| `nodejs`／`npm` | Nest relay + tsx |

Linux 链接需要 `libm`（仓库 CMake 已链 `-lm`）。LXC／容器要有 `/dev/net/tun` 才能跑 Tailscale；萤火本身只听 TCP。

## 安装

```bash
git clone --depth 1 https://github.com/zhangxinlong633/yinghuo.git /opt/yinghuo
cd /opt/yinghuo
npm install
npm run native:build -w @yinghuo/relay
# 产物：native/bp-codec/build/libdtn_bp_codec.so
ls native/bp-codec/build/libdtn_bp_codec.so
```

## systemd 三节点（同机）

三份 unit 在 [`deploy/systemd/`](../deploy/systemd/)。若仓库不在 `/opt/yinghuo`，改 `WorkingDirectory`。

```bash
sudo cp deploy/systemd/yinghuo-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yinghuo-earth yinghuo-relay yinghuo-mars
sudo systemctl is-active yinghuo-earth yinghuo-relay yinghuo-mars
```

日志：`journalctl -u yinghuo-earth -f`。

进程默认听 `*:3101` 等（Nest `listen(port)`）。同机三节点互相用 `127.0.0.1` 当 peer，接触计划不用改。数据在 `data/Earth|Relay|Mars/`。

## 远程访问

| 路径 | 做法 |
|------|------|
| 同一局域网 | `http://<内网IP>:3101/` |
| 出门 | 主机与笔记本都加入同一 Tailscale 网，浏览器打开 `http://<100.x>:3101/` |
| SSH | `ssh root@<100.x>` 或内网 IP |

不要把 22／控制台端口对 `0.0.0.0/0` 裸开。Tailscale 已够演示档。

控制台：

- Earth http://\<host\>:3101/
- Relay http://\<host\>:3103/
- Mars http://\<host\>:3102/

## 更新

```bash
cd /opt/yinghuo
git pull
npm install
npm run native:build -w @yinghuo/relay
sudo systemctl restart yinghuo-earth yinghuo-relay yinghuo-mars
```

## 三台物理机（各一角色）

计划模板：`apps/relay/contact-plan.tri-hosts.json`。启动前导出对端 URL（可用 Tailscale `100.x`）：

```bash
export EARTH_URL=http://100.a.a.a:3101
export RELAY_URL=http://100.b.b.b:3103
export MARS_URL=http://100.c.c.c:3102
```

每台：

```bash
export CONTACT_PLAN=/opt/yinghuo/apps/relay/contact-plan.tri-hosts.json
# Earth
NODE_ID=Earth PORT=3101 npm run start:earth -w @yinghuo/relay
# Relay
NODE_ID=Relay PORT=3103 npm run start:relay -w @yinghuo/relay
# Mars
NODE_ID=Mars PORT=3102 npm run start:mars -w @yinghuo/relay
```

`PEER_URL` 环境变量若设置会覆盖计划里的 `peerUrl`。三机时钟尽量 NTP；任务历元另见 `MISSION_EPOCH_MS`（[`docs/interop.md`](./interop.md)）。

## 远程 MCP（HTTP）

`/etc/yinghuo/mcp.env`：

```
YINGHUO_MCP_TOKEN=改成随机串
YINGHUO_MCP_MODE=read
YINGHUO_MCP_AUDIT=/var/log/yinghuo-mcp-audit.jsonl
```

```bash
sudo cp deploy/systemd/yinghuo-mcp-http.service /etc/systemd/system/
sudo systemctl enable --now yinghuo-mcp-http
curl -H "Authorization: Bearer $YINGHUO_MCP_TOKEN" -X POST \
  http://127.0.0.1:3110/tools/yinghuo_status
```

stdio MCP 仍用 `npm run mcp`（本机 Agent）。HTTP 是常驻机入口，**必须**设 token。
