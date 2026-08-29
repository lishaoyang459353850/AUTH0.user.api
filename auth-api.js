/**
 * auth-api.js
 * ----------------------------------------------------------------------------
 * 独立的 ES Module，封装 Auth0 SPA SDK。
 * 对外导出：login / logout / isAuthenticated / currentUser / getToken / callAPI
 * 同时通过 IIFE 把相同方法挂到 window.AuthAPI，方便非模块化场景直接调用。
 *
 * ⚠️ 安全约束：本文件不含 client_secret，仅配置 domain + clientId。
 *   Access Token 由 SDK 内部通过 getTokenSilently 管理，不手动存储到 localStorage。
 * ----------------------------------------------------------------------------
 */

// ===== 配置占位符（按需替换） =====
const AUTH0_DOMAIN = 'auth.your-domain.com';        // 或 your-tenant.auth0.com
const AUTH0_CLIENT_ID = '你的Auth0 Client ID';
const API_BASE_URL = 'https://your-worker.workers.dev'; // Cloudflare Worker 地址

// Auth0 SPA SDK 通过 CDN 以全局变量 window.auth0.Auth0Client 暴露
const { Auth0Client } = window.auth0;

// ===== 创建 Auth0 客户端（单例）=====
//  redirectUri：Auth0 回调回来后落在的页面，需与 Auth0 后台 Allowed Callback URLs 一致
//  audience / scope：请求后端 API 时需要的权限范围
const auth0 = new Auth0Client({
  domain: AUTH0_DOMAIN,
  clientId: AUTH0_CLIENT_ID,
  authorizationParams: {
    redirect_uri: window.location.origin + window.location.pathname,
    audience: API_BASE_URL,           // 对应 Auth0 API 的 Identifier
    scope: 'openid profile email offline_access',
  },
  // 缓存策略：默认使用 in-memory + sessionStorage，刷新后仍能恢复登录态
  cacheLocation: 'sessionstorage',
  useRefreshTokens: true,             // 启用 refresh token，保障长期登录
});

// ===== 1. 登录 =====
// 跳转到 Auth0 授权页；登录后 Auth0 会重定向回 redirect_uri 并附带 code 参数
export async function login() {
  await auth0.loginWithRedirect();
}

// ===== 2. 登出 =====
// 清除本地 session，并跳转回首页；returnTo 需加入 Auth0 Allowed Logout URLs
export async function logout() {
  await auth0.logout({
    logoutParams: { returnTo: window.location.origin + window.location.pathname },
  });
}

// ===== 3. 是否已登录 =====
// 内部会用 handleRedirectCallback 处理 URL 中的 code（若当前正处于回调）
export async function isAuthenticated() {
  try {
    return await auth0.isAuthenticated();
  } catch {
    return false;
  }
}

// ===== 4. 当前用户信息 =====
// 返回 { name, email, picture, sub, ... }，未登录时返回 null
export async function currentUser() {
  if (!(await isAuthenticated())) return null;
  return await auth0.getUser();
}

// ===== 5. 获取 Access Token =====
// 核心方法：优先用 refresh token 静默获取，不暴露 token 给业务代码直接存管。
// 调用方只需 await getToken() 拿到字符串即可。
export async function getToken() {
  return await auth0.getTokenSilently({
    authorizationParams: { audience: API_BASE_URL, scope: 'openid profile email offline_access' },
  });
}

// ===== 6. 调用受保护的后端 API =====
// path 形如 '/api/protected/data'，自动拼接 API_BASE_URL，并注入 Bearer Token
export async function callAPI(path, options = {}) {
  const token = await getToken();       // 自动刷新，过期也无感知
  const res = await fetch(API_BASE_URL + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}：${text}`);
  }
  return res.json();
}

// ===== 非模块化兼容：挂载到 window =====
// 这样即便不用 <script type="module">，也能在全局调用 AuthAPI.login() 等
window.AuthAPI = {
  login,
  logout,
  isAuthenticated,
  currentUser,
  getToken,
  callAPI,
};

export default { login, logout, isAuthenticated, currentUser, getToken, callAPI };
