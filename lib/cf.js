/**
 * Utilidades compartilhadas pelas Cloudflare Pages Functions.
 * Requer no projeto Pages:
 *   - KV namespace vinculado com o nome LEADS
 *   - Variáveis: ADMIN_PASSWORD, SESSION_SECRET
 */
export const STATUSES = ['novo', 'em_contato', 'cotacao_enviada', 'negociando', 'fechado', 'perdido'];
export const SESSION_TTL_S = 60 * 60 * 12;
const enc = new TextEncoder();

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...headers,
    },
  });
}

export function clean(v, max = 200) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

export async function readJSON(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('bad_content_type');
  const raw = await request.text();
  if (raw.length > 20000) throw new Error('payload_too_large');
  return JSON.parse(raw || '{}');
}

function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function createSession(env) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_S * 1000 })));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

export async function isAuthed(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)fr_admin=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = decodeURIComponent(m[1]).split('.');
  if (!payload || !sig) return false;
  if (!(await safeEqual(sig, await hmac(env.SESSION_SECRET, payload)))) return false;
  try { return JSON.parse(b64urlDecode(payload)).exp > Date.now(); } catch (_) { return false; }
}

export function sessionCookie(value, maxAge) {
  return `fr_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/* ---------- Armazenamento no KV ----------
   Cada lead é uma chave "lead:<timestamp invertido>:<id>" para listar do mais novo ao mais antigo. */
const MAX_TS = 9999999999999;
export function leadKey(lead) {
  const inv = String(MAX_TS - new Date(lead.criadoEm).getTime()).padStart(13, '0');
  return `lead:${inv}:${lead.id}`;
}

export async function listLeads(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.LEADS.list({ prefix: 'lead:', cursor, limit: 1000 });
    const values = await Promise.all(page.keys.map((k) => env.LEADS.get(k.name, 'json')));
    values.forEach((v) => { if (v) out.push(v); });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function findLeadKey(env, id) {
  let cursor;
  do {
    const page = await env.LEADS.list({ prefix: 'lead:', cursor, limit: 1000 });
    const k = page.keys.find((x) => x.name.endsWith(':' + id));
    if (k) return k.name;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

export function toCSV(rows) {
  const cols = ['criadoEm', 'nome', 'telefone', 'email', 'tipoPlano', 'vidas', 'status', 'notas', 'origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'pagina', 'referrer'];
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}

/* Rate limit leve usando o KV (janela de 10 min por IP) */
export async function rateLimited(env, key, max, windowS) {
  const k = `rl:${key}`;
  const n = Number((await env.LEADS.get(k)) || 0) + 1;
  await env.LEADS.put(k, String(n), { expirationTtl: Math.max(60, windowS) });
  return n > max;
}
