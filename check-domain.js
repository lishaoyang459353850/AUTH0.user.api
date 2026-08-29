// 域名配置核验脚本
// 用法：node check-domain.js [域名]   （默认 githubpages.de5.net）
// 仅依赖 Node 内置模块，无需 npm install

const dns = require('dns').promises;
const { execSync } = require('child_process');

const domain = process.argv[2] || 'githubpages.de5.net';
const parts = domain.split('.');
// 二级域名形如 githubpages.de5.net -> root = de5.net, label = githubpages
const root = parts.length >= 2 ? parts.slice(-2).join('.') : domain;
const label = parts.length >= 3 ? parts.slice(0, -2).join('.') : '@';

const log = {
  ok: (m) => console.log('  \x1b[32m✓\x1b[0m ' + m),
  warn: (m) => console.log('  \x1b[33m!\x1b[0m ' + m),
  err: (m) => console.log('  \x1b[31m✗\x1b[0m ' + m),
  info: (m) => console.log('  \x1b[36m·\x1b[0m ' + m),
  h: (m) => console.log('\n\x1b[1m' + m + '\x1b[0m'),
};

// 通过 doh 查询，避开本地 DNS 缓存差异
async function doh(query, type) {
  try {
    const url = `https://dns.alidns.com/resolve?name=${encodeURIComponent(query)}&type=${type}`;
    const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
    const j = await res.json();
    return (j.Answer || []).map((a) => a.data);
  } catch {
    return [];
  }
}

async function digExists(query, type) {
  const r = await doh(query, type);
  return { records: r, has: r.length > 0 };
}

async function main() {
  console.log(`\x1b[1m核验域名：\x1b[36m${domain}\x1b[0m`);
  console.log(`根域（注册域）：${root}    子域标签：${label}\n`);

  // 1. 根域 NS
  log.h('1. 根域 NS 委托（决定 DNS 由谁管）');
  const ns = await doh(root, 'NS');
  if (ns.length) {
    ns.forEach((n) => log.info(n));
    const cf = ns.some((n) => /cloudflare\.com$/i.test(n));
    if (cf) log.ok('根域 NS 已委托给 Cloudflare，可在 CF 面板直接加记录');
    else log.warn('根域 NS 未指向 Cloudflare，需在注册商 DNSHE 面板配置记录');
  } else {
    log.err('未查到 NS 记录（域名可能未注册或 DNS 未生效）');
  }

  // 2. 当前子域解析
  log.h('2. 目标子域当前解析状态');
  const aRes = await digExists(domain, 'A');
  const cnameRes = await digExists(domain, 'CNAME');
  if (cnameRes.has) log.info(`CNAME → ${cnameRes.records.join(', ')}`);
  if (aRes.has) aRes.records.forEach((r) => log.info(`A ${r}`));
  if (!cnameRes.has && !aRes.has) log.warn('当前没有任何 A / CNAME 记录（尚未配置）');

  // 3. 是否已套 Cloudflare（IP 归属）
  log.h('3. Cloudflare 代理检测');
  const cfRanges = [
    ['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22],
    ['103.31.4.0', 22], ['141.101.64.0', 18], ['108.162.192.0', 18],
    ['190.93.240.0', 20], ['188.114.96.0', 20], ['197.234.240.0', 22],
    ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
    ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22],
  ];
  const inCf = (ip) => {
    const n = ip.split('.').reduce((a, b) => (a << 8) + +b, 0) >>> 0;
    return cfRanges.some(([start, mask]) => {
      const [a, b, c, d] = start.split('.').map(Number);
      const s = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
      const m = (0xffffffff << (32 - mask)) >>> 0;
      return (n & m) === (s & m);
    });
  };
  let onCf = false;
  for (const ip of aRes.records) {
    if (inCf(ip)) { onCf = true; log.ok(`A ${ip} 属于 Cloudflare 网段（橙色云：代理已开启）`); }
    else log.info(`A ${ip} 非 Cloudflare IP`);
  }
  if (aRes.has && !onCf) log.warn('A 记录存在但不在 CF 网段 → 灰色云（DNS Only），符合 GitHub Pages 要求');

  // 4. GitHub Pages 默认域推断与可达性
  log.h('4. GitHub Pages 默认域与可达性');
  const githubIo = `${label === '@' ? root : label + '.' + root}`.replace(/^/, '');
  // Pages 默认域格式为 <user>.github.io，此处只能提示，无法反查
  log.info('CNAME 应指向：<你的GitHub用户名>.github.io （不含仓库名）');
  log.info('示例：CNAME  githubpages.de5.net → yourname.github.io');

  // 5. 决策树
  log.h('5. 推荐配置（基于本次检测结果）');
  if (cnameRes.has) {
    log.ok('已存在 CNAME —— 若指向 *.github.io，子域配置正确');
    log.warn('注意：Cloudflare 上此 CNAME 必须设为 DNS Only（灰色云），不可开代理');
  } else if (aRes.has && onCf) {
    log.err('当前为 CF 橙色云 + A 记录：GitHub Pages 无法识别，需改为 CNAME 或 DNS Only');
  } else if (aRes.has) {
    log.warn('当前为 A 记录（DNS Only）—— 可行但不推荐，建议改用 CNAME 指向 *.github.io');
  } else {
    console.log(`
    方案一（推荐 · DNSHE 原生解析，不接 Cloudflare）：
      CNAME  ${label}  →  <user>.github.io     TTL 600

    方案二（Cloudflare 托管）：
      a) DNSHE 面板把 ${root} 的 NS 改为 CF 分配的两个 nsX.cloudflare.com
      b) CF → DNS 记录：CNAME  ${label}  →  <user>.github.io  （灰色云 / DNS Only）
    `);
  }

  // 6. 后续步骤
  log.h('6. 完成清单');
  [
    `GitHub 仓库 Settings → Pages → Custom domain 填写 ${domain} 并保存`,
    '等待 GitHub 显示 "DNS check successful"（最长 24h）',
    '勾选 Enforce HTTPS，等待 TLS 证书签发',
    'Auth0 Allowed Callback URLs / Logout URLs / Web Origins 加入 https://' + domain,
    '本地验证：dig ' + domain + ' CNAME；curl -I https://' + domain,
  ].forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
