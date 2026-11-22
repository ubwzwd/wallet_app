# 部署与运维手册

目标：把 Wallet App 部署到一台 AWS Lightsail 虚拟机（Ubuntu 24.04，1 GB 内存起），用一个 HTTPS 域名访问。

分工约定：**浏览器里的操作由你做**（Lightsail 控制台、域名网站），**笔记本和 VM 上的命令由 Claude 代跑**。文中 `<域名>`、`<ip>` 是占位，换成你自己的值。

## 0. 这套东西长什么样

四个容器跑在 VM 上，由 Docker Compose 管理（项目名 `wallet`）。Caddy 负责 HTTPS 证书、反代 API、托管前端静态文件。

```text
浏览器 ──443──> caddy ──/api/* 和 /health──> api:8000 ──> db:5432 (Postgres)
                  │
                  └── 其余路径：静态 dist（找不到就回退 index.html）
migrate：每次 up 时先跑一次 alembic upgrade head，跑完退出；api 等它成功后才启动
```

- 镜像在 VM 上原生 build（x86 或 ARM 都行，Dockerfile 不钉平台）。1 GB 的机器靠初始化脚本建的 2 GB swap 撑过 build 的内存峰值。
- 前端在笔记本上 build，把 `frontend/dist/` rsync 到 VM。VM 上不需要 git，也不需要 Node。
- api 只有一个 uvicorn 进程（限流是进程内的），不要加 `--workers`，也不要起第二个副本。
- api 不对外开端口，不挂数据卷；数据只在 Postgres 的卷 `pgdata` 里。

| 文件 | 作用 |
| --- | --- |
| `infra/docker-compose.prod.yml` | 四个服务（db / migrate / api / caddy）、三个卷（`pgdata` / `caddy_data` / `caddy_config`）、日志轮转 |
| `infra/Caddyfile` | 域名站点、`/api/*` 与 `/health` 反代、静态托管与 SPA 回退、缓存头 |
| `infra/.env.example` | 配置模板，复制成 `infra/.env`（不进 git）后填值 |
| `infra/Dockerfile.api` | 后端镜像：`backend/requirements.txt` 钉死的依赖，uvicorn 带 `--proxy-headers --forwarded-allow-ips=*` |
| `infra/scripts/vm-bootstrap.sh` | VM 一次性初始化（可重复跑） |
| `infra/scripts/deploy.sh` | 笔记本上跑：构建前端、rsync、远端 `up -d --build` |
| `infra/scripts/backup.sh` | VM 上跑：`pg_dump` 到 `backups/`，保留最近 14 份 |
| `infra/scripts/restore.sh` | VM 上跑：先留一份当前库的安全备份，再整库重建并恢复指定的 dump |
| `infra/scripts/smoke.sh` | 笔记本上跑：本机用独立项目名和端口把整套栈跑一遍（不碰线上） |
| `infra/scripts/env-coverage.sh` | 检查 `.env.example` 是否覆盖后端全部配置项 |

## 1. 在 Lightsail 控制台建 VM（你做）

打开 lightsail.aws.amazon.com（用 AWS 账户登录），点 Create instance：

1. Instance location：选离你们最近的区域（例如 Singapore 或 Tokyo）。
2. Platform 选 **Linux/Unix**，Blueprint 选 **OS Only → Ubuntu 24.04 LTS**。不要选带应用的蓝图。
3. SSH key pair：点 Change SSH key pair → Upload new，上传笔记本上的 `~/.ssh/wallet_app_oci.pub`（文件名里的 oci 只是历史名字，密钥通用）。WSL 里的文件在 Windows 资源管理器地址栏输入 `\\wsl$` 可以找到；也可以先 `cp ~/.ssh/wallet_app_oci.pub /mnt/c/Users/<你的用户名>/Desktop/` 再上传。
4. Network type：选 **Dual-stack**（带公网 IPv4）。IPv6-only 的套餐便宜一点，但很多网络访问不了，不要选。
5. Instance plan：**1 GB 内存**那一档就够（整套栈常驻不到 1 GB，初始化脚本会加 swap）。价格以页面为准。之后不够可以做快照再用更大的套餐恢复。
6. Instance name：`wallet`。
7. Create instance。等状态变成 Running。

**固定公网 IP**（建好后马上做，在第 2 步配域名之前）：

