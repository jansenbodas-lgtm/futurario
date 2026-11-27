(function () {
  'use strict';

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var state = { contratos: [], regras: { PJ: {}, PF: {} }, operadoras: [], current: null, pay: null, rulesTab: 'PJ' };
  var $ = function (id) { return document.getElementById(id); };
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  function money(v) { return brl.format(v || 0); }
  function moneyShort(v) {
    if (v >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + ' mi';
    if (v >= 1e4) return 'R$ ' + Math.round(v / 1e3) + ' mil';
    return brl0.format(v || 0);
  }

  /* ---------- utilidades ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    opts.credentials = 'same-origin';
    return fetch('/negociofechado/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function openDlg(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  function closeDlg(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
  function parseBRL(v) {
    var s = String(v == null ? '' : v).replace(/[^\d,.-]/g, '');
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = parseFloat(s);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }
  function pct(n) { return String(n).replace('.', ','); }
  function ruleText(r) { return r.parcelas.map(pct).join('/') + '%' + (r.vitalicio ? ' + ' + pct(r.vitalicio) + '% vitalício' : ''); }
  function brDate(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  /* ---------- meses ---------- */
  function idxOf(iso) { var p = String(iso).split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1; }
  function ymOf(idx) { var y = Math.floor(idx / 12), m = idx % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  function labelOf(idx) { return MESES[idx % 12] + '/' + String(Math.floor(idx / 12)).slice(2); }
  function nowIdx() { var d = new Date(); return d.getFullYear() * 12 + d.getMonth(); }

  /* ---------- regra de comissão ---------- */
  function ruleOf(c) { var t = state.regras[c.tipoPessoa] || {}; return t[c.operadora] || null; }
  function problemOf(c) {
    if (!c.valor) return 'sem valor mensal';
    if (!c.vigencia) return 'sem data de vigência';
    if (!c.operadora) return 'sem operadora';
    if (!ruleOf(c)) return 'sem regra de comissão para ' + c.operadora + ' ' + c.tipoPessoa;
    return '';
  }
  /** Comissão prevista de um contrato num mês: {v, kind:'p'|'v', n} ou null */
  function amountAt(c, mi) {
    var r = ruleOf(c);
    if (!r || !c.valor || !c.vigencia) return null;
    var n = mi - idxOf(c.vigencia);
    if (n < 0) return null;
    if (c.status === 'cancelado' && c.canceladoEm && mi >= idxOf(c.canceladoEm)) return null;
    if (n < r.parcelas.length) return { v: c.valor * r.parcelas[n] / 100, kind: 'p', n: n + 1 };
    if (r.vitalicio > 0) return { v: c.valor * r.vitalicio / 100, kind: 'v' };
    return null;
  }

  /* ---------- login ---------- */
  function showLogin() { $('app').hidden = true; $('login').hidden = false; }
  function showApp() { $('login').hidden = true; $('app').hidden = false; }
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault(); $('login-err').textContent = '';
    api('/login', { method: 'POST', body: JSON.stringify({ senha: e.target.senha.value }) }).then(function (r) {
      if (!r.ok) { $('login-err').textContent = r.error || 'Não foi possível entrar.'; return; }
      e.target.reset(); load();
    });
  });
  $('logout').addEventListener('click', function () { api('/logout', { method: 'POST' }).then(showLogin); });

  function load() {
    api('/contratos').then(function (r) {
      if (r._status === 401) { showLogin(); return; }
      state.contratos = r.contratos || [];
      state.regras = r.regras || { PJ: {}, PF: {} };
      state.operadoras = r.operadoras || [];
      showApp(); fillOps(); render();
    });
  }
  function fillOps() {
    var sel = $('f-op');
    state.contratos.forEach(function (c) {
      if (c.operadora && state.operadoras.indexOf(c.operadora) === -1) state.operadoras.splice(state.operadoras.length - 1, 0, c.operadora);
    });
    if (sel.options.length > 1) return;
    state.operadoras.forEach(function (o) { sel.appendChild(el('option', { value: o, text: o })); });
    var cop = $('c-op');
    cop.appendChild(el('option', { value: '', text: '—' }));
    state.operadoras.forEach(function (o) { cop.appendChild(el('option', { value: o, text: o })); });
  }

  /* ---------- filtros ---------- */
  function filtered() {
    var q = $('q').value.trim().toLowerCase(), tipo = $('f-tipo').value, op = $('f-op').value, st = $('f-status').value;
    return state.contratos.filter(function (c) {
      if (tipo && c.tipoPessoa !== tipo) return false;
      if (op && c.operadora !== op) return false;
      if (st && c.status !== st) return false;
      if (q && [c.nome, c.operadora, c.produto, c.telefone].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function months() {
    var start = nowIdx() + Number($('f-from').value), n = Number($('f-horizon').value) - Number($('f-from').value);
    var out = []; for (var i = 0; i < n; i++) out.push(start + i); return out;
  }

  /* ---------- render ---------- */
  function render() {
    var list = filtered(), ms = months();
    var totals = ms.map(function (mi) {
      var p = 0, v = 0, rec = 0;
      list.forEach(function (c) {
        var a = amountAt(c, mi); if (a) { if (a.kind === 'p') p += a.v; else v += a.v; }
        var pg = c.pagamentos && c.pagamentos[ymOf(mi)];
        if (pg && pg.recebido) rec += pg.valor != null ? pg.valor : (a ? a.v : 0);
      });
      return { mi: mi, p: p, v: v, t: p + v, rec: rec };
    });
    renderKpis(list);
    renderBdays();
    renderChart(totals);
    renderWarn(list);
    renderTable(list, ms, totals);
  }

  function bdayInfo(iso) {
    if (!iso) return null;
    var p = iso.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
    var t = new Date(); t.setHours(0, 0, 0, 0);
    function occ(year) { var dd = d; if (m === 1 && d === 29 && new Date(year, 1, 29).getMonth() !== 1) dd = 28; return new Date(year, m, dd); }
    var next = occ(t.getFullYear()); if (next < t) next = occ(t.getFullYear() + 1);
    return { days: Math.round((next - t) / 86400000), age: y > 1900 ? next.getFullYear() - y : null, label: String(d).padStart(2, '0') + '/' + String(m + 1).padStart(2, '0') };
  }
  function renderBdays() {
    window.FRBenef.banner($('bday'), state.contratos.filter(function (c) { return c.status === 'ativo'; }), openContract, ' · clientes ativos');
  }

  function sumMonths(list, from, count) {
    var s = 0;
    for (var i = 0; i < count; i++) list.forEach(function (c) { var a = amountAt(c, from + i); if (a) s += a.v; });
    return s;
  }
  function renderKpis(list) {
    var n0 = nowIdx();
    var vitRec = 0;
    list.forEach(function (c) { var r = ruleOf(c); if (c.status === 'ativo' && r && r.vitalicio && c.valor) vitRec += c.valor * r.vitalicio / 100; });
    var recebido = 0;
    list.forEach(function (c) {
      var pg = c.pagamentos && c.pagamentos[ymOf(n0)];
      if (pg && pg.recebido) { var a = amountAt(c, n0); recebido += pg.valor != null ? pg.valor : (a ? a.v : 0); }
    });
    var items = [
      [money(sumMonths(list, n0, 1)), 'Previsto em ' + labelOf(n0)],
      [money(recebido), 'Recebido em ' + labelOf(n0)],
      [money(sumMonths(list, n0 + 1, 3)), 'Próximos 3 meses'],
      [money(sumMonths(list, n0, 12)), 'Próximos 12 meses'],
      [money(vitRec), 'Vitalício recorrente / mês'],
      [String(list.filter(function (c) { return c.status === 'ativo'; }).length), 'Contratos ativos']
    ];
    var ul = $('kpis'); ul.textContent = '';
    items.forEach(function (it) { ul.appendChild(el('li', null, [el('strong', { text: it[0] }), el('span', { text: it[1] })])); });
  }

  function renderWarn(list) {
    var bad = list.filter(function (c) { return c.status === 'ativo' && problemOf(c); });
    var w = $('warn');
    w.hidden = !bad.length;
    if (!bad.length) return;
    w.textContent = '';
    w.appendChild(el('strong', { text: '⚠ ' + bad.length + ' contrato(s) sem previsão: ' }));
    bad.slice(0, 6).forEach(function (c, i) {
      var b = el('button', { type: 'button', class: 'cname', text: c.nome });
      b.addEventListener('click', function () { openContract(c); });
      w.appendChild(b); w.appendChild(document.createTextNode(' (' + problemOf(c) + ')' + (i < Math.min(bad.length, 6) - 1 ? ', ' : '')));
    });
    if (bad.length > 6) w.appendChild(document.createTextNode(' e mais ' + (bad.length - 6) + '.'));
  }

  /* Gráfico de colunas empilhadas: vitalício (base) + parcelas (topo) */
  function barPath(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function niceMax(v) {
    if (v <= 0) return 1000;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function renderChart(totals) {
    var box = $('chart'); box.textContent = '';
    var W = box.clientWidth || 800, H = box.clientHeight || 280, L = 64, R = 8, T = 22, B = 26;
    var max = niceMax(Math.max.apply(null, totals.map(function (t) { return t.t; }).concat([0])));
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
    var iw = W - L - R, ih = H - T - B, band = iw / totals.length, bw = Math.max(6, Math.min(24, band * 0.55));
    var y = function (v) { return T + ih - (v / max) * ih; };
    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = y(gv);
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: gy, y2: gy, class: 'gl' }));
      var tx = svg('text', { x: L - 8, y: gy + 4, 'text-anchor': 'end', class: 'ax' }); tx.textContent = moneyShort(gv); s.appendChild(tx);
    }
    var n0 = nowIdx(), maxI = -1, maxV = 0;
    totals.forEach(function (t, i) { if (t.t > maxV) { maxV = t.t; maxI = i; } });
    var step = totals.length > 14 ? 2 : 1;
    totals.forEach(function (t, i) {
      var cx = L + band * i + band / 2, x = cx - bw / 2;
      var hv = (t.v / max) * ih, hp = (t.p / max) * ih, gap = hv > 0 && hp > 0 ? 2 : 0;
      if (hv > 0) s.appendChild(svg('path', { d: hp > 0 ? 'M' + x + ',' + (T + ih) + 'V' + (T + ih - hv) + 'H' + (x + bw) + 'V' + (T + ih) + 'Z' : barPath(x, T + ih - hv, bw, hv, 4), fill: 'var(--s-vit)' }));
      if (hp > 0) s.appendChild(svg('path', { d: barPath(x, T + ih - hv - gap - hp, bw, hp, 4), fill: 'var(--s-parcela)' }));
      if (i % step === 0) {
        var lx = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'ax' + (t.mi === n0 ? ' now' : '') }); lx.textContent = labelOf(t.mi); s.appendChild(lx);
      }
      if (i === maxI && maxV > 0) {
        var vl = svg('text', { x: cx, y: y(t.t) - 6, 'text-anchor': 'middle', class: 'val' }); vl.textContent = moneyShort(t.t); s.appendChild(vl);
      }
      var hit = svg('rect', { x: L + band * i, y: T, width: band, height: ih, class: 'hit' });
      hit.addEventListener('mouseenter', function (e) { showTip(t, cx, hit); });
      hit.addEventListener('mouseleave', hideTip);
      s.appendChild(hit);
    });
    box.appendChild(s);
  }
  function showTip(t, cx, hit) {
    document.querySelectorAll('.chart .hit').forEach(function (h) { h.classList.remove('is-on'); });
    hit.classList.add('is-on');
    var tip = $('tip'); tip.textContent = '';
    tip.appendChild(el('strong', { text: labelOf(t.mi) }));
    [['p', 'Parcelas iniciais', t.p], ['v', 'Vitalício', t.v]].forEach(function (r) {
      tip.appendChild(el('div', { class: 'row' }, [el('span', null, [el('i', { class: 'sw sw--' + r[0] }), r[1]]), el('span', { text: money(r[2]) })]));
    });
    tip.appendChild(el('div', { class: 'row tot' }, [el('span', { text: 'Total previsto' }), el('span', { text: money(t.t) })]));
    if (t.rec) tip.appendChild(el('div', { class: 'row' }, [el('span', { text: 'Recebido' }), el('span', { text: money(t.rec) })]));
    tip.hidden = false;
    var box = $('chart'), panel = box.parentElement;
    var bx = box.offsetLeft + (cx / (box.clientWidth || 1)) * box.clientWidth;
    var left = Math.min(Math.max(bx - tip.offsetWidth / 2, 8), panel.clientWidth - tip.offsetWidth - 8);
    tip.style.left = left + 'px'; tip.style.top = (box.offsetTop + 4) + 'px';
  }
  function hideTip() {
    $('tip').hidden = true;
    document.querySelectorAll('.chart .hit').forEach(function (h) { h.classList.remove('is-on'); });
  }

  /* Tabela: contratos × meses */
  function renderTable(list, ms, totals) {
    var t = $('fin-table'); t.textContent = '';
    $('empty').hidden = state.contratos.length > 0;
    if (!list.length) return;
    var n0 = nowIdx();
    var head = el('tr', null, [el('th', { class: 'c-name', text: 'Cliente / contrato' })]);
    ms.forEach(function (mi) { head.appendChild(el('th', { class: mi === n0 ? 'is-now' : '', text: labelOf(mi) })); });
    t.appendChild(el('thead', null, [head]));
    var tb = el('tbody');
    list.forEach(function (c) {
      var nm = el('button', { type: 'button', class: 'cname', text: c.nome });
      nm.addEventListener('click', function () { openContract(c); });
      var r = ruleOf(c), prob = problemOf(c);
      var meta = [c.operadora || 'Operadora?', c.produto].filter(Boolean).join(' · ') + ' — ' + (c.valor ? money(c.valor) + '/mês' : 'valor?') + ' · vig. ' + (c.vigencia ? brDate(c.vigencia) : '?');
      var first = el('td', { class: 'c-name' }, [
        el('span', { class: 'badge badge--' + c.tipoPessoa, text: c.tipoPessoa }),
        c.status === 'cancelado' ? el('span', { class: 'badge badge--x', text: 'cancelado' }) : null,
        nm, el('span', { class: 'cmeta', text: meta }),
        prob ? el('span', { class: 'cmeta', text: '⚠ ' + prob }) : (r ? el('span', { class: 'cmeta', text: 'Regra: ' + ruleText(r) }) : null)
      ]);
      var tr = el('tr', { class: c.status === 'cancelado' ? 'row-cancel' : '' }, [first]);
      ms.forEach(function (mi) {
        var a = amountAt(c, mi), pg = c.pagamentos && c.pagamentos[ymOf(mi)], td = el('td');
        if (a || (pg && pg.recebido)) {
          var val = pg && pg.recebido && pg.valor != null ? pg.valor : (a ? a.v : 0);
          var b = el('button', { type: 'button', class: 'cell' + (pg && pg.recebido ? ' is-paid' : (mi < n0 ? ' is-late' : '')),
            title: (pg && pg.recebido ? 'Recebido' : (mi < n0 ? 'Não marcado como recebido' : 'Previsto')) + ' · clique para alterar' }, [
            a ? el('span', { class: 'k k--' + a.kind, text: a.kind === 'p' ? 'P' + a.n : 'V' }) : null,
            el('span', { text: money(val) })
          ]);
          b.addEventListener('click', function () { openPay(c, mi, a); });
          td.appendChild(b);
        } else td.appendChild(el('span', { class: 'dash', text: '—' }));
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var f1 = el('tr', null, [el('td', { class: 'c-name', text: 'Total previsto' })]);
    var f2 = el('tr', null, [el('td', { class: 'c-name', text: 'Total recebido' })]);
    totals.forEach(function (x) { f1.appendChild(el('td', { text: money(x.t) })); f2.appendChild(el('td', { text: x.rec ? money(x.rec) : '—' })); });
    t.appendChild(el('tfoot', null, [f1, f2]));
  }

  /* ---------- recebimento ---------- */
  var pdlg = $('p-dialog');
  function openPay(c, mi, a) {
    state.pay = { c: c, mi: mi };
    var pg = c.pagamentos && c.pagamentos[ymOf(mi)];
    $('p-sub').textContent = c.nome + ' · ' + labelOf(mi) + (a ? ' · previsto ' + money(a.v) + (a.kind === 'p' ? ' (parcela ' + a.n + ')' : ' (vitalício)') : '');
    $('p-form').elements.valor.value = pg && pg.valor != null ? String(pg.valor).replace('.', ',') : '';
    $('p-undo').hidden = !(pg && pg.recebido);
    openDlg(pdlg);
  }
  function savePay(recebido) {
    var p = state.pay; if (!p) return;
    var v = $('p-form').elements.valor.value.trim();
    api('/contratos/' + p.c.id, { method: 'PATCH', body: JSON.stringify({ pagamento: { mes: ymOf(p.mi), recebido: recebido, valor: v } }) }).then(function (r) {
      if (r._status === 401) { closeDlg(pdlg); showLogin(); return; }
      if (!r.ok) return toast(r.error || 'Erro ao salvar');
      Object.assign(p.c, r.contrato); closeDlg(pdlg); render();
      toast(recebido ? 'Marcado como recebido' : 'Recebimento desmarcado');
    });
  }
  $('p-form').addEventListener('submit', function (e) { e.preventDefault(); savePay(true); });
  $('p-undo').addEventListener('click', function () { savePay(false); });

  /* ---------- contrato ---------- */
  var cdlg = $('c-dialog'), cform = $('c-form');
  function openContract(c) {
    state.current = c || null;
    $('c-title').textContent = c ? c.nome : 'Novo contrato';
    $('c-sub').textContent = c ? (c.leadId ? 'Copiado do CRM em ' : 'Cadastrado em ') + new Date(c.criadoEm).toLocaleDateString('pt-BR') : 'Use para contratos antigos ou fechados fora do site.';
    var f = cform.elements;
    ['nome', 'telefone', 'email', 'aniversario', 'produto', 'vidas', 'vigencia', 'canceladoEm', 'notas'].forEach(function (k) { f[k].value = (c && c[k]) || ''; });
    f.tipoPessoa.value = (c && c.tipoPessoa) || 'PJ';
    state.benefEd = window.FRBenef.editor($('c-benef'), (c && c.beneficiarios) || []);
    if (c && c.operadora && !Array.prototype.some.call(f.operadora.options, function (o) { return o.value === c.operadora; })) {
      f.operadora.appendChild(el('option', { value: c.operadora, text: c.operadora }));
    }
    f.operadora.value = (c && c.operadora) || '';
    f.valor.value = c && c.valor ? String(c.valor.toFixed(2)).replace('.', ',') : '';
    f.status.value = (c && c.status) || 'ativo';
    $('c-del').hidden = !c;
    $('c-err').textContent = '';
    preview();
    openDlg(cdlg);
  }
  function formContract() {
    var f = cform.elements;
    return { nome: f.nome.value.trim(), telefone: f.telefone.value.trim(), email: f.email.value.trim(), aniversario: f.aniversario.value, tipoPessoa: f.tipoPessoa.value, operadora: f.operadora.value,
      produto: f.produto.value.trim(), vidas: f.vidas.value.trim(), valor: parseBRL(f.valor.value), vigencia: f.vigencia.value,
      beneficiarios: state.benefEd ? state.benefEd.get() : [],
      status: f.status.value, canceladoEm: f.status.value === 'cancelado' ? f.canceladoEm.value : '', notas: f.notas.value };
  }
  function preview() {
    var d = formContract(), box = $('c-preview'); box.textContent = '';
    var r = (state.regras[d.tipoPessoa] || {})[d.operadora];
    if (!d.operadora) return;
    if (!r) { box.appendChild(el('span', { text: '⚠ Não há regra de comissão para ' + d.operadora + ' ' + d.tipoPessoa + '. Cadastre em “Regras de comissão”.' })); return; }
    if (!d.valor || !d.vigencia) { box.appendChild(el('span', { text: 'Regra: ' + ruleText(r) + '. Preencha valor e vigência para ver a previsão.' })); return; }
    var start = idxOf(d.vigencia), ol = el('ol');
    var tmp = Object.assign({}, d);
    for (var i = 0; i < Math.min(r.parcelas.length + 3, 12); i++) {
      var a = amountAt(tmp, start + i);
      ol.appendChild(el('li', { text: labelOf(start + i) + ': ' + (a ? money(a.v) + (a.kind === 'p' ? ' (' + pct(r.parcelas[i]) + '%)' : ' (vitalício ' + pct(r.vitalicio) + '%)') : '—') }));
    }
    box.appendChild(el('strong', { text: 'Previsão de recebimento' }));
    box.appendChild(ol);
  }
  cform.addEventListener('input', preview);
  cform.addEventListener('change', preview);
  cform.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = formContract();
    if (d.nome.length < 2) { $('c-err').textContent = 'Informe o nome do cliente.'; return; }
    var c = state.current;
    api(c ? '/contratos/' + c.id : '/contratos', { method: c ? 'PATCH' : 'POST', body: JSON.stringify(d) }).then(function (r) {
      if (r._status === 401) { closeDlg(cdlg); showLogin(); return; }
      if (!r.ok) { $('c-err').textContent = r.error || 'Erro ao salvar'; return; }
      if (c) Object.assign(c, r.contrato); else state.contratos.unshift(r.contrato);
      closeDlg(cdlg); render(); toast('Contrato salvo');
    });
  });
  $('c-del').addEventListener('click', function () {
    var c = state.current; if (!c) return;
    if (!confirm('Excluir o contrato de ' + c.nome + ' do Negócio Fechado? O lead continua no CRM.')) return;
    api('/contratos/' + c.id, { method: 'DELETE' }).then(function (r) {
      if (!r.ok) return toast(r.error || 'Erro ao excluir');
      state.contratos = state.contratos.filter(function (x) { return x.id !== c.id; });
      closeDlg(cdlg); render(); toast('Contrato excluído');
    });
  });
  $('new-contract').addEventListener('click', function () { openContract(null); });

  /* ---------- regras ---------- */
  var rdlg = $('r-dialog'), draft = null;
  function renderRules() {
    document.querySelectorAll('[data-rt]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.rt === state.rulesTab); });
    var tb = $('r-body'); tb.textContent = '';
    var ops = state.operadoras.slice();
    Object.keys(draft[state.rulesTab]).forEach(function (o) { if (ops.indexOf(o) === -1) ops.push(o); });
    ops.forEach(function (op) {
      var r = draft[state.rulesTab][op] || { parcelas: [], vitalicio: 0 };
      var ip = el('input', { value: r.parcelas.map(pct).join('; '), placeholder: 'ex.: 100, 100, 100', 'aria-label': 'Parcelas ' + op });
      var iv = el('input', { value: r.vitalicio ? String(r.vitalicio).replace('.', ',') : '', placeholder: '0', inputmode: 'decimal', 'aria-label': 'Vitalício ' + op });
      function upd() {
        var parc = ip.value.split(ip.value.indexOf(';') !== -1 ? /\s*;\s*/ : /[,\s]+/).map(function (x) { return parseFloat(x.replace(',', '.')); }).filter(function (n) { return isFinite(n) && n >= 0; });
        var vit = parseFloat(iv.value.replace(',', '.')) || 0;
        if (parc.length || vit) draft[state.rulesTab][op] = { parcelas: parc, vitalicio: vit };
        else delete draft[state.rulesTab][op];
      }
      ip.addEventListener('change', upd); iv.addEventListener('change', upd);
      tb.appendChild(el('tr', null, [el('td', { text: op }), el('td', null, [ip]), el('td', null, [iv])]));
    });
  }
  $('open-rules').addEventListener('click', function () {
    draft = JSON.parse(JSON.stringify(state.regras));
    state.rulesTab = 'PJ'; $('r-err').textContent = ''; renderRules(); openDlg(rdlg);
  });
  document.querySelectorAll('[data-rt]').forEach(function (b) {
    b.addEventListener('click', function () { if (document.activeElement) document.activeElement.blur(); state.rulesTab = b.dataset.rt; renderRules(); });
  });
  $('r-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (document.activeElement) document.activeElement.blur();
    setTimeout(function () {
      api('/regras', { method: 'PUT', body: JSON.stringify({ regras: draft }) }).then(function (r) {
        if (r._status === 401) { closeDlg(rdlg); showLogin(); return; }
        if (!r.ok) { $('r-err').textContent = r.error || 'Erro ao salvar'; return; }
        state.regras = r.regras; closeDlg(rdlg); render(); toast('Regras salvas');
      });
    }, 0);
  });

  /* ---------- exportar ---------- */
  $('export').addEventListener('click', function () {
    var list = filtered(), ms = months();
    var esc = function (v) { var s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    var rows = [['Cliente', 'Tipo', 'Operadora', 'Produto', 'Valor mensal', 'Vigência', 'Situação'].concat(ms.map(labelOf))];
    list.forEach(function (c) {
      rows.push([c.nome, c.tipoPessoa, c.operadora, c.produto, String(c.valor || 0).replace('.', ','), brDate(c.vigencia), c.status]
        .concat(ms.map(function (mi) { var a = amountAt(c, mi); return a ? a.v.toFixed(2).replace('.', ',') : ''; })));
    });
    var csv = '﻿' + rows.map(function (r) { return r.map(esc).join(';'); }).join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'previsao-comissoes-' + ymOf(nowIdx()) + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ---------- eventos gerais ---------- */
  document.querySelectorAll('.js-close').forEach(function (b) { b.addEventListener('click', function () { closeDlg(b.closest('dialog')); }); });
  [cdlg, pdlg, rdlg].forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d) closeDlg(d); }); });
  ['q', 'f-tipo', 'f-op', 'f-status', 'f-from', 'f-horizon'].forEach(function (id) { $(id).addEventListener('input', render); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });

  load();
})();
