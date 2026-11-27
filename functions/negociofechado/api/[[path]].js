// /negociofechado/api/* — CRM de contratos fechados e comissões
import {
  json, clean, readJSON, SESSION_TTL_S, safeEqual, createSession, isAuthed, sessionCookie, rateLimited,
  finPassword, listContracts, getRules, sanitizeRules, parseBRL, OPERADORAS, sanitizeBenef,
} from '../../../lib/cf.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function applyContractPatch(c, body) {
  const txt = { nome: 120, telefone: 30, email: 160, operadora: 80, produto: 160, vidas: 20, notas: 3000 };
  for (const [k, max] of Object.entries(txt)) if (body[k] !== undefined) c[k] = clean(body[k], max);
  if (body.tipoPessoa !== undefined) c.tipoPessoa = body.tipoPessoa === 'PF' ? 'PF' : 'PJ';
  if (body.valor !== undefined) c.valor = parseBRL(body.valor);
  if (body.vigencia !== undefined) {
    const v = clean(body.vigencia, 10);
    if (v && !DATE_RE.test(v)) return 'Data de vigência inválida.';
    c.vigencia = v;
  }
  if (body.aniversario !== undefined) {
    const v = clean(body.aniversario, 10);
    if (v && !DATE_RE.test(v)) return 'Data de aniversário inválida.';
    c.aniversario = v;
  }
  if (body.beneficiarios !== undefined) c.beneficiarios = sanitizeBenef(body.beneficiarios);
  if (body.parcelaValor && MONTH_RE.test(body.parcelaValor.mes || '')) {
    if (!c.parcelasValores || typeof c.parcelasValores !== 'object') c.parcelasValores = {};
    const v = body.parcelaValor.valor;
    if (v === null || v === '' || v === undefined) delete c.parcelasValores[body.parcelaValor.mes];
    else c.parcelasValores[body.parcelaValor.mes] = parseBRL(v);
  }
  if (body.vitalicioAjustes !== undefined) {
    const list = Array.isArray(body.vitalicioAjustes) ? body.vitalicioAjustes : [];
    const byMonth = {};
    list.slice(0, 120).forEach((x) => {
      const desde = clean(x && x.desde, 7);
      if (!MONTH_RE.test(desde)) return;
      byMonth[desde] = parseBRL(x.valor);
    });
    c.vitalicioAjustes = Object.keys(byMonth).sort().map((desde) => ({ desde, valor: byMonth[desde] }));
  }
  if (body.status !== undefined) c.status = body.status === 'cancelado' ? 'cancelado' : 'ativo';
  if (body.canceladoEm !== undefined) {
    const v = clean(body.canceladoEm, 10);
    if (v && !DATE_RE.test(v)) return 'Data de cancelamento inválida.';
    c.canceladoEm = v;
  }
  if (c.status === 'ativo') c.canceladoEm = '';
  if (body.pagamento && MONTH_RE.test(body.pagamento.mes || '')) {
    if (!c.pagamentos || typeof c.pagamentos !== 'object') c.pagamentos = {};
    if (body.pagamento.recebido) {
      c.pagamentos[body.pagamento.mes] = {
        recebido: true,
        valor: body.pagamento.valor !== undefined && body.pagamento.valor !== '' ? parseBRL(body.pagamento.valor) : null,
        em: new Date().toISOString(),
      };
    } else {
      delete c.pagamentos[body.pagamento.mes];
    }
  }
  c.atualizadoEm = new Date().toISOString();
  return null;
}

export async function onRequest({ request, env, params }) {
  if (!env.LEADS) return json({ ok: false, error: 'Armazenamento não configurado (KV LEADS).' }, 500);
  const route = '/' + (Array.isArray(params.path) ? params.path.join('/') : params.path || '');
  const method = request.method;

  if (route === '/login' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (ip && (await rateLimited(env, `finlogin:${ip}`, 10, 900))) {
      return json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
    }
    let body;
    try { body = await readJSON(request); } catch (_) { return json({ ok: false }, 400); }
    if (!(await safeEqual(body.senha || '', finPassword(env)))) return json({ ok: false, error: 'Senha incorreta.' }, 401);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await createSession(env, 'fin'), SESSION_TTL_S, 'fin') });
  }
  if (route === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, 'fin') });
  }

  if (!(await isAuthed(request, env, 'fin'))) return json({ ok: false, error: 'Não autenticado.' }, 401);

  if (route === '/contratos' && method === 'GET') {
    const [contratos, regras] = await Promise.all([listContracts(env), getRules(env)]);
    return json({ ok: true, contratos, regras, operadoras: OPERADORAS });
  }

  if (route === '/contratos' && method === 'POST') {
    let body;
    try { body = await readJSON(request); } catch (_) { return json({ ok: false, error: 'Requisição inválida.' }, 400); }
    const now = new Date().toISOString();
    const c = { id: crypto.randomUUID(), leadId: '', criadoEm: now, atualizadoEm: now, nome: '', telefone: '', email: '',
      tipoPessoa: 'PJ', operadora: '', produto: '', valor: 0, vigencia: '', vidas: '', status: 'ativo', canceladoEm: '', notas: '', pagamentos: {} };
    const err = applyContractPatch(c, body);
    if (err) return json({ ok: false, error: err }, 422);
    if (c.nome.length < 2) return json({ ok: false, error: 'Informe o nome do cliente.' }, 422);
    await env.LEADS.put(`contrato:${c.id}`, JSON.stringify(c));
    return json({ ok: true, contrato: c }, 201);
  }

  if (route === '/regras' && method === 'GET') return json({ ok: true, regras: await getRules(env) });
  if (route === '/regras' && method === 'PUT') {
    let body;
    try { body = await readJSON(request); } catch (_) { return json({ ok: false, error: 'Requisição inválida.' }, 400); }
    const regras = sanitizeRules(body.regras);
    await env.LEADS.put('config:comissoes', JSON.stringify(regras));
    return json({ ok: true, regras });
  }

  const m = route.match(/^\/contratos\/([0-9a-f-]{36})$/);
  if (m) {
    const key = `contrato:${m[1]}`;
    const c = await env.LEADS.get(key, 'json');
    if (!c) return json({ ok: false, error: 'Contrato não encontrado.' }, 404);
    if (method === 'PATCH') {
      let body;
      try { body = await readJSON(request); } catch (_) { return json({ ok: false }, 400); }
      const err = applyContractPatch(c, body);
      if (err) return json({ ok: false, error: err }, 422);
      await env.LEADS.put(key, JSON.stringify(c));
      return json({ ok: true, contrato: c });
    }
    if (method === 'DELETE') {
      await env.LEADS.delete(key);
      if (c.leadId) await env.LEADS.delete(`contrato-lead:${c.leadId}`);
      return json({ ok: true });
    }
  }
  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}
