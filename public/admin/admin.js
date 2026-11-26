(function () {
  'use strict';

  var STATUS_LABEL = {
    novo: 'Novo',
    em_contato: 'Em contato',
    cotacao_enviada: 'Cotação enviada',
    negociando: 'Negociando',
    fechado: 'Fechado',
    perdido: 'Perdido'
  };

  var state = { leads: [], statuses: Object.keys(STATUS_LABEL) };
  var $ = function (id) { return document.getElementById(id); };

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    opts.credentials = 'same-origin';
    return fetch('/admin/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function waLink(tel, nome) {
    var d = String(tel).replace(/\D/g, '');
    if (d.length <= 11) d = '55' + d;
    var txt = 'Olá, ' + nome.split(' ')[0] + '! Aqui é a Carla Jansen, da Futura Rio. Recebi seu contato pelo site e vou preparar sua cotação.';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(txt);
  }

  /* ---------- Login ---------- */
  function showLogin() { $('app').hidden = true; $('login').hidden = false; }
  function showApp() { $('login').hidden = true; $('app').hidden = false; }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('login-err').textContent = '';
    api('/login', { method: 'POST', body: JSON.stringify({ senha: e.target.senha.value }) }).then(function (r) {
      if (!r.ok) { $('login-err').textContent = r.error || 'Não foi possível entrar.'; return; }
      e.target.reset();
      load();
    });
  });

  $('logout').addEventListener('click', function () {
    api('/logout', { method: 'POST' }).then(showLogin);
  });
  $('refresh').addEventListener('click', function () { load(true); });

  /* ---------- Dados ---------- */
  function load(notify) {
    api('/leads').then(function (r) {
      if (r._status === 401) { showLogin(); return; }
      state.leads = r.leads || [];
      state.statuses = r.statuses || state.statuses;
      showApp();
      fillStatusFilter();
      render();
      if (notify) toast('Lista atualizada');
    });
  }

  function fillStatusFilter() {
    var sel = $('f-status');
    if (sel.options.length > 1) return;
    state.statuses.forEach(function (s) { sel.appendChild(el('option', { value: s, text: STATUS_LABEL[s] || s })); });
  }

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var st = $('f-status').value;
    var days = Number($('f-periodo').value);
    var since = 0;
    if (days) {
      var start = new Date(); start.setHours(0, 0, 0, 0);
      since = start.getTime() - (days - 1) * 86400000;
    }
    return state.leads.filter(function (l) {
      if (st && l.status !== st) return false;
      if (since && new Date(l.criadoEm).getTime() < since) return false;
      if (q) {
        var hay = [l.nome, l.telefone, l.email, l.utm_source, l.utm_campaign, l.tipoPlano, l.origem, l.notas].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1 && hay.replace(/\D/g, '').indexOf(q.replace(/\D/g, '') || '§') === -1) return false;
      }
      return true;
    });
  }

  function renderKpis() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var week = today.getTime() - 6 * 86400000;
    var L = state.leads;
    var count = function (fn) { return L.filter(fn).length; };
    var fechados = count(function (l) { return l.status === 'fechado'; });
    var items = [
      [L.length, 'Leads no total'],
      [count(function (l) { return new Date(l.criadoEm) >= today; }), 'Hoje'],
      [count(function (l) { return new Date(l.criadoEm).getTime() >= week; }), 'Últimos 7 dias'],
      [count(function (l) { return l.status === 'novo'; }), 'Aguardando contato'],
      [fechados, 'Fechados'],
      [L.length ? Math.round((fechados / L.length) * 100) + '%' : '0%', 'Conversão']
    ];
    var ul = $('kpis');
    ul.textContent = '';
    items.forEach(function (it) { ul.appendChild(el('li', null, [el('strong', { text: String(it[0]) }), el('span', { text: it[1] })])); });
  }

  function render() {
    renderKpis();
    var rows = $('rows');
    rows.textContent = '';
    var list = filtered();
    $('empty').hidden = list.length > 0;

    list.forEach(function (l) {
      var sel = el('select', { class: 's-' + l.status, 'aria-label': 'Status' });
      state.statuses.forEach(function (s) {
        var o = el('option', { value: s, text: STATUS_LABEL[s] || s });
        if (s === l.status) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        update(l, { status: sel.value }, function () { sel.className = 's-' + sel.value; toast('Status atualizado'); });
      });

      var notes = el('textarea', { placeholder: 'Anotações...', 'aria-label': 'Notas' });
      notes.value = l.notas || '';
      notes.addEventListener('change', function () { update(l, { notas: notes.value }, function () { toast('Nota salva'); }); });

      var del = el('button', { class: 'del', title: 'Excluir lead', 'aria-label': 'Excluir lead', text: '🗑' });
      del.addEventListener('click', function () {
        if (!confirm('Excluir o lead de ' + l.nome + '? Essa ação não pode ser desfeita.')) return;
        api('/leads/' + l.id, { method: 'DELETE' }).then(function (r) {
          if (!r.ok) return toast(r.error || 'Erro ao excluir');
          state.leads = state.leads.filter(function (x) { return x.id !== l.id; });
          render();
          toast('Lead excluído');
        });
      });

      var origemTags = [l.origem, l.utm_source, l.utm_medium, l.utm_campaign]
        .filter(Boolean).map(function (t) { return el('span', { class: 'tag', text: t }); });
      if (l.gclid) origemTags.push(el('span', { class: 'tag', text: 'Google Ads' }));
      if (l.fbclid) origemTags.push(el('span', { class: 'tag', text: 'Meta Ads' }));

      rows.appendChild(el('tr', null, [
        el('td', { text: fmtDate(l.criadoEm) }),
        el('td', null, [el('span', { class: 'name', text: l.nome })]),
        el('td', null, [
          el('a', { class: 'wa-link', href: waLink(l.telefone, l.nome), target: '_blank', rel: 'noopener', text: '📱 ' + l.telefone }),
          el('small', null, [el('a', { class: 'mail', href: 'mailto:' + l.email, text: l.email })])
        ]),
        el('td', null, [el('span', { text: l.tipoPlano || '—' }), l.vidas ? el('small', { text: l.vidas + ' vida(s)' }) : null]),
        el('td', null, origemTags.length ? origemTags : [el('span', { text: '—' })]),
        el('td', null, [sel]),
        el('td', null, [notes]),
        el('td', null, [del])
      ]));
    });
  }

  function update(lead, patch, done) {
    api('/leads/' + lead.id, { method: 'PATCH', body: JSON.stringify(patch) }).then(function (r) {
      if (!r.ok) return toast(r.error || 'Erro ao salvar');
      Object.assign(lead, r.lead);
      if (patch.status) renderKpis();
      done && done();
    });
  }

  ['q', 'f-status', 'f-periodo'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });

  // Atualiza sozinho a cada 60s para mostrar leads novos
  setInterval(function () { if (!$('app').hidden && document.visibilityState === 'visible') load(); }, 60000);

  load();
})();
