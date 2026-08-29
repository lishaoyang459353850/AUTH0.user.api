# 部署指南（DEPLOY.md）

账户系统 Auth0 + GitHub Pages + Cloudflare Workers 全流程部署文档
**—— 针对 `githubpages.de5.net` 子域名优化版**

---

## 🎯 域名情况说明

本项目前端托管域名：**`githubpages.de5.net`**

- **`de5.net`** 是在 **DNSHE（dnshe.com）** 注册的根域名
- **`githubpages`** 是二级子域（label）
- 这种 **子域 + GitHub Pages** 的组合，**DNS 记录类型必须是 `CNAME`，不是 A 记录**

> ⚠️ 若教程让你给子域名配 A 记录 → **那是错的**。A 记录只用于根域名（apex，如 `example.com`）。

---

## 📐 整体架构

```
浏览器 ──https://githubpages.de5.net──▶ GitHub Pages (静态前端)
                                         │  index.html / auth-api.js
                                         │
                                         └─调用 /api/protected/data──▶ Cloudflare Worker
                                                                        │ 验证 JWT
                                                                        └─▶ 返回数据
```

---

## 🚀 一、DNSHE 域名注册（若已有可跳过）

1. 打开 https://my.dnshe.com 注册账号（支持 GitHub/Google/QQ/163 登录）
2. 左侧菜单 → **Free Domains** → 选择后缀 **`.de5.net`**
3. 前缀填 **`githubpages`** → 完整域名即 **`githubpages.de5.net`**
4. 记录管理后台的 **Name servers（NS）** 入口，后续可能改为 Cloudflare

> 💡 `.de5.net` 是唯一支持 Cloudflare NS 直接替换的后缀，其他后缀可能不行。

---

## 🌐 二、DNS 解析配置（核心！CNAME）

### 关键判断

| 场景 | 记录类型 | 值 |
|------|---------|-----|
| 根域名 `de5.net` | A × 4 | GitHub Pages 四个 IP |
| **子域名 `githubpages.de5.net` ✅ 本项目** | **CNAME** | `<user>.github.io` |

> 📌 GitHub Pages 官方 A 记录 IP（仅根域用，本项目**不需要**配这些）：
> `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153`
> 以及 AAAA（IPv6）：`2606:50c0:8000::153` ~ `...:8003::153`

### 方案一：DNSHE 原生解析（推荐，最简单）

在 DNSHE 域名管理页 → **Add DNS record**：

```
Type   : CNAME
Name   : githubpages
Content: <你的GitHub用户名>.github.io
TTL    : 600 (10 分钟)
```

保存即可。**不要加 Cloudflare 橙色云代理**（见下方"坑点"）。

### 方案二：托管到 Cloudflare（想要 CDN/HTTPS 增强）

1. Cloudflare → 添加站点 → 输入完整域名 `githubpages.de5.net`
2. 选 Free 套餐 → 记录**手动输入**那条 CNAME
3. CF 分配两个 NS（如 `xxx.ns.cloudflare.com`）→ 回到 DNSHE → **Name servers** 替换
4. 等 5~30 分钟，CF 显示 **Active**
5. 在 CF → DNS 记录 中确认 CNAME 存在，且 **代理状态 = DNS Only（灰色云）**

### ⚠️ 坑点：Cloudflare 橙色云（Proxy）与 GitHub Pages 冲突

| 状态 | 图标 | 是否可用 |
|------|------|---------|
| DNS Only | ⛅ 灰色 | ✅ 可用 |
| Proxied | ☁️ 橙色 | ❌ GitHub Pages 报 404 / 证书错 |

**若开橙色云，Cloudflare IP 会掩盖真实解析，GitHub Pages 无法验证域名所有权。**
→ 必须点成灰色云（DNS Only），或者改用 Cloudflare Pages 托管前端。

### 验证 DNS

```bash
# 应看到类似：
# githubpages.de5.net  CNAME  yourname.github.io
# yourname.github.io    A     185.199.x.x
dig githubpages.de5.net CNAME
```

---

## 🔐 三、Auth0 配置

### 1. 创建 Application（SPA 类型）

Auth0 后台 → Applications → Create → 选 **Single Page Application**

| 字段 | 值 |
|------|-----|
| Name | 账户系统前端 |
| Application Type | Single Page Application |

### 2. 三个 URL（按 `https://githubpages.de5.net` 填写）

| 配置项 | 值 |
|--------|-----|
| **Allowed Callback URLs** | `https://githubpages.de5.net/` 及 `https://githubpages.de5.net/?error=...` |
| **Allowed Logout URLs** | `https://githubpages.de5.net/` |
| **Allowed Web Origins (CORS)** | `https://githubpages.de5.net` |

