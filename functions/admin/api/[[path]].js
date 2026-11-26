// /admin/api/* — API do CRM (Cloudflare Pages Function)
import {
  json, clean, readJSON, STATUSES, SESSION_TTL_S, safeEqual, createSession, isAuthed,
  sessionCookie, listLeads, findLeadKey, toCSV, rateLimited, adminPassword, normalizeStatus, leadKey,
} from '../../../lib/cf.js';

export async function onRequest({ request, env, params }) {
  if (!env.LEADS) return json({ ok: false, error: 'Armazenamento não configurado (KV LEADS).' }, 500);

  const route = '/' + (Array.isArray(params.path) ? params.path.join('/') : params.path || '');
  const method = request.method;

  if (route === '/login' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (ip && (await rateLimited(env, `login:${ip}`, 10, 900))) {
      return json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
    }
    let body;
    try { body = await readJSON(request); } catch (_) { return json({ ok: false }, 400); }
    if (!(await safeEqual(body.senha || '', adminPassword(env)))) {
      return json({ ok: false, error: 'Senha incorreta.' }, 401);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await createSession(env), SESSION_TTL_S) });
  }

  if (route === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (!(await isAuthed(request, env))) return json({ ok: false, error: 'Não autenticado.' }, 401);

  if (route === '/leads' && method === 'POST') {
    let body;
    try { body = await readJSON(request); } catch (_) { return json({ ok: false, error: 'Requisição inválida.' }, 400); }
    const nome = clean(body.nome, 120);
    const telefone = clean(body.telefone, 30).replace(/[^\d+()\s-]/g, '');
    const email = clean(body.email, 160).toLowerCase();
    if (nome.length < 2) return json({ ok: false, error: 'Informe o nome.' }, 422);
    if (telefone.replace(/\D/g, '').length < 10) return json({ ok: false, error: 'Informe o telefone com DDD.' }, 422);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: 'E-mail inválido.' }, 422);
    const now = new Date().toISOString();
    const lead = {
      id: crypto.randomUUID(), criadoEm: now, atualizadoEm: now,
      nome, telefone, email,
      tipoPlano: clean(body.tipoPlano, 60), vidas: clean(body.vidas, 20),
      origem: 'manual', utm_source: clean(body.fonte, 60),
      utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '', gclid: '', fbclid: '',
      pagina: '', referrer: '', ip: '', cidade: '',
      status: STATUSES.includes(body.status) ? body.status : 'primeiro_contato',
      notas: clean(body.notas, 2000),
    };
    await env.LEADS.put(leadKey(lead), JSON.stringify(lead));
    return json({ ok: true, lead }, 201);
  }

  if (route === '/leads' && method === 'GET') {
    return json({ ok: true, leads: await listLeads(env), statuses: STATUSES });
  }

  if (route === '/leads.csv' && method === 'GET') {
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCSV(await listLeads(env)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-futura-rio-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const m = route.match(/^\/leads\/([0-9a-f-]{36})$/);
  if (m) {
    const key = await findLeadKey(env, m[1]);
    if (!key) return json({ ok: false, error: 'Lead não encontrado.' }, 404);

    if (method === 'PATCH') {
      let body;
      try { body = await readJSON(request); } catch (_) { return json({ ok: false }, 400); }
      const lead = await env.LEADS.get(key, 'json');
      lead.status = normalizeStatus(lead.status);
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json({ ok: false, error: 'Status inválido.' }, 422);
        lead.status = body.status;
      }
      if (body.notas !== undefined) lead.notas = clean(body.notas, 2000);
      lead.atualizadoEm = new Date().toISOString();
      await env.LEADS.put(key, JSON.stringify(lead));
      return json({ ok: true, lead });
    }

    if (method === 'DELETE') {
      await env.LEADS.delete(key);
      return json({ ok: true });
    }
  }

  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}
