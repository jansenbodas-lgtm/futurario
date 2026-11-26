/* Beneficiários do plano + aniversários — usado no CRM (/admin) e no Negócio Fechado */
(function () {
  'use strict';
  var PARENTESCOS = ['Cônjuge', 'Filho(a)', 'Pai / Mãe', 'Irmão(ã)', 'Sócio(a)', 'Funcionário(a)', 'Dependente', 'Titular', 'Outro'];

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

  /** Editor de lista: retorna { get() } */
  function editor(container, list, onChange) {
    container.textContent = '';
    var rows = el('div', { class: 'benef__rows' });
    var count = el('span', { class: 'benef__count' });
    function upd() {
      var n = rows.children.length;
      count.textContent = n ? n + ' pessoa' + (n === 1 ? '' : 's') + ' além do titular' : 'Nenhuma outra pessoa cadastrada';
      if (onChange) onChange();
    }
    function addRow(b) {
      b = b || {};
      var nome = el('input', { placeholder: 'Nome', 'aria-label': 'Nome do beneficiário', value: b.nome || '' });
      var par = el('select', { 'aria-label': 'Parentesco' });
      par.appendChild(el('option', { value: '', text: 'Parentesco' }));
      PARENTESCOS.forEach(function (p) { var o = el('option', { value: p, text: p }); if (p === b.parentesco) o.selected = true; par.appendChild(o); });
      if (b.parentesco && PARENTESCOS.indexOf(b.parentesco) === -1) { var o2 = el('option', { value: b.parentesco, text: b.parentesco }); o2.selected = true; par.appendChild(o2); }
      var dt = el('input', { type: 'date', 'aria-label': 'Data de aniversário', value: b.aniversario || '' });
      var rm = el('button', { type: 'button', class: 'benef__rm', 'aria-label': 'Remover pessoa', title: 'Remover', text: '×' });
      var row = el('div', { class: 'benef__row' }, [nome, par, dt, rm]);
      rm.addEventListener('click', function () { row.remove(); upd(); });
      [nome, par, dt].forEach(function (i) { i.addEventListener('input', function () { if (onChange) onChange(); }); });
      rows.appendChild(row);
      return nome;
    }
    (list || []).forEach(addRow);
    var add = el('button', { type: 'button', class: 'btn btn--ghost benef__add', text: '+ Adicionar pessoa' });
    add.addEventListener('click', function () { addRow({}).focus(); upd(); });
    container.appendChild(el('div', { class: 'benef__head' }, [el('strong', { text: 'Pessoas do plano' }), count]));
    container.appendChild(rows);
    container.appendChild(add);
    upd();
    return {
      get: function () {
        return Array.prototype.map.call(rows.children, function (r) {
          var i = r.querySelectorAll('input, select');
          return { nome: i[0].value.trim(), parentesco: i[1].value, aniversario: i[2].value };
        }).filter(function (b) { return b.nome || b.aniversario; });
      }
    };
  }

  function info(iso) {
    if (!iso) return null;
    var p = iso.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
    var t = new Date(); t.setHours(0, 0, 0, 0);
    function occ(year) { var dd = d; if (m === 1 && d === 29 && new Date(year, 1, 29).getMonth() !== 1) dd = 28; return new Date(year, m, dd); }
    var next = occ(t.getFullYear()); if (next < t) next = occ(t.getFullYear() + 1);
    return { days: Math.round((next - t) / 86400000), age: y > 1900 ? next.getFullYear() - y : null, label: String(d).padStart(2, '0') + '/' + String(m + 1).padStart(2, '0') };
  }
  function when(b) { return b.days === 0 ? 'hoje' : b.days === 1 ? 'amanhã' : 'em ' + b.days + ' dias (' + b.label + ')'; }

  /** Aniversários próximos de um registro (lead ou contrato): titular + beneficiários */
  function upcoming(rec, maxDays) {
    var out = [];
    var titular = { nome: rec.nome, parentesco: 'Titular', aniversario: rec.aniversario, titular: true };
    [titular].concat(rec.beneficiarios || []).forEach(function (p) {
      var b = info(p.aniversario);
      if (b && b.days <= maxDays) out.push({ rec: rec, pessoa: p, b: b });
    });
    return out;
  }

  function waUrl(rec, pessoa) {
    var d = String(rec.telefone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 11) d = '55' + d;
    var primeiro = String(rec.nome || '').split(' ')[0];
    var txt = pessoa.titular
      ? 'Feliz aniversário, ' + primeiro + '! 🎉 Desejo muita saúde, alegria e realizações. Um abraço da Carla Jansen, Futura Rio Corretora.'
      : 'Olá, ' + primeiro + '! Passando para desejar um feliz aniversário para ' + String(pessoa.nome || '').split(' ')[0] + '! 🎉 Muita saúde e alegria para toda a família. Um abraço da Carla Jansen, Futura Rio Corretora.';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(txt);
  }

  /** Faixa de aniversariantes */
  function banner(box, records, onOpen, titleSuffix) {
    var list = [];
    records.forEach(function (r) { list = list.concat(upcoming(r, 7)); });
    list.sort(function (a, b) { return a.b.days - b.b.days; });
    box.hidden = !list.length;
    box.textContent = '';
    if (!list.length) return;
    var hoje = list.filter(function (x) { return x.b.days === 0; }).length;
    box.appendChild(el('p', { class: 'bday__title', text: '🎂 ' + (hoje ? hoje + ' aniversariante(s) hoje' + (list.length > hoje ? ' · ' + (list.length - hoje) + ' nos próximos 7 dias' : '') : list.length + ' aniversário(s) nos próximos 7 dias') + (titleSuffix || '') }));
    var ul = el('ul');
    list.forEach(function (x) {
      var who = el('button', { type: 'button', class: 'who', text: x.pessoa.nome || x.rec.nome });
      who.addEventListener('click', function () { onOpen(x.rec); });
      var rel = x.pessoa.titular ? '' : ' · ' + (x.pessoa.parentesco ? x.pessoa.parentesco.toLowerCase() + ' de ' : 'do plano de ') + String(x.rec.nome).split(' ')[0];
      var url = waUrl(x.rec, x.pessoa);
      ul.appendChild(el('li', { class: x.b.days === 0 ? 'is-today' : '' }, [
        who, el('span', { class: 'when', text: when(x.b) + (x.b.age ? ' · ' + x.b.age + ' anos' : '') + rel }),
        url ? el('a', { class: 'btn btn--wa', href: url, target: '_blank', rel: 'noopener', text: 'Parabéns no WhatsApp' }) : null
      ]));
    });
    box.appendChild(ul);
  }

  window.FRBenef = { editor: editor, info: info, when: when, upcoming: upcoming, banner: banner };
})();
