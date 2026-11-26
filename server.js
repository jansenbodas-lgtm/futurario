/**
 * Futura Rio — Landing page + mini CRM de leads
 * Servidor Node.js sem dependências externas (Node 18+).
 *
 *   npm start                      -> http://localhost:3000
 *   Painel:                        -> http://localhost:3000/admin
 *
 * Variáveis de ambiente (veja .env.example):
 *   PORT, ADMIN_PASSWORD, SESSION_SECRET, DATA_DIR, COOKIE_SECURE
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DIR = path.join(PUBLIC_DIR, 'admin');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

const STATUSES = ['novo', 'em_contato', 'cotacao_enviada', 'negociando', 'fechado', 'perdido'];

if (!ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD não definido: o painel /admin ficará bloqueado até você definir uma senha no .env');
}
if (!process.env.SESSION_SECRET) {
  console.warn('[aviso] SESSION_SECRET não definido: sessões do painel expiram a cada reinício do servidor');
}

/* ------------------------------------------------------------------ */
/* Armazenamento (arquivo JSON com escrita atômica e fila serializada) */
/* ------------------------------------------------------------------ */
fs.mkdirSync(DATA_DIR, { recursive: true });
let leads = [];
try {
  leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  if (!Array.isArray(leads)) leads = [];
} catch (_) {
  leads = [];
}

let writeChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(leads, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = LEADS_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot, 'utf8');
    await fsp.rename(tmp, LEADS_FILE);
  }).catch((err) => console.error('[erro] ao salvar leads:', err));
  return writeChain;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
function loadDotEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || line.trim().startsWith('#')) continue;
      const val = m[2].replace(/^['"]|['"]$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch (_) { /* sem .env, tudo bem */ }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function sendJSON(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function readBody(req, limit = 20 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new Error('bad_content_type');
  const raw = await readBody(req);
  return JSON.parse(raw || '{}');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function clean(v, max = 200) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* Rate limit simples em memória */
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count += 1;
  buckets.set(key, b);
  return b.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref();

/* ------------------------------------------------------------------ */
/* Sessão do painel (token assinado com HMAC)                          */
/* ------------------------------------------------------------------ */
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function isAuthed(req) {
  const token = parseCookies(req).fr_admin;
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch (_) { return false; }
}
function sessionCookie(value, maxAgeSec) {
  return `fr_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${COOKIE_SECURE ? '; Secure' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Arquivos estáticos                                                  */
/* ------------------------------------------------------------------ */
async function serveFile(res, root, relPath, cache = true) {
  const filePath = path.normalize(path.join(root, relPath));
  if (!filePath.startsWith(root)) return send(res, 403, 'Proibido');
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return serveFile(res, root, path.join(relPath, 'index.html'), cache);
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': !cache || isHtml ? 'no-cache' : 'public, max-age=604800',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    send(res, 404, 'Página não encontrada', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

/* ------------------------------------------------------------------ */
/* API pública: captura de lead                                        */
/* ------------------------------------------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function handleCreateLead(req, res) {
  const ip = clientIp(req);
  if (rateLimited(`lead:${ip}`, 8, 10 * 60_000)) {
    return sendJSON(res, 429, { ok: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
  }
  let body;
  try { body = await readJSON(req); } catch (_) {
    return sendJSON(res, 400, { ok: false, error: 'Requisição inválida.' });
  }

  // Honeypot anti-robô: campo invisível que humanos não preenchem
  if (body.website) return sendJSON(res, 200, { ok: true });

  const nome = clean(body.nome, 120);
  const telefone = clean(body.telefone, 30).replace(/[^\d+()\s-]/g, '');
  const digits = telefone.replace(/\D/g, '');
  const email = clean(body.email, 160).toLowerCase();

  const errors = [];
  if (nome.length < 2) errors.push('Informe seu nome.');
  if (digits.length < 10 || digits.length > 13) errors.push('Informe um telefone com DDD.');
  if (!EMAIL_RE.test(email)) errors.push('Informe um e-mail válido.');
  if (body.consentimento !== true) errors.push('É preciso autorizar o contato.');
  if (errors.length) return sendJSON(res, 422, { ok: false, error: errors.join(' ') });

  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const lead = {
    id: crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
    nome,
    telefone,
    email,
    tipoPlano: clean(body.tipoPlano, 60),
    vidas: clean(body.vidas, 20),
    origem: clean(body.origem, 40) || 'site',
    utm_source: clean(utm.utm_source, 100),
    utm_medium: clean(utm.utm_medium, 100),
    utm_campaign: clean(utm.utm_campaign, 150),
    utm_term: clean(utm.utm_term, 150),
    utm_content: clean(utm.utm_content, 150),
    gclid: clean(utm.gclid, 200),
    fbclid: clean(utm.fbclid, 200),
    pagina: clean(body.pagina, 300),
    referrer: clean(body.referrer, 300),
    status: 'novo',
    notas: '',
    ip,
    atualizadoEm: new Date().toISOString(),
  };
  leads.unshift(lead);
  await persist();
  console.log(`[lead] ${lead.criadoEm} ${lead.nome} ${lead.telefone} (${lead.origem})`);
  return sendJSON(res, 201, { ok: true, id: lead.id });
}

/* ------------------------------------------------------------------ */
/* API do painel                                                       */
/* ------------------------------------------------------------------ */
function toCSV(rows) {
  const cols = ['criadoEm', 'nome', 'telefone', 'email', 'tipoPlano', 'vidas', 'status', 'notas', 'origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'pagina', 'referrer'];
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula no Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}

async function handleAdminApi(req, res, url) {
  const route = url.pathname.replace(/^\/admin\/api/, '');

  if (route === '/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimited(`login:${ip}`, 10, 15 * 60_000)) {
      return sendJSON(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
    }
    if (!ADMIN_PASSWORD) return sendJSON(res, 503, { ok: false, error: 'Defina ADMIN_PASSWORD no servidor.' });
    let body;
    try { body = await readJSON(req); } catch (_) { return sendJSON(res, 400, { ok: false }); }
    if (!safeEqual(body.senha || '', ADMIN_PASSWORD)) {
      return sendJSON(res, 401, { ok: false, error: 'Senha incorreta.' });
    }
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createSession(), SESSION_TTL_MS / 1000) });
  }

  if (route === '/logout' && req.method === 'POST') {
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (!isAuthed(req)) return sendJSON(res, 401, { ok: false, error: 'Não autenticado.' });

  if (route === '/leads' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, leads, statuses: STATUSES });
  }

  if (route === '/leads.csv' && req.method === 'GET') {
    const stamp = new Date().toISOString().slice(0, 10);
    return send(res, 200, toCSV(leads), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-futura-rio-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  const m = route.match(/^\/leads\/([0-9a-f-]{36})$/);
  if (m) {
    const lead = leads.find((l) => l.id === m[1]);
    if (!lead) return sendJSON(res, 404, { ok: false, error: 'Lead não encontrado.' });

    if (req.method === 'PATCH') {
      let body;
      try { body = await readJSON(req); } catch (_) { return sendJSON(res, 400, { ok: false }); }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return sendJSON(res, 422, { ok: false, error: 'Status inválido.' });
        lead.status = body.status;
      }
      if (body.notas !== undefined) lead.notas = clean(body.notas, 2000);
      lead.atualizadoEm = new Date().toISOString();
      await persist();
      return sendJSON(res, 200, { ok: true, lead });
    }

    if (req.method === 'DELETE') {
      leads = leads.filter((l) => l.id !== lead.id);
      await persist();
      return sendJSON(res, 200, { ok: true });
    }
  }

  return sendJSON(res, 404, { ok: false, error: 'Rota não encontrada.' });
}

/* ------------------------------------------------------------------ */
/* Roteador                                                            */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/leads' && req.method === 'POST') return await handleCreateLead(req, res);
    if (p.startsWith('/admin/api/')) return await handleAdminApi(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');

    if (p === '/admin') return send(res, 301, '', { Location: '/admin/' });
    if (p.startsWith('/admin/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return await serveFile(res, ADMIN_DIR, p.slice('/admin/'.length) || 'index.html', false);
    }
    if (p === '/healthz') return sendJSON(res, 200, { ok: true });

    return await serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p);
  } catch (err) {
    console.error('[erro]', err);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, error: 'Erro interno.' });
  }
});

server.listen(PORT, () => {
  console.log(`Futura Rio rodando em http://localhost:${PORT}  (painel: /admin)`);
});
