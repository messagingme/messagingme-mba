// Commun aux pages de la vitrine : l'en-tête collant et le menu « Fonctionnalités ». Puis, page par page, ce qui ne
// sert qu'à une page (chaque bloc ne fait rien si la page n'a pas l'élément qu'il vise).
(function () {
  // L'en-tête prend son fond dès que la sentinelle du haut de page sort de l'écran (jamais d'écouteur de défilement).
  var barre = document.querySelector('.barre'), sentinelle = document.querySelector('.sentinelle');
  if (barre && sentinelle) {
    if (!('IntersectionObserver' in window)) barre.classList.add('defile');
    else new IntersectionObserver(function (e) { barre.classList.toggle('defile', !e[0].isIntersecting); }).observe(sentinelle);
  }
  // Le menu est un <details> : il s'ouvre et se ferme sans script, au clavier compris. Ceci le referme seulement
  // au clic hors du menu, et à Échap en rendant le focus à son bouton.
  var menus = [].slice.call(document.querySelectorAll('details.menu, details.burger'));
  document.addEventListener('click', function (e) {
    var lien = e.target.closest && e.target.closest('a[href]');
    menus.forEach(function (m) { if (m.open && (!m.contains(e.target) || lien)) m.open = false; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    menus.forEach(function (m) { if (m.open) { m.open = false; m.querySelector('summary').focus(); } });
  });
})();

// La 404 sert toutes les adresses : sous /en/, elle montre son texte anglais (qui porte son propre lang="en" : l'en-tête
// et le pied, eux, restent français) et son titre anglais.
(function () {
  var en = document.querySelector('[data-langue="en"]'), fr = document.querySelector('[data-langue="fr"]');
  if (!en || !fr || location.pathname.indexOf('/en/') !== 0) return;
  fr.hidden = true; en.hidden = false;
  document.title = 'Page not found · Messaging Me';
})();

// Pages fonctionnalités. Chaque bloc ne fait rien si la page n'a pas l'élément qu'il vise.
(function () {
  // Au téléphone, un film qui a une version verticale (data-vertical) la prend, avec son affiche. Même seuil que
  // la règle « .js .f-video[data-vertical] » de site.css, qui donne au cadre sa forme dès le premier affichage.
  if (matchMedia('(max-width: 640px)').matches) {
    document.querySelectorAll('.f-video[data-vertical]').forEach(function (v) {
      v.src = v.dataset.vertical; v.poster = v.dataset.afficheVerticale;
    });
  }

  if (!('IntersectionObserver' in window)) return;
  var calme = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Le film part, muet, quand il est à moitié à l'écran, et s'arrête quand il en sort. Pour qui a demandé moins
  // de mouvement, rien ne démarre seul : les commandes restent là. Sauf un film du centre d'aide (`.aide-film`) : une
  // page qu'on rouvre souvent ne recharge pas quatre ou cinq mégaoctets à chaque visite, on le lance soi-même.
  document.querySelectorAll('.f-video:not(.aide-film)').forEach(function (v) {
    if (calme) return;
    new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { v.muted = true; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      else if (!v.paused) v.pause();
    }, { threshold: 0.5 }).observe(v);
  });

  // Les vignettes de la page chapeau : le film du cas joue au survol, s'arrête à la sortie.
  document.querySelectorAll('.hub-carte').forEach(function (a) {
    var v = a.querySelector('.hub-mini');
    if (!v || calme) return;
    a.addEventListener('mouseenter', function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
    a.addEventListener('mouseleave', function () { v.pause(); });
  });

  // L'écran collant suit l'étape la plus proche du milieu de la fenêtre. On la RECALCULE à chaque signal plutôt
  // que de suivre le franchissement d'une ligne : un saut (ancre, retour en haut) ne laisse pas d'état périmé.
  document.querySelectorAll('.f-pas').forEach(function (bloc) {
    var etapes = [].slice.call(bloc.querySelectorAll('.f-etape')), images = [].slice.call(bloc.querySelectorAll('.f-ecran img'));
    var courant = 0;
    var choisir = function () {
      var milieu = window.innerHeight / 2, meilleur = 0, ecart = Infinity;
      etapes.forEach(function (li, k) {
        var r = li.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - milieu);
        if (d < ecart) { ecart = d; meilleur = k; }
      });
      if (meilleur === courant) return;
      courant = meilleur;
      etapes.forEach(function (li, k) { li.classList.toggle('actif', k === courant); });
      images.forEach(function (img, k) { img.classList.toggle('actif', k === courant); });
    };
    var seuils = [];
    for (var s = 0; s <= 20; s++) seuils.push(s / 20);
    var io = new IntersectionObserver(choisir, { threshold: seuils });
    etapes.forEach(function (li) { io.observe(li); });
  });

  // Les marches de l'entonnoir et le nombre de la page Chaînes s'animent une fois, à leur arrivée.
  var revele = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('vu'); revele.unobserve(e.target); } });
  }, { threshold: 0.35 });
  document.querySelectorAll('.f-revele').forEach(function (el) { revele.observe(el); });
})();

