// POST /api/leads — captura de lead (Cloudflare Pages Function)
import { json, clean, readJSON, leadKey, rateLimited } from '../../lib/cf.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost({ request, env }) {
  if (!env.LEADS) return json({ ok: false, error: 'Armazenamento não configurado (KV LEADS).' }, 500);

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && (await rateLimited(env, `lead:${ip}`, 8, 600))) {
    return json({ ok: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' }, 429);
  }

  let body;
  try { body = await readJSON(request); } catch (_) { return json({ ok: false, error: 'Requisição inválida.' }, 400); }
  if (body.website) return json({ ok: true }); // honeypot

  const nome = clean(body.nome, 120);
  const telefone = clean(body.telefone, 30).replace(/[^\d+()\s-]/g, '');
  const digits = telefone.replace(/\D/g, '');
  const email = clean(body.email, 160).toLowerCase();

  const errors = [];
  if (nome.length < 2) errors.push('Informe seu nome.');
  if (digits.length < 10 || digits.length > 13) errors.push('Informe um telefone com DDD.');
  if (!EMAIL_RE.test(email)) errors.push('Informe um e-mail válido.');
  if (body.consentimento !== true) errors.push('É preciso autorizar o contato.');
  if (errors.length) return json({ ok: false, error: errors.join(' ') }, 422);

  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const now = new Date().toISOString();
  const lead = {
    id: crypto.randomUUID(),
    criadoEm: now,
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
    status: 'primeiro_contato',
    notas: '',
    ip,
    cidade: clean(request.cf && request.cf.city, 80),
    atualizadoEm: now,
  };

  await env.LEADS.put(leadKey(lead), JSON.stringify(lead));
  return json({ ok: true, id: lead.id }, 201);
}

export function onRequest() {
  return json({ ok: false, error: 'Método não permitido.' }, 405);
}
