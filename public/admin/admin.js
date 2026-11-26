(function () {
  'use strict';

  /* Etapas do pipeline, na ordem das colunas */
  var STAGES = [
    { id: 'primeiro_contato', label: 'Primeiro contato' },
    { id: 'cotacao_enviada', label: 'Cotação enviada' },
    { id: 'negociando', label: 'Negociando' },
    { id: 'aguardando_vigencia', label: 'Aguardando vigência' },
    { id: 'fechado', label: 'Negócio fechado' },
    { id: 'sem_contato', label: 'Não consigo mais contato' }
  ];
  var LABEL = {};
  STAGES.forEach(function (s) { LABEL[s.id] = s.label; });
  var LEGACY = { novo: 'primeiro_contato', em_contato: 'primeiro_contato', perdido: 'sem_contato' };
  function tipoOf(l) { return l.tipoPessoa || (/empresarial|pme|mei/i.test(l.tipoPlano || '') ? 'PJ' : 'PF'); }
  function norm(s) { return LEGACY[s] || (LABEL[s] ? s : 'primeiro_contato'); }

  var state = { leads: [], view: 'pipeline', current: null };
  var $ = function (id) { return document.getElementById(id); };
  try { state.view = localStorage.getItem('fr_view') || 'pipeline'; } catch (e) { /* ok */ }

  /* ---------- utilidades ---------- */
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
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtShort(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function daysSince(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
  function waLink(tel, nome) {
    var d = String(tel).replace(/\D/g, '');
    if (d.length <= 11) d = '55' + d;
    var txt = 'Olá, ' + String(nome).split(' ')[0] + '! Aqui é a Carla Jansen, da Futura Rio. Recebi seu contato pelo site e vou preparar sua cotação.';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(txt);
  }
  function colVar(status) { return '--col: var(--c-' + status + ')'; }
  function stageSelect(current, cls) {
    var sel = el('select', { class: cls || '', 'aria-label': 'Etapa', style: colVar(current) });
    STAGES.forEach(function (s) {
      var o = el('option', { value: s.id, text: s.label });
      if (s.id === current) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  function originTags(l) {
    var tags = [l.origem, l.utm_source, l.utm_campaign].filter(Boolean).map(function (t) { return el('span', { class: 'tag', text: t }); });
    if (l.gclid) tags.push(el('span', { class: 'tag', text: 'Google Ads' }));
    if (l.fbclid) tags.push(el('span', { class: 'tag', text: 'Meta Ads' }));
    return tags;
  }

  /* ---------- login ---------- */
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
  $('logout').addEventListener('click', function () { api('/logout', { method: 'POST' }).then(showLogin); });
  $('refresh').addEventListener('click', function () { load(true); });

  /* ---------- dados ---------- */
  function load(notify) {
    api('/leads').then(function (r) {
      if (r._status === 401) { showLogin(); return; }
      state.leads = (r.leads || []).map(function (l) { l.status = norm(l.status); return l; });
      showApp();
      fillStatusFilter();
      render();
      if (notify) toast('Atualizado');
    });
  }

  function fillStatusFilter() {
    var sel = $('f-status');
    if (sel.options.length > 1) return;
    STAGES.forEach(function (s) { sel.appendChild(el('option', { value: s.id, text: s.label })); });
  }

  function filtered(ignoreStatus) {
    var q = $('q').value.trim().toLowerCase();
    var qd = q.replace(/\D/g, '');
    var st = ignoreStatus ? '' : $('f-status').value;
    var tipo = $('f-tipo').value;
    var days = Number($('f-periodo').value);
    var since = 0;
    if (days) { var s = new Date(); s.setHours(0, 0, 0, 0); since = s.getTime() - (days - 1) * 86400000; }
    return state.leads.filter(function (l) {
      if (st && l.status !== st) return false;
      if (tipo && tipoOf(l) !== tipo) return false;
      if (since && new Date(l.criadoEm).getTime() < since) return false;
      if (q) {
        var hay = [l.nome, (l.beneficiarios || []).map(function (b) { return b.nome; }).join(' '), l.telefone, l.email, l.utm_source, l.utm_campaign, l.tipoPlano, l.origem, l.notas, l.interesse, l.negociacao, l.operadora, l.produto].join(' ').toLowerCase();
        var hit = hay.indexOf(q) !== -1 || (qd.length >= 3 && String(l.telefone).replace(/\D/g, '').indexOf(qd) !== -1);
        if (!hit) return false;
      }
      return true;
    });
  }

  /* ---------- aniversários ---------- */
  function bdayInfo(iso) {
    if (!iso) return null;
    var p = iso.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
    var t = new Date(); t.setHours(0, 0, 0, 0);
    function occ(year) { var dd = d; if (m === 1 && d === 29 && new Date(year, 1, 29).getMonth() !== 1) dd = 28; return new Date(year, m, dd); }
    var next = occ(t.getFullYear()); if (next < t) next = occ(t.getFullYear() + 1);
    var days = Math.round((next - t) / 86400000);
    var age = y > 1900 ? next.getFullYear() - y : null;
    return { days: days, age: age, label: String(d).padStart(2, '0') + '/' + String(m + 1).padStart(2, '0') };
  }
  function bdayWhen(b) { return b.days === 0 ? 'hoje' : b.days === 1 ? 'amanhã' : 'em ' + b.days + ' dias (' + b.label + ')'; }
  function bdayWa(l) {
    var d = String(l.telefone).replace(/\D/g, ''); if (d.length <= 11) d = '55' + d;
    var txt = 'Feliz aniversário, ' + String(l.nome).split(' ')[0] + '! 🎉 Desejo muita saúde, alegria e realizações. Um abraço da Carla Jansen, Futura Rio Corretora.';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(txt);
  }
  function renderBdays() {
    window.FRBenef.banner($('bday'), state.leads, function (l) { openSheet(l, 'historico'); });
  }

  function render() {
    document.body.classList.toggle('view-pipeline', state.view === 'pipeline');
    document.querySelectorAll('.views__btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.view === state.view); });
    $('view-pipeline').hidden = state.view !== 'pipeline';
    $('view-lista').hidden = state.view !== 'lista';
    renderKpis();
    renderBdays();
    if (state.view === 'pipeline') renderBoard(); else renderList();
  }

  function renderKpis() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var week = today.getTime() - 6 * 86400000;
    var L = state.leads;
    var c = function (fn) { return L.filter(fn).length; };
    var fechados = c(function (l) { return l.status === 'fechado'; });
    var ativos = c(function (l) { return ['primeiro_contato', 'cotacao_enviada', 'negociando', 'aguardando_vigencia'].indexOf(l.status) !== -1; });
    var items = [
      [L.length, 'Leads no total'],
      [c(function (l) { return new Date(l.criadoEm) >= today; }), 'Novos hoje'],
      [c(function (l) { return new Date(l.criadoEm).getTime() >= week; }), 'Últimos 7 dias'],
      [ativos, 'Em andamento'],
      [fechados, 'Negócios fechados'],
      [L.length ? Math.round((fechados / L.length) * 100) + '%' : '0%', 'Conversão']
    ];
    var ul = $('kpis');
    ul.textContent = '';
    items.forEach(function (it) { ul.appendChild(el('li', null, [el('strong', { text: String(it[0]) }), el('span', { text: it[1] })])); });
  }

  /* ---------- pipeline ---------- */
  function renderBoard() {
    var board = $('view-pipeline');
    board.textContent = '';
    var list = filtered(true);
    STAGES.forEach(function (stage, idx) {
      var items = list.filter(function (l) { return l.status === stage.id; });
      var colList = el('div', { class: 'col__list', 'data-stage': stage.id });
      if (!items.length) colList.appendChild(el('p', { class: 'col__empty', text: 'Arraste um lead para cá' }));
      items.forEach(function (l) { colList.appendChild(card(l)); });
      bindDrop(colList);
      board.appendChild(el('div', { class: 'col' + (idx === STAGES.length - 1 ? ' col--last' : ''), style: colVar(stage.id) }, [
        el('div', { class: 'col__head' }, [el('span', { class: 'col__title', text: stage.label }), el('span', { class: 'col__count', text: String(items.length) })]),
        colList
      ]));
    });
  }

  function card(l) {
    var age = daysSince(l.atualizadoEm || l.criadoEm);
    var parado = age >= 3 && ['primeiro_contato', 'cotacao_enviada', 'negociando'].indexOf(l.status) !== -1;
    var move = stageSelect(l.status, 'card__move');
    move.addEventListener('change', function () { setStatus(l, move.value); });
    move.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    var nameBtn = el('button', { type: 'button', class: 'card__name', text: l.nome });
    nameBtn.addEventListener('click', function () { openSheet(l); });

    var c = el('article', { class: 'card', draggable: 'true', 'data-id': l.id, style: colVar(l.status) }, [
      el('div', { class: 'card__top' }, [el('span', { class: 'card__who' }, [el('span', { class: 'ptype ptype--' + tipoOf(l), text: tipoOf(l) }), nameBtn]), el('span', { class: 'card__date', text: fmtShort(l.criadoEm) })]),
      (function () {
        var up = window.FRBenef.upcoming(l, 7).sort(function (a, b) { return a.b.days - b.b.days; });
        if (!up.length) return null;
        var x = up[0], who = x.pessoa.titular ? '' : ' de ' + String(x.pessoa.nome || '').split(' ')[0];
        return el('div', { class: 'card__bday', text: '🎂 Aniversário' + who + ' ' + bdayWhen(x.b) + (up.length > 1 ? ' (+' + (up.length - 1) + ')' : '') });
      })(),
      el('div', { class: 'card__line' }, [el('a', { href: waLink(l.telefone, l.nome), target: '_blank', rel: 'noopener', text: '📱 ' + l.telefone })]),
      l.tipoPlano ? el('div', { class: 'card__line', text: '🩺 ' + l.tipoPlano + (l.vidas ? ' · ' + l.vidas + ' vida(s)' : '') }) : null,
      el('div', null, originTags(l)),
      (l.operadora || l.vigencia) ? el('div', { class: 'card__deal' + (l.vigencia && daysUntil(l.vigencia) >= 0 && daysUntil(l.vigencia) <= 7 ? ' is-soon' : ''),
        text: '✅ ' + [l.operadora, l.produto].filter(Boolean).join(' · ') + (l.vigencia ? (l.operadora ? ' — ' : '') + vigText(l.vigencia) : '') }) : null,
      l.notas ? el('div', { class: 'card__notes', text: l.notas }) : null,
      el('div', { class: 'card__foot' }, [
        move,
        el('span', { class: 'card__age' + (parado ? ' is-old' : ''), text: age === 0 ? 'hoje' : (parado ? '⚠ ' : '') + age + 'd sem mudança' })
      ])
    ]);
    c.addEventListener('dragstart', function (e) {
      c.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', l.id);
    });
    c.addEventListener('dragend', function () { c.classList.remove('is-dragging'); });
    c.addEventListener('dblclick', function () { openSheet(l); });
    return c;
  }

  function bindDrop(zone) {
    zone.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', function (e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('is-over');
      var id = e.dataTransfer.getData('text/plain');
      var lead = state.leads.find(function (x) { return x.id === id; });
      if (lead && lead.status !== zone.dataset.stage) setStatus(lead, zone.dataset.stage);
    });
  }

  function setStatus(lead, status) {
    var prev = lead.status;
    lead.status = status;
    lead.atualizadoEm = new Date().toISOString();
    render();
    api('/leads/' + lead.id, { method: 'PATCH', body: JSON.stringify({ status: status }) }).then(function (r) {
      if (!r.ok) { lead.status = prev; render(); return toast(r.error || 'Erro ao salvar'); }
      Object.assign(lead, r.lead, { status: norm(r.lead.status) });
      toast(status === 'fechado' ? 'Negócio fechado! Copiado para o Negócio Fechado 💰' : 'Movido para "' + LABEL[status] + '"');
    });
  }

  /* ---------- lista ---------- */
  function renderList() {
    var rows = $('rows');
    rows.textContent = '';
    var list = filtered(false);
    $('empty').hidden = list.length > 0;
    list.forEach(function (l) {
      var sel = stageSelect(l.status);
      sel.addEventListener('change', function () { setStatus(l, sel.value); });
      var notes = el('textarea', { placeholder: 'Anotações...', 'aria-label': 'Notas' });
      notes.value = l.notas || '';
      notes.addEventListener('change', function () { saveNotes(l, notes.value); });
      var del = el('button', { class: 'del', title: 'Excluir lead', 'aria-label': 'Excluir lead', text: '🗑' });
      del.addEventListener('click', function () { removeLead(l); });
      var nm = el('button', { type: 'button', class: 'name', text: l.nome });
      nm.addEventListener('click', function () { openSheet(l); });
      rows.appendChild(el('tr', null, [
        el('td', { text: fmtDate(l.criadoEm) }),
        el('td', null, [nm]),
        el('td', null, [
          el('a', { class: 'wa-link', href: waLink(l.telefone, l.nome), target: '_blank', rel: 'noopener', text: '📱 ' + l.telefone }),
          el('small', null, [el('a', { class: 'mail', href: 'mailto:' + l.email, text: l.email })])
        ]),
        el('td', null, [el('span', { text: l.tipoPlano || '—' }), l.vidas ? el('small', { text: l.vidas + ' vida(s)' }) : null]),
        el('td', null, originTags(l).length ? originTags(l) : [el('span', { text: '—' })]),
        el('td', null, [sel]),
        el('td', null, [notes]),
        el('td', null, [del])
      ]));
    });
  }

  function saveNotes(lead, value, done) {
    api('/leads/' + lead.id, { method: 'PATCH', body: JSON.stringify({ notas: value }) }).then(function (r) {
      if (!r.ok) return toast(r.error || 'Erro ao salvar');
      Object.assign(lead, r.lead, { status: norm(r.lead.status) });
      toast('Anotação salva');
      if (done) done();
    });
  }

  function removeLead(lead, done) {
    if (!confirm('Excluir o lead de ' + lead.nome + '? Essa ação não pode ser desfeita.')) return;
    api('/leads/' + lead.id, { method: 'DELETE' }).then(function (r) {
      if (!r.ok) return toast(r.error || 'Erro ao excluir');
      state.leads = state.leads.filter(function (x) { return x.id !== lead.id; });
      render();
      toast('Lead excluído');
      if (done) done();
    });
  }

  /* ---------- ficha do lead ---------- */
  var dlg = $('lead-dialog');
  function brDate(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function daysUntil(iso) { var d = new Date(iso + 'T00:00:00'); var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); }
  function vigText(iso) {
    if (!iso) return '';
    var n = daysUntil(iso);
    if (n > 1) return 'Vigência em ' + brDate(iso) + ' (faltam ' + n + ' dias)';
    if (n === 1) return 'Vigência amanhã (' + brDate(iso) + ')';
    if (n === 0) return 'Vigência começa hoje (' + brDate(iso) + ')';
    return 'Vigente desde ' + brDate(iso);
  }

  function showTab(name) {
    document.querySelectorAll('.tabs__btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === name); });
    document.querySelectorAll('.tab').forEach(function (p) { p.hidden = p.dataset.pane !== name; });
  }
  document.querySelectorAll('.tabs__btn').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  function renderTimeline(l) {
    var ol = $('d-timeline');
    ol.textContent = '';
    var h = (l.historico || []).slice().reverse();
    $('d-hcount').textContent = h.length ? String(h.length) : '';
    if (!h.length) { ol.appendChild(el('li', { class: 'empty', text: 'Nenhum registro ainda.' })); return; }
    h.forEach(function (it) {
      ol.appendChild(el('li', { class: 't-' + (it.tipo || 'nota') }, [el('time', { text: fmtDate(it.em) }), el('p', { text: it.texto })]));
    });
  }

  function updateVigHint() {
    var v = $('d-vigencia').value, hint = $('d-vig-hint');
    hint.textContent = vigText(v);
    hint.classList.toggle('is-soon', !!v && daysUntil(v) >= 0 && daysUntil(v) <= 7);
  }
  $('d-vigencia').addEventListener('input', updateVigHint);

  function updateAnivHint() {
    var b = bdayInfo($('d-aniv').value), h = $('d-aniv-hint');
    h.textContent = b ? '🎂 Próximo aniversário ' + bdayWhen(b) + (b.age ? ', faz ' + b.age + ' anos' : '') + '. Você verá um aviso no topo do CRM 7 dias antes.' : 'Com a data de aniversário, o CRM avisa no topo e no cartão quando estiver chegando.';
    h.classList.toggle('is-soon', !!b && b.days <= 7);
  }
  $('d-aniv').addEventListener('input', updateAnivHint);
  $('d-tel').addEventListener('input', function (e) { e.target.value = maskPhone(e.target.value); });

  function openSheet(l, tab) {
    state.current = l;
    $('d-nome').textContent = l.nome;
    $('d-data').textContent = 'Entrou em ' + fmtDate(l.criadoEm) + (l.atualizadoEm ? ' · atualizado em ' + fmtDate(l.atualizadoEm) : '');
    $('d-wa').href = waLink(l.telefone, l.nome);
    $('d-wa').textContent = '📱 ' + l.telefone;
    $('d-mail').hidden = !l.email;
    $('d-mail').href = 'mailto:' + (l.email || '');
    $('d-mail').textContent = '✉️ ' + (l.email || '');
    var info = $('d-info');
    info.textContent = '';
    [['Telefone', l.telefone], ['E-mail', l.email], ['Tipo de plano', l.tipoPlano], ['Vidas', l.vidas], ['Origem', l.origem],
     ['Fonte / campanha', [l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(' / ')],
     ['Anúncio', l.gclid ? 'Google Ads' : (l.fbclid ? 'Meta Ads' : '')], ['Aniversário', l.aniversario ? l.aniversario.split('-').reverse().join('/') : ''], ['Cidade', l.cidade], ['Página', l.pagina], ['Entrou em', fmtDate(l.criadoEm)]]
      .forEach(function (p) { if (p[1]) { info.appendChild(el('dt', { text: p[0] })); info.appendChild(el('dd', { text: p[1] })); } });
    var sel = $('d-status');
    sel.textContent = '';
    STAGES.forEach(function (s) { var o = el('option', { value: s.id, text: s.label }); if (s.id === l.status) o.selected = true; sel.appendChild(o); });
    $('d-tel').value = l.telefone || '';
    $('d-email').value = l.email || '';
    $('d-aniv').value = l.aniversario || '';
    state.benefEd = window.FRBenef.editor($('d-benef'), l.beneficiarios || []);
    updateAnivHint();
    $('d-tipo').value = tipoOf(l);
    $('d-interesse').value = l.interesse || '';
    $('d-negociacao').value = l.negociacao || '';
    $('d-notas').value = l.notas || '';
    var op = $('d-operadora');
    if (l.operadora && !Array.prototype.some.call(op.options, function (o) { return o.value === l.operadora; })) op.appendChild(el('option', { text: l.operadora }));
    op.value = l.operadora || '';
    $('d-produto').value = l.produto || '';
    $('d-valor').value = l.valorMensal || '';
    $('d-vigencia').value = l.vigencia || '';
    $('d-hist').value = '';
    updateVigHint();
    renderTimeline(l);
    showTab(tab || (['aguardando_vigencia', 'fechado'].indexOf(l.status) !== -1 ? 'contratacao' : 'negociacao'));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeSheet() { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }

  function collectPatch(l) {
    var map = { telefone: 'd-tel', email: 'd-email', aniversario: 'd-aniv', tipoPessoa: 'd-tipo', status: 'd-status', interesse: 'd-interesse', negociacao: 'd-negociacao', notas: 'd-notas',
      operadora: 'd-operadora', produto: 'd-produto', valorMensal: 'd-valor', vigencia: 'd-vigencia' };
    var patch = {};
    Object.keys(map).forEach(function (k) { var v = $(map[k]).value; var cur = k === 'tipoPessoa' ? (l.tipoPessoa || '') : (l[k] || ''); if (v !== cur) patch[k] = v; });
    if (state.benefEd) { var nb = state.benefEd.get(); if (JSON.stringify(nb) !== JSON.stringify(l.beneficiarios || [])) patch.beneficiarios = nb; }
    var h = $('d-hist').value.trim();
    if (h) patch.addHistorico = h;
    return patch;
  }

  function sendPatch(l, patch, done) {
    api('/leads/' + l.id, { method: 'PATCH', body: JSON.stringify(patch) }).then(function (r) {
      if (r._status === 401) { closeSheet(); showLogin(); return; }
      if (!r.ok) return toast(r.error || 'Erro ao salvar');
      Object.assign(l, r.lead, { status: norm(r.lead.status) });
      if (done) done(r.lead);
    });
  }

  $('d-hist-add').addEventListener('click', function () {
    var l = state.current, txt = $('d-hist').value.trim();
    if (!l || !txt) return;
    sendPatch(l, { addHistorico: txt }, function () { $('d-hist').value = ''; renderTimeline(l); render(); toast('Registro adicionado ao histórico'); });
  });

  $('d-save').addEventListener('click', function () {
    var l = state.current;
    if (!l) return;
    var patch = collectPatch(l);
    if (!Object.keys(patch).length) { closeSheet(); return; }
    sendPatch(l, patch, function () { if (l.telefone) { $('d-wa').href = waLink(l.telefone, l.nome); } closeSheet(); render(); toast(patch.status === 'fechado' ? 'Negócio fechado! Copiado para o Negócio Fechado 💰' : 'Lead atualizado'); });
  });
  $('d-del').addEventListener('click', function () { if (state.current) removeLead(state.current, closeSheet); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeSheet(); });

  /* ---------- novo lead manual ---------- */
  var ndlg = $('new-dialog');
  var nform = $('new-form');
  (function () {
    var sel = $('n-status');
    STAGES.forEach(function (s) { sel.appendChild(el('option', { value: s.id, text: s.label })); });
  })();
  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  nform.elements.tipoPlano.addEventListener('change', function (e) { nform.elements.tipoPessoa.value = /empresarial|pme|mei/i.test(e.target.value) ? 'PJ' : 'PF'; });
  nform.elements.telefone.addEventListener('input', function (e) { e.target.value = maskPhone(e.target.value); });
  $('new-lead').addEventListener('click', function () {
    nform.reset();
    $('n-err').textContent = '';
    if (typeof ndlg.showModal === 'function') ndlg.showModal(); else ndlg.setAttribute('open', '');
    setTimeout(function () { nform.elements.nome.focus(); }, 50);
  });
  function closeNew() { if (typeof ndlg.close === 'function') ndlg.close(); else ndlg.removeAttribute('open'); }
  document.querySelectorAll('.js-close-new').forEach(function (b) { b.addEventListener('click', closeNew); });
  ndlg.addEventListener('click', function (e) { if (e.target === ndlg) closeNew(); });
  nform.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = nform.elements;
    var payload = {
      nome: f.nome.value.trim(), telefone: f.telefone.value.trim(), email: f.email.value.trim(),
      fonte: f.fonte.value, status: f.status.value, tipoPessoa: f.tipoPessoa.value, tipoPlano: f.tipoPlano.value, vidas: f.vidas.value, notas: f.notas.value
    };
    if (payload.nome.length < 2) { $('n-err').textContent = 'Informe o nome.'; return; }
    if (payload.telefone.replace(/\D/g, '').length < 10) { $('n-err').textContent = 'Informe o telefone com DDD.'; return; }
    var btn = nform.querySelector('button[type="submit"]');
    btn.disabled = true;
    api('/leads', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) {
      btn.disabled = false;
      if (r._status === 401) { closeNew(); showLogin(); return; }
      if (!r.ok) { $('n-err').textContent = r.error || 'Não foi possível salvar.'; return; }
      r.lead.status = norm(r.lead.status);
      state.leads.unshift(r.lead);
      closeNew();
      render();
      toast('Lead cadastrado em "' + LABEL[r.lead.status] + '"');
    });
  });

  /* ---------- eventos ---------- */
  document.querySelectorAll('.views__btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.dataset.view;
      try { localStorage.setItem('fr_view', state.view); } catch (e) { /* ok */ }
      render();
    });
  });
  ['q', 'f-status', 'f-periodo', 'f-tipo'].forEach(function (id) { $(id).addEventListener('input', render); });

  // Atualiza sozinho a cada 60s (sem atrapalhar quem está editando)
  setInterval(function () {
    if ($('app').hidden || document.visibilityState !== 'visible' || dlg.open || ndlg.open) return;
    if (document.activeElement && /TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName)) return;
    load();
  }, 60000);

  load();
})();