// Page développeurs (lot 18) : le bouton « Copier » de la commande, et le terminal qui rejoue sa séance en boucle,
// SEULEMENT quand il est à l'écran. Le minutage des lignes est dans leur `--t`. Rien ne tourne pour qui a demandé
// moins de mouvement : la séance y reste affichée, finie.
(function () {
  // Le bouton ne se montre que si le navigateur sait copier ; le résultat, réussi ou non, est dit au bouton et à la
  // zone de statut qui le suit, pour un lecteur d'écran.
  document.querySelectorAll('.dev-copier').forEach(function (b) {
    var cible = document.getElementById(b.getAttribute('aria-controls')), libelle = b.textContent;
    var statut = b.nextElementSibling && b.nextElementSibling.classList.contains('dev-statut') ? b.nextElementSibling : null;
    if (!cible || !navigator.clipboard) return;
    b.classList.add('pret');
    var dire = function (texte) {
      b.textContent = texte;
      if (statut) statut.textContent = texte;
      setTimeout(function () { b.textContent = libelle; if (statut) statut.textContent = ''; }, 2000);
    };
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(cible.textContent.trim()).then(function () { dire(b.dataset.copie); }, function () { dire(b.dataset.echec); });
    });
  });

  // Le terminal défile comme un vrai : chaque entrée apparaît à son `--t`, et la fenêtre suit la dernière ligne.
  // Sans IntersectionObserver, ou pour qui a demandé moins de mouvement, la séance est affichée finie, la fenêtre
  // descendue sur sa fin (la balise de la bulle).
  var t = document.querySelector('.dev-terminal');
  if (!t) return;
  var fil = t.querySelector('.cc-fil'), entrees = [].slice.call(t.querySelectorAll('.dev-seance > li'));
  var enBas = function (doux) { if (fil) fil.scrollTo({ top: fil.scrollHeight, behavior: doux ? 'smooth' : 'auto' }); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    t.classList.add('statique'); enBas(false); return;
  }
  var quand = function (li) { return (parseFloat(li.style.getPropertyValue('--t')) || 0) * 1000; };
  var fin = Math.max.apply(null, entrees.map(quand));
  var minuteries = [], actif = false;
  function arreter() { minuteries.forEach(clearTimeout); minuteries = []; }
  function tour() {
    arreter();
    t.classList.remove('sortie', 'fini');
    entrees.forEach(function (li) { li.classList.remove('vu'); });
    t.classList.add('joue');
    enBas(false);
    entrees.forEach(function (li) {
      minuteries.push(setTimeout(function () { li.classList.add('vu'); enBas(true); }, quand(li)));
    });
    minuteries.push(setTimeout(function () { t.classList.add('fini'); }, fin + 400));
    minuteries.push(setTimeout(function () { t.classList.add('sortie'); }, fin + 4600));
    minuteries.push(setTimeout(tour, fin + 5200));
  }
  new IntersectionObserver(function (e) {
    if (e[0].isIntersecting && !actif) { actif = true; tour(); }
    else if (!e[0].isIntersecting && actif) { actif = false; arreter(); }
  }, { threshold: 0.25 }).observe(t);
})();

