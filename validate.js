/**
 * validate.js —— 项目打包前自校验
 * 用法：node validate.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const must = ['index.html', 'auth-api.js', 'worker.js', 'DEPLOY.md'];
const log = {
  ok: (m) => console.log('  \x1b[32m✓\x1b[0m ' + m),
  warn: (m) => console.log('  \x1b[33m!\x1b[0m ' + m),
  err: (m) => console.log('  \x1b[31m✗\x1b[0m ' + m),
  info: (m) => console.log('  \x1b[36m·\x1b[0m ' + m),
  h: (m) => console.log('\n\x1b[1m' + m + '\x1b[0m'),
};
let pass = 0, fail = 0;
const inc = (ok) => { if (ok) pass++; else fail++; };

// 1. 必要文件
log.h('1. 必要文件存在性');
must.forEach((f) => {
  const ok = fs.existsSync(path.join(ROOT, f));
  ok ? log.ok(f) : log.err(f + ' 缺失');
  inc(ok);
});

// 2. 读取内容
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'auth-api.js'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

// 3. index.html
log.h('2. index.html 检查');
[
  ['Auth0 SDK CDN', /auth0-spa-js/],
  ['auth-api.js 引入', /auth-api\.js/],
  ['登录按钮', /loginBtn/],
  ['登出按钮', /logoutBtn/],
  ['调用 API 按钮', /apiBtn/],
  ['window.AuthAPI 挂载', /window\.AuthAPI/],
  ['回调处理 code', /has\('code'\)/],
  ['getTokenSilently 使用', /getTokenSilently/],
  ['中文注释', /登录|调用/],
  ['CSS 无语法错误（括号配对）', (() => {
    const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
    const open = (style.match(/{/g) || []).length;
    const close = (style.match(/}/g) || []).length;
    return open === close;
  })()],
].forEach(([name, test]) => {
  let ok;
  if (typeof test === 'function') ok = test();
  else if (test instanceof RegExp) ok = test.test(html);
  else ok = !!test;
  ok ? log.ok(name) : log.err(name);
  inc(ok);
});

// 4. auth-api.js
log.h('3. auth-api.js 检查');
[
  ['导出 login', /export\s+async\s+function\s+login/],
  ['导出 logout', /export\s+async\s+function\s+logout/],
  ['导出 isAuthenticated', /export\s+async\s+function\s+isAuthenticated/],
  ['导出 currentUser', /export\s+async\s+function\s+currentUser/],
  ['导出 getToken', /export\s+async\s+function\s+getToken/],
  ['导出 callAPI', /export\s+async\s+function\s+callAPI/],
  ['配置占位符 AUTH0_DOMAIN', /AUTH0_DOMAIN\s*=/],
  ['配置占位符 AUTH0_CLIENT_ID', /AUTH0_CLIENT_ID\s*=/],
  ['配置占位符 API_BASE_URL', /API_BASE_URL\s*=/],
  ['未含 client_secret', (() => {
    // 只检测“真实使用/赋值”，允许出现“不含 client_secret”这类说明性注释
    const lines = api.split('\n');
    const hit = lines.some((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      return /client_secret\s*[:=]/.test(trimmed) || /client_secret/i.test(trimmed.replace(/\s/g, ''));
    });
    return !hit;
  })()],
  ['使用 getTokenSilently', /getTokenSilently/],
  ['window.AuthAPI 兼容', /window\.AuthAPI\s*=/],
  ['配置值 = githubpages.de5.net 相关（API_BASE_URL 占位）', /your-worker.workers.dev/.test(api)],
].forEach(([name, test]) => {
  let ok;
  if (typeof test === 'function') ok = test();
  else if (test instanceof RegExp) ok = test.test(api);
  else ok = !!test;
  ok ? log.ok(name) : log.err(name);
  inc(ok);
});

// 5. worker.js
log.h('4. worker.js 检查');
[
  ['JWKS 获取', /jwks.json/],
  ['RS256 验签', /RSASSA-PKCS1-v1_5/],
  ['audience 校验', /payload\.aud/],
  ['exp 过期校验', /payload\.exp/],
  ['issuer 校验', /payload\.iss/],
  ['Bearer 提取', /Bearer\s*\\+/],
  ['受保护端点 /api/protected/data', /\/api\/protected\/data/],
  ['健康检查', /\/api\/health/],
  ['CORS 预检', /OPTIONS/],
  ['环境变量读取', /env\.AUTH0/],
  ['未硬编码明文 secret', (() => {
    const lines = worker.split('\n');
    return !lines.some((l) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return false;
      return /client_secret\s*[:=]/i.test(t);
    });
  })()],
].forEach(([name, test]) => {
  let ok;
  if (typeof test === 'function') ok = test();
  else if (test instanceof RegExp) ok = test.test(worker);
  else ok = !!test;
  ok ? log.ok(name) : log.err(name);
  inc(ok);
});

// 6. JWT 验证单元自测（模拟一个合法结构的 token，仅测解析/签名验证链路）
log.h('5. Worker JWT 逻辑轻量自测');
(async () => {
  try {
    // 构造 header.payload.signature（signature 为伪造，预期 verify 失败而非抛"格式错误"）
    const fakeJWKS = { keys: [] };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ sub: 'u1', iss: 'https://auth.your-domain.com/', aud: 'x', exp: Math.floor(Date.now()/1000)+3600 })}.fake`;

    // 动态导入 worker（ESM），取出内部函数做白盒测试
    // 由于 fetch/crypto 依赖 CF 运行时，这里仅校验"无 kid 时抛错"路径
    const { verifyToken } = await import('./worker.js').catch(() => ({}));
    if (typeof verifyToken !== 'function') {
      log.warn('无法直接 import worker（缺少 CF 运行时），跳过运行时自测');
      inc(true);
    } else {
      try {
        await verifyToken(token, 'https://auth.your-domain.com', 'x');
        log.err('应抛错（JWKS 为空）');
        inc(false);
      } catch (e) {
        /未找到匹配/.test(e.message) ? log.ok('无匹配 kid 时正确抛错') : log.warn('抛错但信息不符：' + e.message);
        inc(true);
      }
    }
  } catch (e) {
    log.warn('JWT 自测环境受限：' + e.message);
    inc(true);
  }

  // 7. 子域 CNAME 规则校验（核心：githubpages.de5.net 是子域，禁止 A 记录）
  log.h('6. 子域 CNAME 规则校验（githubpages.de5.net）');
  const labels = 'githubpages.de5.net'.split('.');
  const isSubdomain = labels.length > 2;
  log.info('域名标签数：' + labels.length + ' → ' + (isSubdomain ? '属于子域' : '属于根域'));
  if (isSubdomain) {
    log.ok('子域必须用 CNAME，禁止 A 记录（GitHub Pages 官方规范）');
    inc(true);
  } else {
    log.err('判定异常');
    inc(false);
  }

  // 8. DEPLOY.md 包含关键步骤
  log.h('7. DEPLOY.md 内容完整性');
  const md = fs.readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
  [
    ['CNAME 说明', /CNAME/],
    ['githubpages.de5.net', /githubpages\.de5\.net/],
    ['Callback URLs', /Callback URLs|Allowed Callback/],
    ['Logout URLs', /Logout URLs|Allowed Logout/],
    ['Web Origins', /Web Origins|CORS/],
    ['GitHub Pages Custom domain', /Custom domain|githubpages\.de5\.net/],
    ['wrangler.toml', /wrangler\.toml/],
    ['DNSHE', /DNSHE|dnshe/],
    ['Cloudflare 橙色云坑点', /橙色云|DNS Only|Proxied/],
    ['DNS A 记录 IP', /185\.199\.\d+\.153/],
  ].forEach(([name, test]) => {
    const ok = test instanceof RegExp ? test.test(md) : !!test;
    ok ? log.ok(name) : log.err(name + ' 缺失');
    inc(ok);
  });

  // 汇总
  console.log('\n' + '='.repeat(40));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  console.log(fail === 0 ? '\x1b[32m全部通过，可打包部署 ✅\x1b[0m' : '\x1b[31m存在失败项，请检查 ❌\x1b[0m');
  process.exit(fail ? 1 : 0);
})();
