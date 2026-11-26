/**
 * Cloudflare Worker: serve a landing page (public/) e a API de leads/CRM.
 * Reaproveita os mesmos handlers usados no formato Cloudflare Pages (functions/).
 */
import { onRequestPost as createLead } from './functions/api/leads.js';
import { onRequest as adminApi } from './functions/admin/api/[[path]].js';
import { onRequest as finApi } from './functions/negociofechado/api/[[path]].js';
import { json } from './lib/cf.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/api/leads') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);
      return createLead({ request, env, ctx });
    }

    if (p.startsWith('/admin/api/')) {
      const path = p.slice('/admin/api/'.length).split('/').filter(Boolean);
      return adminApi({ request, env, ctx, params: { path } });
    }

    if (p === '/api/config' && request.method === 'GET') {
      // Rótulo da conversão do Google Ads vem do Secret "id_google_ads" (aceita só o rótulo ou "AW-xxx/rótulo")
      const raw = String(env.id_google_ads || env.GOOGLE_ADS_LABEL || '').trim();
      const gadsLabel = raw.includes('/') ? raw.split('/').pop().trim() : raw;
      return json({ gadsId: 'AW-854308397', gadsLabel }, 200, { 'Cache-Control': 'public, max-age=300' });
    }

    if (p.startsWith('/negociofechado/api/')) {
      const path = p.slice('/negociofechado/api/'.length).split('/').filter(Boolean);
      return finApi({ request, env, ctx, params: { path } });
    }

    if (p.startsWith('/api/')) return json({ ok: false, error: 'Rota não encontrada.' }, 404);

    // Demais rotas: arquivos estáticos de public/ (inclui _headers)
    return env.ASSETS.fetch(request);
  },
};