// Page contact. Le formulaire part SANS script (formulaire HTML natif, l'API répond par une redirection) ; ceci
// ajoute seulement le message d'erreur au retour, le brouillon gardé le temps de l'onglet, et le bouton désactivé
// pendant l'envoi. Le stockage peut être refusé (navigation privée) : tout est dans des try.
(function () {
  // Un brouillon PAR formulaire : le contact et le livre blanc ont des champs du même nom (`nom`, `email`) qui ne
  // veulent pas dire la même chose (« Nom et prénom » d'un côté, le nom de famille de l'autre).
  var CLES = ['engageme-contact', 'engageme-livre-blanc'];
  if (document.querySelector('.c-merci')) { try { CLES.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {} return; }
  var form = document.querySelector('form.c-form');
  if (!form) return;
  var CLE = /\/vitrine\/livre-blanc$/.test(form.getAttribute('action') || '') ? CLES[1] : CLES[0];
  var champs = [].slice.call(form.querySelectorAll('input[name]:not([name="site"]), textarea[name]'));
  // Une case se garde par `checked`, jamais par sa valeur (toujours « oui ») : sinon un retour en erreur la décoche,
  // et le visiteur qui avait accepté WhatsApp repart sans, sans le voir.
  try {
    var brouillon = JSON.parse(sessionStorage.getItem(CLE) || '{}');
    champs.forEach(function (c) {
      if (c.type === 'checkbox') { if (typeof brouillon[c.name] === 'boolean') c.checked = brouillon[c.name]; }
      else if (typeof brouillon[c.name] === 'string' && !c.value) c.value = brouillon[c.name];
    });
  } catch (e) {}
  // Venu d'un bouton « Demander une démo » : le message est pré-rempli avec la fonctionnalité, si rien n'est déjà
  // écrit. Seules les quatre pages connues : aucun texte n'est recopié de l'adresse. La page anglaise
  // (`<html lang="en">`) a ses phrases ; les clés restent les adresses françaises, que ses liens gardent.
  var EN = document.documentElement.lang === 'en';
  var DEMOS = EN ? {
    'campagnes-et-scenarios': 'Campaigns and scenarios',
    'publicites-click-to-whatsapp': 'Click-to-WhatsApp ads',
    'chaines-whatsapp': 'WhatsApp Channels',
    'conversations-en-actions': 'Conversation analysis',
    'whatsapp-et-rcs': 'WhatsApp and RCS',
    'pilotage-des-couts': 'Cost control'
  } : {
    'campagnes-et-scenarios': 'Campagnes et scénarios',
    'publicites-click-to-whatsapp': 'Publicités Click-to-WhatsApp',
    'chaines-whatsapp': 'Chaînes WhatsApp',
    'conversations-en-actions': 'Analyse de conversations',
    'whatsapp-et-rcs': 'WhatsApp et RCS',
    'pilotage-des-couts': 'Pilotage des coûts'
  };
  var demo = DEMOS[new URLSearchParams(location.search).get('demo')];
  var message = form.querySelector('textarea[name="message"]');
  if (demo && message && !message.value) message.value = EN ? 'Hello, I would like a demo of Messaging Me: ' + demo + '.' : 'Bonjour, je souhaite une démo de Messaging Me : ' + demo + '.';
  // Venu du centre d'aide (« Une question sans réponse ? ») : le message cite l'adresse de la page. Seul un NOM de page
  // passe (lettres, chiffres, tirets), jamais un texte libre recopié de l'adresse, comme pour les démos.
  var aide = new URLSearchParams(location.search).get('aide');
  if (aide && /^[a-z0-9-]{1,80}$/.test(aide) && message && !message.value) {
    message.value = EN
      ? 'Hello, I have a question about the help page ' + location.origin + '/en/help/' + aide + '/: '
      : 'Bonjour, j’ai une question sur la page d’aide ' + location.origin + '/aide/' + aide + '/ : ';
  }
  form.addEventListener('input', function () {
    var b = {};
    champs.forEach(function (c) { b[c.name] = c.type === 'checkbox' ? c.checked : c.value; });
    try { sessionStorage.setItem(CLE, JSON.stringify(b)); } catch (e) {}
  });

  var MESSAGES = EN ? {
    champs: 'A field is missing or invalid. Check the form, then send it again.',
    trop: 'Lots of messages right now: try again in a few minutes, or write to us at ',
    envoi: 'Your message could not be sent. Try again, or write to us at '
  } : {
    champs: 'Un champ manque ou n’est pas valide. Vérifiez le formulaire, puis renvoyez-le.',
    trop: 'Beaucoup de messages en ce moment : réessayez dans quelques minutes, ou écrivez-nous à ',
    envoi: 'Votre message n’a pas pu partir. Réessayez, ou écrivez-nous à '
  };
  var code = new URLSearchParams(location.search).get('erreur');
  var zone = form.querySelector('.c-erreur');
  if (zone && MESSAGES[code]) {
    zone.textContent = MESSAGES[code];
    if (code !== 'champs') {
      var a = document.createElement('a');
      a.href = 'mailto:contact@messagingme.fr';
      a.textContent = 'contact@messagingme.fr';
      zone.appendChild(a);
      zone.appendChild(document.createTextNode('.'));
    }
    zone.hidden = false;
  }

  // Un seul envoi par clic ; le bouton revient si la page est rouverte par le bouton « Retour » du navigateur.
  var bouton = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function () { setTimeout(function () { bouton.disabled = true; }, 0); });
  window.addEventListener('pageshow', function () { bouton.disabled = false; });
})();

// Centre d'aide : le filtre du menu. La saisie passe par la même normalisation que les mots de chaque entrée
// (`motsDeRecherche`, scripts/vitrine/aide.ts) : minuscules, sans accents, sans ponctuation. Une rubrique vide se masque.
// Sur l'accueil, la même recherche filtre les cartes : le carrousel s'efface pendant qu'on cherche, et une phrase dit
// quand plus rien ne correspond.
(function () {
  var champ = document.querySelector('.aide-recherche');
  if (!champ) return;
  var normaliser = function (t) {
    // Les accents décomposés par NFD (U+0300 à U+036F), sans `\p{M}` : un navigateur sans échappement de propriété
    // Unicode refuserait d'analyser TOUT site.js, et chaque page perdrait ses scripts (relecture du lot 3).
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  };
  var rubriques = [].slice.call(document.querySelectorAll('.aide-rubrique'));
  var videos = document.querySelector('.aide-videos');
  var aucun = document.querySelector('.aide-aucun');
  champ.addEventListener('input', function () {
    var mots = normaliser(champ.value).split(' ').filter(Boolean);
    var total = 0;
    rubriques.forEach(function (r) {
      var visibles = 0;
      [].slice.call(r.querySelectorAll('[data-mots]')).forEach(function (a) {
        var dedans = a.getAttribute('data-mots');
        var garde = mots.every(function (m) { return dedans.indexOf(m) >= 0; });
        a.hidden = !garde;
        if (garde) visibles++;
      });
      r.hidden = visibles === 0;
      total += visibles;
    });
    if (videos) videos.hidden = mots.length > 0;
    if (aucun) aucun.hidden = total > 0;
  });
})();

// Accueil du centre d'aide : la barre latérale. Choisir une section garde son ancre (la page défile jusqu'à elle) et
// déplie la liste de ses guides en repliant les autres ; une adresse arrivée avec une ancre déplie la sienne.
(function () {
  var liens = [].slice.call(document.querySelectorAll('.aide-sections .aide-section-lien'));
  if (!liens.length) return;
  var ouvrir = function (ancre) {
    liens.forEach(function (a) {
      var section = a.parentNode.classList.contains('aide-section') ? a.parentNode : null;
      if (!section) return;
      var ouverte = a.getAttribute('href') === ancre;
      section.classList.toggle('ouverte', ouverte);
      a.setAttribute('aria-expanded', String(ouverte));
    });
  };
  liens.forEach(function (a) { a.addEventListener('click', function () { ouvrir(a.getAttribute('href')); }); });
  window.addEventListener('hashchange', function () { ouvrir(location.hash); });
  ouvrir(location.hash);
})();

