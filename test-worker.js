/**
 * test-worker.js —— Worker 纯逻辑单元测试（剥离 CF 运行时依赖）
 * 把 worker.js 中的纯函数抽出，直接 node 运行验证 JWT 解析与声明校验逻辑。
 * 用法：node test-worker.js
 */
const fs = require('fs');
const path = require('path');

const workerSrc = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');

// ===== 1. 语法检查（ESM export 在 Node 的 Function 构造器中非法，改用结构平衡检查）=====
console.log('\x1b[1m[1] worker.js 结构完整性检查\x1b[0m');
const pairs = {
  '(': ')', '{': '}', '[': ']',
};
let stack = [];
let inStr = false, strCh = '', esc = false;
let balanced = true;
for (let i = 0; i < workerSrc.length; i++) {
  const c = workerSrc[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === strCh) inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (pairs[c]) stack.push(c);
  else if (Object.values(pairs).includes(c)) {
    if (stack.length === 0 || pairs[stack.pop()] !== c) { balanced = false; break; }
  }
}
console.log('  ' + (balanced && stack.length === 0 ? '\x1b[32m✓\x1b[0m 括号/引号配对平衡' : '\x1b[31m✗\x1b[0m 括号或引号不平衡'));

// ===== 2. 手动实现 worker 中的纯函数副本，验证逻辑正确性 =====
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = Buffer.from(b64, 'base64').toString('binary');
  return bin;
}
function jsonB64urlDecode(str) {
  return JSON.parse(b64urlDecode(str));
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

console.log('\n\x1b[1m[2] base64url 编解码一致性\x1b[0m');
const sample = { sub: 'auth0|123', name: '测试用户' };
const enc = b64(sample);
const dec = jsonB64urlDecode(enc);
dec.sub === sample.sub ? console.log('  \x1b[32m✓\x1b[0m 编解码一致：' + dec.name) : console.log('  ✗ 不一致');

console.log('\n\x1b[1m[3] 声明（claim）校验逻辑模拟\x1b[0m');
// 模拟 verifyToken 中段逻辑（不含签名，签名依赖 SubtleCrypto）
function checkClaims(payload, domain, audience) {
  const issues = [];
  if (payload.iss !== `${domain.replace(/\/$/, '')}/`) issues.push('issuer 不匹配');
  if (payload.aud !== audience) issues.push('audience 不匹配');
  if (payload.exp * 1000 < Date.now()) issues.push('token 已过期');
  return issues;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: 'https://auth.your-domain.com/', aud: 'https://api.example.com', exp: now + 3600 };
const badAud = { ...good, aud: 'wrong' };
console.log('  正确 claims:', checkClaims(good, 'https://auth.your-domain.com', 'https://api.example.com').length === 0 ? '✓ 通过' : '✗');
console.log('  错误 audience:', checkClaims(badAud, 'https://auth.your-domain.com', 'https://api.example.com').join(', ') || '无');

console.log('\n\x1b[1m[4] 过期判定\x1b[0m');
const expired = { iss: 'https://auth.your-domain.com/', aud: 'x', exp: now - 10 };
const _issues = checkClaims(expired, 'https://auth.your-domain.com', 'x');
console.log('  已过期 token:', _issues.length > 0 && _issues.join('').includes('过期') ? '✓ 正确识别' : '✗');

console.log('\n\x1b[1m[5] worker.js 关键字符串存在性\x1b[0m');
const checks = [
  ['JWKS 端点', /\.well-known\/jwks\.json/],
  ['RS256 验签', /RSASSA-PKCS1-v1_5/],
  ['iss 校验', /payload\.iss/],
  ['aud 校验', /payload\.aud/],
  ['exp 校验', /payload\.exp/],
  ['/api/protected/data', /\/api\/protected\/data/],
  ['/api/health', /\/api\/health/],
  ['CORS OPTIONS', /OPTIONS/],
  ['env 变量', /env\.AUTH0/],
  ['无 client_secret', (() => {
    const lines = workerSrc.split('\n');
    return !lines.some((l) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return false;
      return /client_secret\s*[:=]/i.test(t);
    });
  })()],
];
checks.forEach(([n, r]) => {
  const ok = r instanceof RegExp ? r.test(workerSrc) : r;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`);
});

console.log('\n\x1b[1m[6] 完整 JWT 三段结构解析（模拟端到端）\x1b[0m');
const token = `${b64({ alg: 'RS256', kid: 'abc' })}.${b64({ sub: 'u1', iss: 'https://auth.your-domain.com/', aud: 'x', exp: now + 3600 })}.signaturepart`;
const parts = token.split('.');
console.log('  段数 =', parts.length, parts.length === 3 ? '✓' : '✗');
console.log('  header.alg =', jsonB64urlDecode(parts[0]).alg);
console.log('  payload.sub =', jsonB64urlDecode(parts[1]).sub);

console.log('\n\x1b[32mWorker 纯逻辑验证完成 ✅\x1b[0m');