1. 点进实例 → Networking → Attach static IP → 起个名字（例如 `wallet-ip`）→ Create and attach。
2. 记下这个 **Static IP**。静态 IP 挂在实例上时不另收费；不挂的话实例每次停止再启动 IP 都会变。

**放行 443（云端防火墙）**：

1. 同一个 Networking 页，IPv4 Firewall → Add rule，加两条：
   - Application 选 HTTPS（TCP 443）
   - Application 选 Custom，Protocol UDP，Port `443`（HTTP/3 用）
2. SSH（22）和 HTTP（80）默认已经有，确认一下在列表里。
3. 如果启用了 IPv6，在 IPv6 Firewall 里加同样两条。

提示：

- Lightsail 的 Ubuntu 镜像主机上没有额外的 iptables 规则，只有上面这一层云端防火墙要开。
- 删除实例才停止计费，只是 Stop 仍然收费。删除前先确认备份已经拷出来（第 6 步）。
- 换别家 VPS（或 OCI）也能用同一套脚本，要求是：Ubuntu 24.04、登录用户 `ubuntu` 且免密 sudo、公网 IPv4、云端防火墙放行 tcp 80 / tcp 443 / udp 443。登录用户不是 `ubuntu` 时设 `WALLET_VM_USER`。

## 2. 域名（你做）

默认用 DuckDNS（免费）：

1. 打开 duckdns.org，用 GitHub / Google 等账号登录。
2. 在 sub domain 输入框填一个名字（例如 `myfamily-wallet`），点 add domain。
3. 在这个域名那一行的 current ip 填 VM 的 Public IP，点 update ip。
4. 你的域名就是 `myfamily-wallet.duckdns.org`。

备选 sslip.io：不用注册，域名自带解析。IP 是 `1.2.3.4` 时，域名写 `1.2.3.4.sslip.io`（或 `1-2-3-4.sslip.io`）。注意 Let's Encrypt 对它的签发限额是 sslip.io 所有用户共享的，可能签不下来，只当应急用。

验证解析（Claude 在笔记本上跑）：

```bash
getent hosts <域名>
```

输出的 IP 应该就是 VM 的公网 IP。没有输出就再等几分钟。

## 3. 笔记本 SSH 准备（Claude 做）

在 `~/.ssh/config` 里加：

```text
Host wallet-vm
    HostName <ip>
    User ubuntu
    IdentityFile ~/.ssh/wallet_app_oci
    IdentitiesOnly yes
```

第一次连接，核对指纹提示后输入 `yes`：

```bash
ssh wallet-vm
```

Lightsail 的 Ubuntu 镜像默认只允许密钥登录，不用再改 SSH 配置。登录后 `exit` 回到笔记本。

## 4. 初始化 VM

在仓库根目录（笔记本）执行：

```bash
ssh wallet-vm 'bash -s' < infra/scripts/vm-bootstrap.sh
```

脚本可以重复跑，按顺序做这些事：

1. `apt update` 加 `dist-upgrade`，装 `ca-certificates curl gnupg rsync cron unattended-upgrades`。
2. 主机防火墙：主机上有 `/etc/iptables/rules.v4` 时（只有 OCI 的镜像有），把 tcp 80、tcp 443、udp 443 插到 22 端口规则之后、末尾 REJECT 之前并持久化；Lightsail 上没有这个文件，这一步自动跳过。
3. 从 Docker 官方 apt 源装 Docker CE 和 compose 插件（架构按 `dpkg --print-architecture` 自动取），已装则跳过；把 `ubuntu` 加进 `docker` 组；设置开机自启。
4. 打开 unattended-upgrades（自动装安全补丁）。
5. 内存不到 2 GB 且还没有 swap 时，建一个 2 GB 的 `/swapfile` 并写进 `/etc/fstab`，`vm.swappiness=10`。
6. 建 `/opt/wallet_app` 和 `/opt/wallet_app/backups`，属主 `ubuntu`。

结束时脚本会打印 Docker 版本；如果提示 `a reboot is pending`，现在重启一次：

```bash
ssh wallet-vm 'sudo reboot'
```

等一分钟再连。**一定要开一个新的 ssh 会话**，`docker` 组才对 `ubuntu` 生效。

也可以在第一次部署时用 `bash infra/scripts/deploy.sh --bootstrap`，它会先跑同一个初始化脚本。