// Accueil du centre d'aide : le carrousel des films. Les boutons avancent d'un film, s'éteignent aux deux bouts ; un
// seul film joue à la fois, et celui qui sort de l'écran s'arrête.
(function () {
  var piste = document.querySelector('.aide-carrousel');
  if (!piste) return;
  var boutons = [].slice.call(document.querySelectorAll('.aide-carrousel-bouton'));
  var pas = function () {
    var diapo = piste.querySelector('.aide-diapo');
    return diapo ? diapo.getBoundingClientRect().width + (parseFloat(getComputedStyle(piste).columnGap) || 0) : piste.clientWidth;
  };
  var bornes = function () {
    boutons.forEach(function (b) {
      b.disabled = b.getAttribute('data-sens') === '-1'
        ? piste.scrollLeft <= 1
        : piste.scrollLeft + piste.clientWidth >= piste.scrollWidth - 1;
    });
  };
  boutons.forEach(function (b) {
    b.addEventListener('click', function () {
      piste.scrollBy({ left: Number(b.getAttribute('data-sens')) * pas(), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });
  piste.addEventListener('scroll', bornes, { passive: true });
  window.addEventListener('resize', bornes);
  bornes();
  var films = [].slice.call(piste.querySelectorAll('video'));
  films.forEach(function (v) {
    v.addEventListener('play', function () { films.forEach(function (f) { if (f !== v && !f.paused) f.pause(); }); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { if (!e[0].isIntersecting && !v.paused) v.pause(); }, { threshold: 0.3 }).observe(v);
    }
  });
})();

// Le dépannage du numéro (lot 4a de l'aide à la connexion) : « Claude Code ou Codex, ou la console ? » ne laisse que les
// symptômes du lieu choisi (`data-ou-pour`, la règle de `site.css`), « Tout voir » les rend tous, et le compte s'annonce.
// Sans script, le filtre reste caché et la liste entière se lit.
(function () {
  [].slice.call(document.querySelectorAll('[data-depannage]')).forEach(function (d) {
    var filtre = d.querySelector('[data-filtre]');
    if (!filtre) return;
    filtre.hidden = false;
    var choix = [].slice.call(filtre.querySelectorAll('[data-ou-choix]'));
    var compte = filtre.querySelector('[data-compte]');
    var symptomes = [].slice.call(d.querySelectorAll('[data-ou-pour]'));
    choix.forEach(function (b) {
      b.addEventListener('click', function () {
        var ou = b.getAttribute('data-ou-choix');
        if (ou) d.setAttribute('data-ou', ou); else d.removeAttribute('data-ou');
        choix.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var n = symptomes.filter(function (s) { return !ou || (' ' + s.getAttribute('data-ou-pour') + ' ').indexOf(' ' + ou + ' ') >= 0; }).length;
        if (compte) compte.textContent = compte.getAttribute('data-compte').replace('{n}', n).replace('{total}', symptomes.length);
      });
    });
  });
})();

// Le tunnel du numéro WhatsApp (la page « Démarrer », Boutiques Shopify, SaaS) : l'arbre de Julien (2026-10-30). Sans script,
// les questions restent cachées et toutes les issues se lisent en liste, chacune avec la situation qu'elle sert et les
// boutons de chaque offre. Avec lui, la question en cours s'affiche en grand sous l'étape et sa jauge ; chaque réponse
// (`data-vers`, ou la carte qui la porte) reste affichée, mise en évidence, et la suivante ou une issue apparaît plus bas
// (Julien, 2026-10-30 : « on garde le carré sélectionné et on passe à la question suivante plus bas ») ; une autre réponse
// cliquée sur une question déjà répondue efface tout ce qui la suivait et ouvre son chemin ; la réponse qui choisit
// l'offre (`data-offre`) ne laisse aux issues que les boutons de cette offre ; une réponse sans `data-vers` (« Je ne sais
// pas ») déplie l'aide de sa question ; « Copier » met la demande à coller dans Claude Code dans le presse-papiers ; un lien d'issue
// (`data-vers-chemin`) montre une autre issue ; `?offre=` dans l'adresse (free, pro, business, entreprise : les offres de la page Tarifs)
// répond à la première question à l'ouverture, sans prendre le focus ; sur le bureau, les flèches (`data-defiler`) font défiler
// le carrousel des formules.
(function () {
  [].slice.call(document.querySelectorAll('[data-guide-numero]')).forEach(function (g) {
    var questions = g.querySelector('.bt-questions');
    var recommencer = g.querySelector('[data-recommencer]');
    var premiere = g.querySelector('[data-question]');
    var chemins = [].slice.call(g.querySelectorAll('.bt-chemin'));
    var progression = g.querySelector('[data-progression]');
    if (!questions || !recommencer || !premiere) return;
    var parcours = [premiere];
    // Le tunnel : « Question n », sa jauge sur le plus long parcours (`data-max`, calculé depuis l'arbre), l'issue en
    // dernière étape ; puis « Votre chemin » et la jauge pleine.
    var avancer = function (fin) {
      if (!progression) return;
      var max = Number(progression.getAttribute('data-max')) || 1;
      progression.hidden = false;
      progression.querySelector('[data-etape]').textContent = fin
        ? progression.getAttribute('data-fin')
        : progression.getAttribute('data-progression').replace('{n}', String(parcours.length));
      progression.querySelector('[data-jauge]').style.width = (fin ? 100 : Math.min(parcours.length, max) / (max + 1) * 100) + '%';
    };
    var montrer = function (cle) {
      chemins.forEach(function (c) { c.classList.toggle('actif', c.getAttribute('data-chemin') === cle); });
    };
    var effacer = function (q) {
      q.classList.remove('repondue');
      // La question de l'offre effacée : plus d'offre choisie, les issues retrouvent les boutons des deux.
      if (q.querySelector('[data-offre]')) g.removeAttribute('data-offre');
      [].slice.call(q.querySelectorAll('[data-vers]')).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      var aide = q.querySelector('.bt-aide');
      var bouton = q.querySelector('[data-aide]');
      if (aide) aide.hidden = true;
      if (bouton) bouton.setAttribute('aria-expanded', 'false');
      [].slice.call(q.querySelectorAll('.bt-note-reponse')).forEach(function (n) { n.hidden = true; });
    };
    // Retire du parcours tout ce qui suit la question `q` : une réponse changée plus haut ouvre une autre branche.
    var couper = function (q) {
      parcours.splice(parcours.indexOf(q) + 1).forEach(function (x) { x.hidden = true; effacer(x); });
      montrer(null);
    };
    questions.hidden = false;
    g.setAttribute('data-pret', '');
    avancer(false);
    // « Copier » n'a de sens qu'avec le script : sans lui, la demande se sélectionne à la main.
    [].slice.call(g.querySelectorAll('[data-copier]')).forEach(function (b) { b.hidden = false; });
    var selectionner = function (cible) {
      var plage = document.createRange();
      plage.selectNodeContents(cible);
      var choix = window.getSelection();
      choix.removeAllRanges();
      choix.addRange(plage);
    };
    var doux = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Le premier arrêt du focus dans une issue, quelle que soit l'offre : son titre (`tabindex="-1"`). Un lecteur d'écran
    // l'annonce, puis lit l'issue depuis le début (ce qu'elle dit, puis les étapes ou les boutons de l'offre choisie) ; au
    // clavier, la touche Tab mène ensuite à ses liens et boutons, dans l'ordre.
    var premierArret = function (issue) { return issue && issue.querySelector('h3[tabindex]'); };
    // Une réponse donnée : sa question reste affichée, la réponse en évidence, et la suivante (ou l'issue) apparaît
    // dessous. `focus` vaut faux à l'ouverture de la page, quand l'adresse choisit l'offre : le focus et le défilement
    // restent au visiteur.
    var repondre = function (b, q, focus) {
      var vers = b.getAttribute('data-vers');
      couper(q);
      [].slice.call(q.querySelectorAll('[data-vers]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      // Une réponse peut porter une note (où vérifier son compte Meta Business) : seule la sienne s'affiche.
      [].slice.call(q.querySelectorAll('.bt-note-reponse')).forEach(function (n) { n.hidden = n.id !== b.getAttribute('data-note'); });
      if (b.hasAttribute('data-offre')) g.setAttribute('data-offre', b.getAttribute('data-offre'));
      q.classList.add('repondue');
      // Dans le carrousel, la carte choisie se met en vue (une formule choisie par l'adresse peut être hors champ).
      var choisieCarte = b.closest('.bt-carrousel .bt-voie-choix');
      var rangeeChoix = choisieCarte && choisieCarte.parentNode;
      if (rangeeChoix && (choisieCarte.offsetLeft < rangeeChoix.scrollLeft
        || choisieCarte.offsetLeft + choisieCarte.offsetWidth > rangeeChoix.scrollLeft + rangeeChoix.clientWidth)) {
        rangeeChoix.scrollTo({ left: choisieCarte.offsetLeft, behavior: focus && doux ? 'smooth' : 'auto' });
      }
      var aideOuverte = q.querySelector('.bt-aide');
      if (aideOuverte) aideOuverte.hidden = true;
      recommencer.hidden = false;
      var suivante = g.querySelector('[data-question="' + vers + '"]');
      if (suivante) {
        // Une question partagée par deux branches suit celle qui y mène : on l'affiche à la suite du parcours, avant
        // « Recommencer », quel que soit son rang dans la page.
        questions.insertBefore(suivante, recommencer);
        suivante.hidden = false;
        parcours.push(suivante);
        avancer(false);
        // La question suivante apparaît plus bas : le focus va à sa première réponse, qu'un lecteur d'écran l'entende, et
        // elle glisse en vue.
        if (!focus) return;
        suivante.querySelector('[data-vers]').focus({ preventScroll: true });
        suivante.scrollIntoView({ block: 'center', behavior: doux ? 'smooth' : 'auto' });
      } else {
        montrer(vers);
        avancer(true);
        if (!focus) return;
        // L'issue est la fin du tunnel : le focus va à son titre (`premierArret`), et elle se montre en entier.
        var issue = g.querySelector('[data-chemin="' + vers + '"]');
        var arret = premierArret(issue);
        if (arret) arret.focus({ preventScroll: true });
        if (issue) issue.scrollIntoView({ block: 'nearest', behavior: doux ? 'smooth' : 'auto' });
      }
    };
    g.addEventListener('click', function (e) {
      var copier = e.target.closest && e.target.closest('[data-copier]');
      if (copier) {
        var demande = document.getElementById(copier.getAttribute('data-copier'));
        if (!demande) return;
        var copie = function () { copier.textContent = copier.getAttribute('data-copie'); };
        // Sans presse-papiers (page non sécurisée, refus du navigateur), la demande se sélectionne : un Ctrl+C suffit.
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(demande.textContent).then(copie, function () { selectionner(demande); });
        } else {
          selectionner(demande);
        }
        return;
      }
      // Les flèches du carrousel des formules (bureau) : une carte de plus ou de moins.
      var defiler = e.target.closest && e.target.closest('[data-defiler]');
      if (defiler) {
        var rangee = defiler.closest('[data-question]').querySelector('.bt-carrousel');
        var une = rangee && rangee.querySelector('.bt-voie-choix');
        if (une) rangee.scrollBy({ left: Number(defiler.getAttribute('data-defiler')) * (une.getBoundingClientRect().width + 16), behavior: doux ? 'smooth' : 'auto' });
        return;
      }
      var aide = e.target.closest && e.target.closest('[data-aide]');
      if (aide) {
        var texte = aide.closest('[data-question]').querySelector('.bt-aide');
        if (texte) texte.hidden = !texte.hidden;
        aide.setAttribute('aria-expanded', String(Boolean(texte) && !texte.hidden));
        return;
      }
      // Un lien de la carte (« Pourquoi un moyen de paiement ? ») s'ouvre dans un autre onglet sans la choisir (jaune 1 de
      // la relecture du lot 3a) : sans ce retour, le clic la choisissait puis quittait la page.
      if (e.target.closest && e.target.closest('.bt-voie-liens a[href]')) return;
      // Une carte se choisit d'un clic n'importe où sur elle, comme son bouton (le texte reste sélectionnable au clavier).
      var carte = e.target.closest && e.target.closest('.bt-voie-choix');
      var b = (e.target.closest && e.target.closest('[data-vers]')) || (carte && carte.querySelector('[data-vers]'));
      if (b) {
        var q = b.closest('[data-question]');
        // La réponse déjà choisie ne refait rien ; une autre change le chemin à partir de cette question.
        if (b.getAttribute('aria-pressed') !== 'true') repondre(b, q, true);
        return;
      }
      // Un lien d'issue vers une autre (« Vous pouvez le garder ») : l'autre issue prend sa place, son titre le focus.
      var lien = e.target.closest && e.target.closest('[data-vers-chemin]');
      if (lien) {
        e.preventDefault();
        var cle = lien.getAttribute('data-vers-chemin');
        montrer(cle);
        var autre = g.querySelector('[data-chemin="' + cle + '"]');
        var premier = premierArret(autre);
        if (premier) premier.focus({ preventScroll: true });
        if (autre) autre.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.target.closest && e.target.closest('[data-recommencer]')) {
        couper(premiere);
        effacer(premiere);
        recommencer.hidden = true;
        avancer(false);
        // « Recommencer » se cache : le focus revient à la première question plutôt que de se perdre.
        premiere.querySelector('[data-vers]').focus();
      }
    });
    var offre = (location.search.match(/[?&]offre=(free|pro|business|entreprise)(?:&|$)/) || [])[1];
    var choisie = offre && premiere.querySelector('[data-vers][data-offre="' + offre + '"]');
    if (choisie) repondre(choisie, premiere, false);
  });
})();

// Les cookies de la vitrine : deux usages, chacun seulement avec l'accord du visiteur, et rien avant (ni script ni cookie).
// - `mesure` : Google Analytics 4, la propriété de www.messagingme.fr (plan docs/superpowers/plans/2026-11-06-ga4-vitrine.md).
//   Ses cookies `_ga*` sont posés sur messagingme.fr : www et app y lisent le même visiteur. Aucune fonction publicitaire.
//   Trois événements, que Julien marque « clés » dans GA4 : `clic_console`, `contact_envoye`, `interet_developpeur`.
// - `pub` : le pixel de Meta (spec docs/superpowers/specs/2026-10-30-pixel-meta-design.md). Il n'envoie que `PageView` :
//   les segments se font chez Meta, par l'adresse de la page, et les conversions partent de notre serveur. Après accord, un
//   clic vers la console lui passe `fbc` et `fbp` dans l'adresse, pour que Meta relie une inscription au clic sur sa
//   publicité. Rien du `fbclid` n'est gardé avant l'accord : un visiteur qui accepte sur sa deuxième page perd
//   l'attribution de son clic.
// La bannière propose « Tout refuser » et « Tout accepter », du même poids, et « Personnaliser », qui montre une case par
// usage : la CNIL exige qu'on puisse accepter l'un et refuser l'autre (choix de Julien du 2026-11-06). Le choix est retenu
// six mois, puis redemandé ; « Gérer les cookies » du pied rouvre la bannière. Un choix gardé avant la mesure
// (`{ choix, le }`, le pixel seul) vaut encore pour le pixel, et la bannière revient poser la question de la mesure,
// usage nouveau. Le stockage peut être refusé (navigation privée) : tout est dans des try, et la bannière revient alors à
// chaque page. `tests/vitrine-cookies.test.ts` exécute ce bloc sur un faux document.
(function () {
  // Les identifiants, publics par nature (la vitrine n'a aucune variable).
  var PIXEL = '430064039366684', GA = 'G-F4KVJ1Z8MR';
  var pied = document.querySelector('[data-cookies]');
  var CLE = 'mm-consentement', DUREE = 183 * 864e5, CONSOLE = 'console.messagingme.app';
  var EN = document.documentElement.lang === 'en' || location.pathname.indexOf('/en/') === 0;
  var T = EN ? {
    texte: 'With your consent, we use two tools that set cookies: Google Analytics, to measure this site’s audience, and the Meta (Facebook) pixel, which tells Meta which pages you visit here, to measure our ads, show them to you and to people with a similar profile. You can change your mind at any time with “Manage cookies” at the bottom of every page.',
    politique: 'Cookie policy', lien: 'https://www.messagingme.fr/en/politique-de-cookies-ue-messaging-me/',
    refuser: 'Decline all', accepter: 'Accept all', personnaliser: 'Customize', enregistrer: 'Save my choices',
    usages: [
      ['mesure', 'Audience measurement:', 'Google Analytics counts the visits and pages viewed on this site.'],
      ['pub', 'Advertising:', 'the Meta pixel measures our ads and lets us show them to you.']
    ]
  } : {
    texte: 'Avec votre accord, nous utilisons deux outils qui déposent des cookies : Google Analytics, pour mesurer l’audience de ce site, et le pixel de Meta (Facebook), qui transmet à Meta les pages que vous visitez ici, pour mesurer nos publicités, vous les montrer et les montrer à des personnes au profil proche. Vous pouvez changer d’avis à tout moment par « Gérer les cookies », en bas de chaque page.',
    politique: 'Politique de cookies', lien: 'https://www.messagingme.fr/politique-de-cookies-ue-messaging-me/',
    refuser: 'Tout refuser', accepter: 'Tout accepter', personnaliser: 'Personnaliser', enregistrer: 'Enregistrer mes choix',
    usages: [
      ['mesure', 'Mesure d’audience :', 'Google Analytics compte les visites et les pages vues de ce site.'],
      ['pub', 'Publicité :', 'le pixel de Meta mesure nos publicités et nous permet de vous les montrer.']
    ]
  };
  // Le choix gardé : `{ mesure, pub, complet }`, ou null s'il n'y en a pas, s'il a plus de six mois ou s'il est illisible.
  // `complet` faux : un choix d'avant la mesure, qui ne disait rien d'elle.
  var lire = function () {
    try {
      var c = JSON.parse(localStorage.getItem(CLE) || 'null');
      if (!c || !(Date.now() - Date.parse(c.le) < DUREE)) return null;
      if (typeof c.mesure === 'boolean' && typeof c.pub === 'boolean') return { mesure: c.mesure, pub: c.pub, complet: true };
      if (c.choix === 'accepte' || c.choix === 'refuse') return { mesure: false, pub: c.choix === 'accepte', complet: false };
    } catch (e) {}
    return null;
  };
  var ecrire = function (choix) {
    try { localStorage.setItem(CLE, JSON.stringify({ mesure: choix.mesure, pub: choix.pub, le: new Date().toISOString() })); } catch (e) {}
  };
  var cookie = function (nom) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + nom + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  var effacer = function (garder) {
    var domaine = location.hostname.split('.').slice(-2).join('.');
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (!garder(n)) return;
      document.cookie = n + '=; Max-Age=0; path=/';
      document.cookie = n + '=; Max-Age=0; path=/; domain=.' + domaine;
    });
  };
  // Ce qui tourne sur cette page.
  var actif = { mesure: false, pub: false };

  // La mesure. La file de gtag reçoit `arguments` tel quel, la forme que gtag.js lit en arrivant.
  var gtag = function () { (window.dataLayer = window.dataLayer || []).push(arguments); };
  var gaCharge = false;
  var evenement = function (nom, details) { if (actif.mesure) gtag('event', nom, details || {}); };
  var chargerMesure = function () {
    actif.mesure = true;
    window['ga-disable-' + GA] = false;
    if (gaCharge) { gtag('consent', 'update', { analytics_storage: 'granted' }); return; }
    gaCharge = true;
    // Aucune fonction publicitaire de Google (pas de Google Ads, décision du 2026-11-06) : le jour où il y en a une, la
    // bannière demande d'abord cet accord-là.
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    gtag('js', new Date());
    gtag('config', GA, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA;
    document.head.appendChild(s);
    if (document.querySelector('.c-merci')) evenement('contact_envoye');
  };
  // Le retrait d'un accord DONNÉ ICI : le script chargé se tait, ses cookies s'effacent. Un refus sans accord préalable ne
  // touche pas aux `_ga` : posés sur messagingme.fr, ils peuvent venir de l'accord donné sur www.
  var couperMesure = function () {
    actif.mesure = false;
    window['ga-disable-' + GA] = true;
    if (gaCharge) gtag('consent', 'update', { analytics_storage: 'denied' });
    effacer(function (n) { return n === '_ga' || n.indexOf('_ga_') === 0; });
  };

  // Le pixel : le code de base de Meta, réécrit lisiblement. `fbq` met les appels en file, que le script vide en arrivant.
  var pixelCharge = false;
  var chargerPixel = function () {
    actif.pub = true;
    if (pixelCharge) { window.fbq('consent', 'grant'); return; }
    pixelCharge = true;
    var f = window.fbq = function () { if (f.callMethod) f.callMethod.apply(f, arguments); else f.queue.push(arguments); };
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    f('init', PIXEL);
    f('track', 'PageView');
  };
  // Le retrait d'un accord DONNÉ ICI : plus rien ne part de cette page (le script chargé ne se décharge pas), les cookies
  // de Meta s'effacent, et les liens déjà décorés redeviennent nus. Les pages suivantes ne chargent plus rien. Comme pour
  // la mesure, un refus sans accord préalable n'y touche pas : `_fbp` et `_fbc` vivent sur messagingme.fr, ils peuvent
  // venir de l'accord donné sur www.
  var retirerPixel = function () {
    actif.pub = false;
    if (pixelCharge) window.fbq('consent', 'revoke');
    effacer(function (n) { return n === '_fbp' || n === '_fbc'; });
    [].slice.call(document.querySelectorAll('a[href^="https://' + CONSOLE + '/"]')).forEach(function (a) {
      var u = new URL(a.href);
      if (!u.searchParams.has('fbc') && !u.searchParams.has('fbp')) return;
      u.searchParams.delete('fbc'); u.searchParams.delete('fbp');
      a.href = u.toString();
    });
  };
  // Au moment du clic, pas au chargement : les cookies de Meta n'existent qu'une fois son script arrivé.
  var decorer = function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!actif.pub || !a || a.hostname !== CONSOLE) return;
    var fbc = cookie('_fbc'), fbp = cookie('_fbp');
    if (!fbc && !fbp) return;
    var u = new URL(a.href);
    if (fbc) u.searchParams.set('fbc', fbc);
    if (fbp) u.searchParams.set('fbp', fbp);
    a.href = u.toString();
  };
  ['mousedown', 'keydown', 'touchstart', 'click'].forEach(function (t) { document.addEventListener(t, decorer, true); });

  // Les événements de la mesure. Un lien vers la console ou GitHub quitte la page : gtag envoie en `fetch` keepalive, qui
  // survit à la navigation (mesuré le 2026-11-06 sur « Créer mon espace »).
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('.dev-copier')) { evenement('interet_developpeur', { geste: 'copie_commande' }); return; }
    var a = e.target.closest('a[href]');
    if (!a) return;
    if (a.hostname === CONSOLE) evenement('clic_console', { destination: a.pathname });
    else if (a.hostname === 'github.com') evenement('interet_developpeur', { geste: 'github' });
  });

  var banniere = null, retour = null;
  var fermer = function () {
    if (banniere) { banniere.remove(); banniere = null; }
    if (retour) { retour.focus(); retour = null; }
  };
  var decider = function (choix) {
    ecrire(choix);
    if (choix.mesure) chargerMesure(); else if (actif.mesure) couperMesure();
    if (choix.pub) chargerPixel(); else if (actif.pub) retirerPixel();
    fermer();
  };
  // `actuel` coche d'avance, dans « Personnaliser », ce qui est déjà accordé ; rien n'est coché sans accord.
  var ouvrir = function (actuel) {
    if (banniere) return;
    banniere = document.createElement('section');
    banniere.className = 'consentement';
    banniere.setAttribute('aria-label', 'Cookies');
    var p = document.createElement('p');
    p.textContent = T.texte + ' ';
    var a = document.createElement('a');
    a.href = T.lien; a.textContent = T.politique;
    p.appendChild(a);
    banniere.appendChild(p);

    var details = document.createElement('div');
    details.className = 'consentement-details';
    details.hidden = true;
    var cases = {};
    T.usages.forEach(function (u) {
      var label = document.createElement('label');
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = Boolean(actuel && actuel[u[0]]);
      cases[u[0]] = c;
      var texte = document.createElement('span');
      var titre = document.createElement('strong');
      titre.textContent = u[1];
      texte.appendChild(titre);
      texte.appendChild(document.createTextNode(' ' + u[2]));
      label.appendChild(c);
      label.appendChild(texte);
      details.appendChild(label);
    });
    banniere.appendChild(details);

    var choix = document.createElement('div');
    choix.className = 'consentement-choix';
    var bouton = function (texte, classe, quand) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = classe; b.textContent = texte;
      b.addEventListener('click', quand);
      choix.appendChild(b);
      return b;
    };
    var enregistrer;
    var perso = bouton(T.personnaliser, 'consentement-perso', function () {
      details.hidden = false; perso.hidden = true; enregistrer.hidden = false;
      cases.mesure.focus();
    });
    // « Tout refuser » et « Tout accepter » ont exactement le même poids : même classe, même taille, côte à côte.
    bouton(T.refuser, 'bouton bouton-trait', function () { decider({ mesure: false, pub: false }); });
    bouton(T.accepter, 'bouton bouton-trait', function () { decider({ mesure: true, pub: true }); });
    enregistrer = bouton(T.enregistrer, 'bouton bouton-trait', function () {
      decider({ mesure: cases.mesure.checked, pub: cases.pub.checked });
    });
    enregistrer.hidden = true;
    banniere.appendChild(choix);
    document.body.appendChild(banniere);
  };
  if (pied) {
    pied.hidden = false;
    var gerer = pied.querySelector('button');
    if (gerer) gerer.addEventListener('click', function () {
      if (banniere) return;
      retour = gerer;
      ouvrir(actif);
      banniere.querySelector('button').focus();
    });
  }
  var garde = lire();
  if (garde && garde.mesure) chargerMesure();
  if (garde && garde.pub) chargerPixel();
  if (!garde || !garde.complet) ouvrir(garde);
})();
