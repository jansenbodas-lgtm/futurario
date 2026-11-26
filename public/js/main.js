/* Futura Rio — interações da landing page */
(function () {
  'use strict';

  /* ===== CONFIGURAÇÃO ===== */
  var WHATSAPP_NUMERO = '5521983799691'; // Carla Jansen — (21) 98379-9691
  var MENSAGEM = function (nome, plano) {
    return 'Olá, Carla! Meu nome é ' + nome + ' e vim pelo site da Futura Rio. ' +
      'Gostaria de uma cotação de plano' + (plano ? ' (' + plano + ')' : ' de saúde') + '.';
  };

  /* ===== UTMs / origem do tráfego (guardadas na sessão) ===== */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  function store(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* modo privado */ } }
  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  var params = new URLSearchParams(location.search);
  var hasUtm = UTM_KEYS.some(function (k) { return params.has(k); });
  if (hasUtm) {
    var u = {};
    UTM_KEYS.forEach(function (k) { if (params.get(k)) u[k] = params.get(k); });
    store('fr_utm', JSON.stringify(u));
  }
  if (!load('fr_ref') && document.referrer) store('fr_ref', document.referrer);

  function getUtm() {
    try { return JSON.parse(load('fr_utm') || '{}'); } catch (e) { return {}; }
  }

  /* ===== Máscara de telefone ===== */
  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  document.querySelectorAll('.js-phone').forEach(function (el) {
    el.addEventListener('input', function () { el.value = maskPhone(el.value); });
  });

  /* ===== Popup ===== */
  var modal = document.getElementById('lead-modal');
  var modalForm = modal && modal.querySelector('form');

  function openModal(origem, plano) {
    if (!modal) return;
    modalForm.dataset.origem = origem || 'popup-whatsapp';
    modalForm.elements.tipoPlano.value = plano || '';
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    setTimeout(function () { modalForm.elements.nome.focus(); }, 50);
    track('OpenLeadForm', { origem: origem });
  }
  function closeModal() {
    if (!modal) return;
    if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('.js-open-lead');
    if (t) { e.preventDefault(); openModal(t.dataset.origem, t.dataset.plano); return; }
    if (e.target.closest('.js-close-lead')) { closeModal(); return; }
    if (e.target === modal) closeModal(); // clique no fundo escuro
  });

  /* ===== Envio do lead ===== */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validate(form) {
    var f = form.elements;
    var errs = [];
    [f.nome, f.telefone, f.email].forEach(function (el) { el.classList.remove('invalid'); });
    if (f.nome.value.trim().length < 2) { errs.push('Informe seu nome.'); f.nome.classList.add('invalid'); }
    var digits = f.telefone.value.replace(/\D/g, '');
    if (digits.length < 10) { errs.push('Informe seu WhatsApp com DDD.'); f.telefone.classList.add('invalid'); }
    if (!EMAIL_RE.test(f.email.value.trim())) { errs.push('Informe um e-mail válido.'); f.email.classList.add('invalid'); }
    if (!f.consentimento.checked) errs.push('Marque a autorização de contato.');
    return errs;
  }

  /* Google Ads: busca o rótulo de conversão configurado no Cloudflare */
  var GADS = { id: 'AW-854308397', label: '' };
  try {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      if (c && c.gadsLabel) GADS.label = c.gadsLabel;
      if (c && c.gadsId) GADS.id = c.gadsId;
    }).catch(function () {});
  } catch (e) { /* sem rede */ }

  function track(evt, data) {
    try {
      if (evt === 'Lead') {
        if (window.fbq) window.fbq('track', 'Lead', data || {});
        if (window.gtag) {
          window.gtag('event', 'generate_lead', data || {});
          if (GADS.label) window.gtag('event', 'conversion', { send_to: GADS.id + '/' + GADS.label, transport_type: 'beacon' });
        }
      } else {
        if (window.fbq) window.fbq(evt === 'OpenLeadForm' ? 'track' : 'trackCustom', evt === 'OpenLeadForm' ? 'Contact' : evt, data || {});
        if (window.gtag) window.gtag('event', evt, data || {});
      }
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event: evt }, data || {}));
    } catch (e) { /* sem rastreamento configurado */ }
  }

  function whatsappUrl(nome, plano) {
    return 'https://wa.me/' + WHATSAPP_NUMERO + '?text=' + encodeURIComponent(MENSAGEM(nome, plano));
  }

  document.querySelectorAll('.js-lead-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      var btn = form.querySelector('button[type="submit"]');
      msg.className = 'form-msg';
      msg.textContent = '';

      var errs = validate(form);
      if (errs.length) { msg.textContent = errs.join(' '); return; }

      var f = form.elements;
      var nome = f.nome.value.trim();
      var plano = f.tipoPlano ? f.tipoPlano.value : '';
      var payload = {
        nome: nome,
        telefone: f.telefone.value.trim(),
        email: f.email.value.trim(),
        tipoPlano: plano,
        vidas: f.vidas ? f.vidas.value : '',
        consentimento: f.consentimento.checked,
        website: f.website ? f.website.value : '',
        origem: form.dataset.origem || 'site',
        utm: getUtm(),
        pagina: location.href,
        referrer: load('fr_ref') || document.referrer || ''
      };

      btn.disabled = true;
      var label = btn.querySelector('span');
      var original = label ? label.textContent : '';
      if (label) label.textContent = 'Enviando...';

      var controller = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, 8000);

      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.body.ok) throw new Error(res.body.error || 'Não foi possível enviar.');
          track('Lead', { content_name: plano || 'Plano de saúde', origem: payload.origem });
          msg.className = 'form-msg ok';
          msg.textContent = 'Pronto! Abrindo o WhatsApp...';
          setTimeout(function () { location.href = whatsappUrl(nome, plano); }, window.gtag ? 700 : 400);
        })
        .catch(function (err) {
          clearTimeout(timer);
          // Se for um erro de validação do servidor, mostra; se for falha de rede, segue para o WhatsApp
          if (err && err.name !== 'AbortError' && err.message && !/fetch|network|Failed/i.test(err.message)) {
            msg.textContent = err.message;
            btn.disabled = false;
            if (label) label.textContent = original;
            return;
          }
          location.href = whatsappUrl(nome, plano);
        });
    });
  });

  /* Depoimentos: mostrar todos */
  document.querySelectorAll('.js-more-reviews').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = document.querySelector('.js-testimonials');
      if (t) t.classList.add('is-open');
    });
  });

  /* Ano no rodapé */
  document.querySelectorAll('.js-year').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