## 5. 第一次部署

**(a) 同步文件。** 在笔记本仓库根目录：

```bash
bash infra/scripts/deploy.sh
```

它会构建前端（1–2 分钟）、rsync 文件到 VM，然后因为 VM 上还没有 `infra/.env` 而停下，退出码 3，并打印提示。**这是预期的。**

**(b) 在 VM 上写 `.env`。**

```bash
ssh wallet-vm
cd /opt/wallet_app
cp infra/.env.example infra/.env
openssl rand -hex 32    # 跑两次，一次给 POSTGRES_PASSWORD，一次给 SECRET_KEY
nano infra/.env
chmod 600 infra/.env
```

要改的值：

| 键 | 填什么 |
| --- | --- |
| `POSTGRES_PASSWORD` | 一串 `openssl rand -hex 32` 的输出 |
| `SECRET_KEY` | 另一串 `openssl rand -hex 32` 的输出 |
| `DATABASE_URL` | 完整写出：`postgresql://wallet:<POSTGRES_PASSWORD>@db:5432/wallet`（主机名是 `db`，不是 localhost；不会自动展开变量，必须手写完整） |
| `CADDY_DOMAIN` | `<域名>` |
| `ALLOWED_ORIGINS` | `https://<域名>` |

其余保持模板里的默认值。改完检查没有漏改的占位：

```bash
grep CHANGE_ME infra/.env    # 应该没有输出
```

这个文件只存在于 VM（权限 600）。建议把里面的 `SECRET_KEY` 和数据库口令也存进密码管理器。`POSTGRES_PASSWORD` 只在数据库第一次创建时生效，之后改 `.env` 不会改库里的口令，所以第一次就填对。

**(c) 再部署一次。** 回到笔记本（前端刚构建过，加 `--no-web` 省时间）：

```bash
bash infra/scripts/deploy.sh --no-web
```

这一步会在 VM 上 `up -d --build --wait`（首次 build 镜像约 2–5 分钟），并加上每天的备份 cron。

**(d) 确认成功。** 在 VM 上：

```bash
cd /opt/wallet_app
docker compose -p wallet ps
curl -s https://<域名>/health
```

`ps` 里 `db`、`api`、`caddy` 应该是 running / healthy；`migrate` 跑完就退出，不在列表里是正常的（`ps -a` 能看到它 Exited (0)）。`/health` 应返回 `{"status":"healthy",...}`。

首次签证书要几十秒。证书没好之前浏览器会报错，看进度：

```bash
docker compose -p wallet logs -f caddy
```

**(e) 注册第一个用户。** 浏览器打开 `https://<域名>`，注册。注册会自动建第一本账本，这个用户就是它的 owner。家人也注册完之后，可以关闭注册：

```bash
cd /opt/wallet_app
sed -i 's/^REGISTRATION_OPEN=.*/REGISTRATION_OPEN=false/' infra/.env
docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml up -d api
```

以后要再开放，把同一行改回 `true` 再 `up -d api` 一次。

## 6. 日常

**更新代码。** 在笔记本上，代码就绪后：

```bash
bash infra/scripts/deploy.sh
```

它做的事：检查 ssh 通不通 → 构建前端 → rsync `backend/`、`skills/`、`infra/`、`frontend/dist/` 到 VM（VM 上的 `infra/.env` 不会被覆盖）→ 远端 `docker compose up -d --build --wait` → 清理悬空镜像 → 确保备份 cron 在 → 检查 `https://<域名>/health`。通常 3–8 分钟，大头是前端构建和镜像构建。只改了后端时可以加 `--no-web`；想先看会同步什么，加 `--dry-run`。

失败时脚本会自动打印 `compose ps` 和最近 100 行日志；之后想再看，用下一条。最后的公网 `/health` 检查只是提示，不通也不算部署失败。

**看日志。** 在 VM 上：

```bash
docker compose -p wallet logs --tail=200 api
docker compose -p wallet logs --tail=200 caddy
docker compose -p wallet logs --tail=200 db
```

每个服务的日志最多保留 3 个 10 MB 文件，不会撑满磁盘。

**备份。** 每天北京时间 03:00（UTC 19:00），`ubuntu` 的 cron 会跑 `backup.sh`，把 `wallet-<UTC 时间>.dump` 写进 `/opt/wallet_app/backups/`，保留最近 14 份，日志在同目录的 `backup.log`。查看 cron 和已有备份：

