/**
 * worker.js —— Cloudflare Worker 后端
 * --------------------------------------------------------------------------
 * 职责：
 *   1. 验证前端传来的 Auth0 Access Token（JWT）
 *   2. 验证通过后，提供受保护的 GET /api/protected/data 端点
 *
 * 验证方式：使用 jwks-rsa 从 Auth0 的 JWKS 端点拉取公钥，验证 JWT 签名。
 *   —— 这是生产环境推荐做法，比单纯调用 /userinfo 更安全（/userinfo 只能验活，不能防伪）。
 *
 * 依赖（通过 Worker 的 [vars] + 打包工具，或直接用 esm.sh 的 bundle）：
 *   本文件以 ES Module 编写，可直接通过 `wrangler deploy` 发布。
 * --------------------------------------------------------------------------
 */

// ===== 配置（建议放到 wrangler.toml 的 [vars] 或 Worker Secrets，避免硬编码）=====
// AUTH0_DOMAIN  : 你的 Auth0 租户域名，如 https://your-tenant.auth0.com
// AUTH0_AUDIENCE: 在 Auth0 后台「API」中创建的 Identifier，需与前端 audience 一致
export const AUTH0_DOMAIN = 'https://auth.your-domain.com';
export const AUTH0_AUDIENCE = 'https://your-worker.workers.dev';

// ===== JWT 工具：base64url 解码 =====
function b64urlDecode(str) {
  // 补全等号后转标准 base64
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jsonB64urlDecode(str) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(str)));
}

// ===== 从 Auth0 JWKS 端点获取签名公钥，并缓存 =====
// 使用 Web Crypto API (SubtleCrypto) 验证 RS256 签名
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_TTL = 60 * 60 * 1000; // 缓存 1 小时

async function getJWKS(domain) {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_TTL) return jwksCache;
  const res = await fetch(`${domain.replace(/\/$/, '')}/.well-known/jwks.json`);
  if (!res.ok) throw new Error('无法获取 JWKS');
  jwksCache = await res.json();
  jwksCacheTime = now;
  return jwksCache;
}

// 将 JWKS 的 RSA 公钥转为 CryptoKey
async function importRSAPublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg || 'RS256',
      use: jwk.use || 'sig',
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

// ===== 验证 JWT：返回 payload 或抛错 =====
async function verifyToken(token, domain, audience) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token 格式错误');

  const header = jsonB64urlDecode(parts[0]);
  const payload = jsonB64urlDecode(parts[1]);
  const signature = b64urlDecode(parts[2]);

  // 1. 基础声明校验
  if (payload.iss !== `${domain.replace(/\/$/, '')}/`) {
    throw new Error('issuer 不匹配');
  }
  if (payload.aud !== audience) {
    throw new Error('audience 不匹配');
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new Error('token 已过期');
  }

  // 2. 用 kid 查找对应公钥
  const jwks = await getJWKS(domain);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('未找到匹配的签名密钥');

  // 3. 验证 RS256 签名
  const key = await importRSAPublicKey(jwk);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!ok) throw new Error('签名验证失败');

  return payload; // { sub, name, email, scope, ... }
}

// ===== 从请求头提取 Bearer Token =====
function extractToken(req) {
  const auth = req.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ===== 统一 JSON 响应 =====
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ===== 主入口 =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 健康检查（无需认证）
    if (path === '/api/health') {
      return json({ status: 'ok', time: new Date().toISOString() });
    }

    // ===== 受保护端点 =====
    if (path === '/api/protected/data') {
      const token = extractToken(request);
      if (!token) return json({ error: '缺少 Authorization 头' }, 401);

      try {
        // 实际部署时从 env / [vars] 读取，避免硬编码
        const domain = env.AUTH0_DOMAIN || AUTH0_DOMAIN;
        const audience = env.AUTH0_AUDIENCE || AUTH0_AUDIENCE;
        const payload = await verifyToken(token, domain, audience);

        // 验证通过：返回业务数据 + 当前用户身份
        return json({
          message: '✅ 你已通过 Auth0 JWT 验证，成功访问受保护资源',
          user: { sub: payload.sub, name: payload.name, email: payload.email },
          data: {
            items: [
              { id: 1, title: '机密条目 A' },
              { id: 2, title: '机密条目 B' },
            ],
          },
          serverTime: new Date().toISOString(),
        });
      } catch (e) {
        return json({ error: 'Token 验证失败', detail: e.message }, 401);
      }
    }

    // 404
    return json({ error: 'Not Found', path }, 404);
  },
};
