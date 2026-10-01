// Pages légales : complète les informations de l'éditeur (nom, adresse,
// SIRET, email…) à partir des variables Vercel, lues via /api/config :
//   LEGAL_NAME, LEGAL_ADDRESS, LEGAL_SIRET, CONTACT_EMAIL,
//   LEGAL_VAT (facultatif), LEGAL_MEDIATOR (facultatif)
// Tant qu'une variable est vide, la page affiche « à compléter ».
// Les quotas affichés suivent aussi ceux réglés sur le site.
(function(){
  var URL_RE = /(https?:\/\/[^\s]+)/g;

  function fill(el, text, asMail){
    if (!text) return;
    el.classList.remove('todo');
    el.textContent = '';
    if (asMail){
      var a = document.createElement('a');
      a.href = 'mailto:' + text;
      a.textContent = text;
      el.appendChild(a);
      return;
    }
    // Les adresses web deviennent des liens (ex. site du médiateur).
    text.split(URL_RE).forEach(function(part){
      if (!part) return;
      if (/^https?:\/\//.test(part)){
        var link = document.createElement('a');
        link.href = part; link.rel = 'noopener'; link.target = '_blank';
        link.textContent = part;
        el.appendChild(link);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function vatText(legal){
    if (legal.vat) return 'N° de TVA intracommunautaire : ' + legal.vat;
    if (legal.siret) return 'TVA non applicable, article 293 B du Code général des impôts';
    return '';
  }

  fetch('/api/config', { cache: 'no-store' })
    .then(function(res){ return res.ok ? res.json() : null; })
    .then(function(cfg){
      if (!cfg) return;
      var legal = cfg.legal || {};
      document.querySelectorAll('[data-legal]').forEach(function(el){
        var key = el.getAttribute('data-legal');
        var value = key === 'vat' ? vatText(legal) : legal[key];
        fill(el, typeof value === 'string' ? value.trim() : '', key === 'email');
      });
      var lim = cfg.limits || {};
      document.querySelectorAll('[data-limit]').forEach(function(el){
        var n = lim[el.getAttribute('data-limit')];
        if (typeof n === 'number' && n > 0) el.textContent = String(n);
      });
    })
    .catch(function(){ /* la page reste lisible avec les valeurs par défaut */ });
})();