```bash
crontab -l
ls -lh /opt/wallet_app/backups/
```

手动备份一次：

```bash
cd /opt/wallet_app && bash infra/scripts/backup.sh
```

备份只在 VM 本机，VM 坏了就一起没了。**建议每月把备份拉回笔记本一次**：

```bash
rsync -az wallet-vm:/opt/wallet_app/backups/ ~/wallet-backups/
```

**恢复。** 在 VM 上，用某份备份覆盖当前数据库：

```bash
cd /opt/wallet_app
bash infra/scripts/restore.sh backups/wallet-<时间>.dump --yes
```

它会先停 api，把**当前**数据库先存一份到 `backups/pre-restore-<时间>.dump`（恢复错了可以用同一个命令倒回去），然后整库删掉重建、把 dump 灌进去，再启动 api 并等 `/health` 通过。db 和 caddy 不停。不加 `--yes` 会要求你输入 `yes` 确认。**备份之后写入的数据会丢。** 备份文件在笔记本上时，先用 `rsync` 传回 VM 的 `backups/` 再恢复。

dump 里带着迁移版本。api 启动时会先自动跑 migrate，所以 dump 比现在的代码旧没关系，会自动升到最新；dump 比代码新（比如从更新的版本回滚代码之后）时 migrate 会失败、api 保持停止，脚本会说明，这时要先部署与 dump 匹配的代码。

**重置某个人的密码。** 应用没有「忘记密码」（决策 §9），有人忘了就由你重置：

```bash
ssh wallet-vm
cd /opt/wallet_app && docker compose -p wallet exec api python scripts/reset_password.py <邮箱>
```

脚本会交互地让你输入两遍新密码（不回显，也不会出现在任何输出里；密码至少 8 个字符、UTF-8 不超过 72 字节），成功后打印 `password reset for <邮箱>; N session(s) revoked`。邮箱不存在时退出码是 1。重置的同时，这个人在**所有设备**上的刷新令牌都会被吊销，也就是所有设备都会下线；已经签发的访问令牌最多还能再用 30 分钟（决策 §14.67 g）。把新密码用别的渠道告诉他。

**登录有效期。** 登录状态由两个令牌组成（决策 §14.67），各管一件事，都在 VM 的 `infra/.env` 里配：

| 变量 | 默认 | 管什么 |
| --- | --- | --- |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 30 | 访问令牌的寿命。它过期后，网页会用刷新令牌静默换一个新的，用户无感 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 90 | 刷新令牌的**闲置**期限：连续这么多天没有用它，才需要重新输入密码；每次换新都从当天重新算 |

改完 `.env` 后在 VM 上 `cd /opt/wallet_app && docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml up -d api` 生效（已经签发的令牌不受影响，按它们签发时的期限走）。

**一次性：部署带刷新令牌的这一版时。** 先在 VM 的 `/opt/wallet_app/infra/.env` 里设好 `ACCESS_TOKEN_EXPIRE_MINUTES=30`，再照常 `up -d api`。这一版之前签发的登录状态没有刷新令牌，所以每个人要在旧访问令牌过期时重新登录一次（或者马上退出再登录）。

**紧急让所有人下线。** 换掉 `.env` 里的 `SECRET_KEY`（`openssl rand -hex 32`）后 `up -d api`：所有访问令牌立刻失效。但**刷新令牌还在库里**，网页收到 401 会拿它换出新的访问令牌，人并不会真的下线。要彻底清，再把库里的刷新令牌全部吊销：

```bash
docker compose -p wallet exec db psql -U wallet -d wallet -c "UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL"
```

只想让某一个人下线，用上面的重置密码（它会吊销该用户全部刷新令牌）。

**重启与补丁。**

- VM 重启后，db / api / caddy 靠 restart policy 自动起来，不用操作（migrate 是一次性的，只在 `up` 时跑）。
- 安全补丁由 unattended-upgrades 自动装。内核更新要手动 `sudo reboot` 才生效；登录时提示 `System restart required` 就挑个空闲时间重启。

**看资源和磁盘。**

```bash
docker stats --no-stream
docker system df
docker image prune -f
```