> 📌 多个值用逗号分隔；本地调试可追加 `http://localhost:3000`。

### 3. 创建 API（供后端验证 JWT）

Auth0 → APIs → Create → 填入：

- **Identifier（audience）**：`https://your-worker.workers.dev`（与 Worker 部署地址一致）
- **Signing Algorithm**：RS256

记下 `domain`（如 `auth.your-domain.com`）和 Client ID，填入 `auth-api.js` 顶部。

---

## 📄 四、GitHub Pages 部署

1. 新建仓库（用户站点用 `<user>.github.io`，项目站点任意名）
2. 把本项目 4 个文件推送到 `main` 分支根目录：
   ```
   index.html
   auth-api.js
   worker.js        （可不放，Worker 独立部署）
   DEPLOY.md
   ```
3. 仓库 Settings → Pages：
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)`
4. **Custom domain** 输入框填：`githubpages.de5.net` → 点 Save
   - GitHub 会自动在根目录创建 `CNAME` 文件（内容为 `githubpages.de5.net`）
5. 等待 **"DNS check successful"**（可能几分钟到 24 小时）
6. 勾选 ✅ **Enforce HTTPS** → 等待 Let's Encrypt 证书签发

> 🔎 若 DNS check 一直不通过：检查 CNAME 是否生效、Cloudflare 是否灰色云、域名是否含 `_` 等非法字符。

---

## ⚙️ 五、Cloudflare Worker 部署

### 方式 A：Wrangler CLI（推荐）

```bash
npm i -g wrangler
wrangler login
wrangler init --from-dashboard   # 或手动建 wrangler.toml
```

`wrangler.toml`：

```toml
name = "auth-api-worker"
main = "worker.js"
compatibility_date = "2026-08-01"

[vars]
AUTH0_DOMAIN   = "https://auth.your-domain.com"
AUTH0_AUDIENCE = "https://your-worker.workers.dev"
```

> 敏感值建议用 Secret：`wrangler secret put AUTH0_DOMAIN`

部署：

```bash
wrangler deploy
# 输出：https://auth-api-worker.<subdomain>.workers.dev
```

把该地址填入 `auth-api.js` 的 `API_BASE_URL`。

### 方式 B：Dashboard 粘贴

Cloudflare → Workers & Pages → Create → 粘贴 `worker.js` 内容 → 保存并部署 → 绑定自定义域名（可选）。

### JWT 验证说明

`worker.js` 使用 **JWKS + Web Crypto** 验证 RS256 签名：
- 从 `https://<AUTH0_DOMAIN>/.well-known/jwks.json` 拉公钥（缓存 1 小时）
- 校验 `iss`、`aud`、`exp`，再用 SubtleCrypto 验签
- **比单纯调 `/userinfo` 更安全**：`/userinfo` 只能验活、不能防伪

---

## ✅ 六、部署后验证清单

```bash
# 1. DNS CNAME 生效
dig githubpages.de5.net CNAME

# 2. HTTPS 可访问
curl -I https://githubpages.de5.net

# 3. Worker 健康检查（无需登录）
curl https://your-worker.workers.dev/api/health

# 4. 受保护端点（无 token 应返回 401）
curl https://your-worker.workers.dev/api/protected/data
```

浏览器打开 `https://githubpages.de5.net`：
- 点 **登录** → 跳转 Auth0 → 回调回来显示头像/昵称/邮箱
- 点 **调用受保护 API** → 应显示后端返回的 JSON

---

## 🐛 七、常见问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| GitHub Pages 404 / 证书失败 | Cloudflare 橙色云 | 改为 DNS Only（灰色云） |
| Auth0 回调后白屏 | Callback URL 未配置 | 在 Auth0 补 `https://githubpages.de5.net/` |
| `issuer 不匹配` | Worker AUTH0_DOMAIN 末尾多/少 `/` | 确保以 `https://` 开头、无末尾 `/` |
| `audience 不匹配` | 前端 audience ≠ Worker audience | 两者都设为 Worker 地址 |
| CORS 报错 | 前端跨域调 Worker | Worker 已加 `Access-Control-Allow-Origin: *` |
| Token 过期 | refresh token 未启用 | `useRefreshTokens: true`（已配置） |

---

## 🔒 安全红线（务必遵守）

- ✅ 前端**只**有 `domain` + `clientId`
- ❌ **绝不**在前端写 `client_secret`
- ✅ Access Token 由 SDK `getTokenSilently()` 托管，不手动存 `localStorage`
- ✅ Worker 的 `AUTH0_DOMAIN` 用 `[vars]` 或 Secret 注入，不硬编码明文进公开仓库
- ✅ 定期轮换 Auth0 API Secret 与 Worker Secret