`docker system df` 里 build cache 很大时，可以 `docker builder prune -f`。不要用 `docker system prune --volumes`，会连数据卷一起删。

## 7. 出问题看哪里

| 症状 | 排查 | 常见原因 |
| --- | --- | --- |
| 网页打不开 / 证书错误 | `getent hosts <域名>`；`docker compose -p wallet logs --tail=100 caddy`；| 域名没解析到 VM IP；Lightsail 的 IPv4 Firewall 没放行 80 / 443（第 1 步）；`CADDY_DOMAIN` 写错 |
| caddy 日志里有 ACME 错误 | 同上，在日志里找 `obtain`、`rateLimited` | 80 端口没通，Let's Encrypt 验证不了；签发次数超过 Let's Encrypt 限额。见下方「临时切测试证书」 |
| `/health` 通，但页面里 API 报错 | `docker compose -p wallet logs --tail=200 api` | 看日志里的异常；`.env` 的 `ALLOWED_ORIGINS` 与域名不一致；改了 `.env` 但没 `up -d api` |
| `up` 时 migrate 失败 | `docker compose -p wallet logs db`；`docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml run --rm migrate` | `DATABASE_URL` 的口令或库名与 `POSTGRES_*` 不一致；首次建库后又改了 `POSTGRES_PASSWORD`；db 没起来 |
| 登录总是 429（`login_rate_limited`） | `docker inspect --format '{{.Config.Cmd}}' $(docker compose -p wallet ps -q api)` | 命令里没有 `--proxy-headers`，所有人被算成 Caddy 的 IP；确认镜像是最新 build 的（重新 `deploy.sh`）。限流约一分钟后自动恢复 |
| 磁盘满 | `df -h /`；`docker system df` | 旧镜像和 build cache：`docker image prune -f`、`docker builder prune -f`；备份目录也看一下大小 |
| 忘了 `.env` 里的某个值 | `cat /opt/wallet_app/infra/.env` | 它就在 VM 上（权限 600），直接看。丢了 `SECRET_KEY` 只会让所有已签发的访问令牌失效（刷新令牌在库里，用户下次请求时会自动换新的） |
| 部署脚本退出码 2 | `ssh wallet-vm` | ssh 连不上（IP 变了就改 `~/.ssh/config`）；或 docker 没装好 / 没开新会话（第 4 步） |
| 部署脚本退出码 3 | `ls /opt/wallet_app/infra/.env` | VM 上还没有 `infra/.env`，按第 5 步 (b) 创建 |

**临时切测试证书。** 反复试域名时用，避免撞 Let's Encrypt 限额。在 VM 的 `infra/.env` 里加一行：

```text
CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

然后重建 caddy：

```bash
cd /opt/wallet_app
docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml up -d caddy
```

测试证书浏览器不信任，只用来确认流程通。确认后删掉这一行，再 `up -d caddy` 一次，回到正式证书。如果浏览器仍显示旧的不受信任证书，把 caddy 容器连同它的证书卷一起删掉再起（只删 caddy 的卷，数据卷不动）：

```bash
cd /opt/wallet_app
docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml rm -sf caddy
docker volume rm wallet_caddy_data
docker compose -p wallet --env-file infra/.env -f infra/docker-compose.prod.yml up -d caddy
```

**注意：** 任何时候 `down` 都**不要**加 `-v`。`-v` 会删掉所有卷：`pgdata`（全部账本数据）和 `caddy_data`（证书与 ACME 账号）都会丢。

## 8. 和旧方案的差别

2026-05 的旧规划（v2）比现在重得多。这次去掉了：自己花钱注册域名并托管 DNS、把 SSH 改成非标准端口、先发测试证书再换正式证书的两步流程、外部拨测监控服务、端口扫描验收、`verify-phase6.sh` 与 `runbook-evidence/`、Caddy 的 TLS 模式开关。

原因：这是一个家庭使用的小应用，省钱省事优先。DuckDNS 免费，Caddy 对真实域名默认就走 Let's Encrypt 正式环境，对 `localhost` 或 IP 自动用内部 CA，不需要任何开关。DuckDNS 在公共后缀列表里，Let's Encrypt 的限额按每个子域名单独计算，不会被别人用光。SSH 本来就只允许密钥登录，改端口收益很小。依赖版本改由 `backend/requirements.txt` 按实测版本钉死。
