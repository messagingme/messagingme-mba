import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { lire, pagesHtml } from './vitrine-lecture';

/**
 * LES COOKIES DE LA VITRINE NE PARTENT QU'AVEC L'ACCORD, USAGE PAR USAGE (plan docs/superpowers/plans/2026-11-06-ga4-vitrine.md).
 *
 * 🔴 Ce qui ferait échouer la vitrine même si elle marche : un seul appel à Google ou à Meta sans l'accord de son usage.
 * Deux gardes. Aucune page ne charge Google ni Meta en direct (la seule porte est le bloc « Les cookies de la vitrine »
 * de `site/site.js`), et ce bloc, exécuté sur un faux document, ne charge un outil qu'après l'accord de SON usage, donné
 * ou gardé.
 */

const GA = 'G-F4KVJ1Z8MR';
const SIX_MOIS = 183 * 864e5;
const recent = () => new Date(Date.now() - 1000).toISOString();

/** Le bloc des cookies, tel que la vitrine le sert : de son commentaire de tête à la fin de sa fonction. */
function blocCookies(): string {
  const source = lire('site.js');
  const debut = source.indexOf('// Les cookies de la vitrine');
  const fin = source.indexOf('\n})();', debut);
  if (debut < 0 || fin < 0) throw new Error('bloc « Les cookies de la vitrine » introuvable dans site/site.js');
  return source.slice(debut, fin + 6);
}

/** Un élément de faux document : ce que le bloc appelle, rien de plus. */
class El {
  enfants: El[] = [];
  parent: El | null = null;
  attrs: Record<string, string> = {};
  ecoute: Record<string, Array<(e: unknown) => void>> = {};
  hidden = false;
  checked = false;
  textContent = '';
  className = '';
  type = '';
  src = '';
  href = '';
  id = '';
  async = false;
  constructor(public balise: string, private doc: { actif: El | null }) {}
  appendChild(e: El) { this.enfants.push(e); e.parent = this; return e; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: unknown) => void) { (this.ecoute[t] ??= []).push(f); }
  remove() { if (this.parent) this.parent.enfants = this.parent.enfants.filter((e) => e !== this); this.parent = null; }
  focus() { this.doc.actif = this; }
  tous(): El[] { return this.enfants.flatMap((e) => [e, ...e.tous()]); }
  querySelector(sel: string) { return this.tous().find((e) => e.balise === sel) ?? null; }
  cliquer() { (this.ecoute.click ?? []).forEach((f) => f({ target: this })); }
}

type Garde = Record<string, unknown> | undefined;

/** Exécute le bloc sur un faux document : `garde` est le choix déjà gardé dans le navigateur, s'il y en a un. */
function monter(options: { garde?: Garde; merci?: boolean; cookies?: string } = {}) {
  const etat = { actif: null as El | null };
  const tete = new El('head', etat);
  const corps = new El('body', etat);
  const stockage = new Map<string, string>();
  if (options.garde) stockage.set('mm-consentement', JSON.stringify(options.garde));
  let cookies = options.cookies ?? '';
  const cookiesEcrits: string[] = [];
  const ecouteurs: Array<(e: unknown) => void> = [];
  const gerer = new El('button', etat);
  const pied = new El('li', etat);
  pied.hidden = true;
  pied.appendChild(gerer);
  const liens: Array<{ href: string }> = [];
  const fenetre: Record<string, any> = {};
  const document = {
    documentElement: { lang: 'fr' },
    head: tete,
    body: corps,
    createElement: (balise: string) => new El(balise, etat),
    createTextNode: (texte: string) => Object.assign(new El('#texte', etat), { textContent: texte }),
    querySelector: (sel: string) => (sel === '[data-cookies]' ? pied : sel === '.c-merci' && options.merci ? {} : null),
    querySelectorAll: (sel: string) => (sel.startsWith('a[href^=') ? liens : []),
    addEventListener: (_t: string, f: (e: unknown) => void) => ecouteurs.push(f),
    get cookie() { return cookies; },
    set cookie(v: string) { cookiesEcrits.push(v); },
  };
  runInNewContext(blocCookies(), {
    window: fenetre,
    document,
    URL,
    location: { pathname: '/', hostname: 'app.messagingme.fr' },
    localStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => stockage.set(k, v) },
  });
  const banniere = () => corps.enfants.find((e) => e.className === 'consentement') ?? null;
  const bouton = (texte: string) => {
    const b = banniere()?.tous().find((e) => e.balise === 'button' && e.textContent === texte);
    if (!b) throw new Error(`bouton « ${texte} » absent de la bannière`);
    return b;
  };
  const cases = () => (banniere()?.tous().filter((e) => e.balise === 'input') ?? []);
  const scripts = () => tete.enfants.map((s) => s.src);
  const google = () => scripts().filter((s) => s.includes('googletagmanager.com'));
  const meta = () => scripts().filter((s) => s.includes('connect.facebook.net'));
  const file = () => ((fenetre.dataLayer ?? []) as ArrayLike<unknown>[]).map((a) => Array.from(a));
  const gardeEcrite = () => JSON.parse(stockage.get('mm-consentement') ?? 'null');
  const cliquerLien = (lien: { hostname: string; pathname: string; href?: string }) =>
    ecouteurs.forEach((f) => f({ target: { closest: (sel: string) => (sel === 'a[href]' ? lien : null) } }));
  return {
    banniere, bouton, cases, scripts, google, meta, file, gardeEcrite, cliquerLien, fenetre, cookiesEcrits, gerer, pied, etat,
    poserCookies: (c: string) => { cookies = c; },
  };
}

describe('aucune page ne charge Google ni Meta en direct', () => {
  const pages = pagesHtml();

  it('il y a des pages à lire, sinon ce test ne prouve rien', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it.each(pages)('%s', (page) => {
    expect(lire(page)).not.toMatch(/googletagmanager|google-analytics|gtag\(|G-F4KVJ1Z8MR|connect\.facebook\.net|fbevents|fbq\(/);
  });
});

describe('le bloc « Les cookies de la vitrine » de site.js', () => {
  it('sans choix gardé : la bannière s’ouvre, rien ne part ni chez Google ni chez Meta', () => {
    const v = monter();
    expect(v.banniere()).not.toBeNull();
    expect(v.scripts()).toEqual([]);
    expect(v.file()).toEqual([]);
    expect(v.cases().map((c) => c.checked)).toEqual([false, false]);
  });

  it('« Tout refuser » et « Tout accepter » ont le même poids', () => {
    const v = monter();
    expect(v.bouton('Tout refuser').className).toBe(v.bouton('Tout accepter').className);
  });

  it('« Tout accepter » charge les deux outils, GA4 sans fonction publicitaire, et garde le choix', () => {
    const v = monter();
    v.bouton('Tout accepter').cliquer();
    expect(v.google()).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA}`]);
    expect(v.meta()).toHaveLength(1);
    expect(v.file()).toContainEqual(['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(v.file()).toContainEqual(['config', GA, { allow_google_signals: false, allow_ad_personalization_signals: false }]);
    expect(v.gardeEcrite()).toMatchObject({ mesure: true, pub: true });
    expect(v.banniere()).toBeNull();
  });

  it('« Tout refuser » : rien ne part, le choix est gardé', () => {
    const v = monter();
    v.bouton('Tout refuser').cliquer();
    expect(v.scripts()).toEqual([]);
    expect(v.gardeEcrite()).toMatchObject({ mesure: false, pub: false });
  });

  it('« Personnaliser » : la mesure seule charge Google et pas Meta', () => {
    const v = monter();
    v.bouton('Personnaliser').cliquer();
    expect(v.bouton('Enregistrer mes choix').hidden).toBe(false);
    v.cases()[0]!.checked = true;
    v.bouton('Enregistrer mes choix').cliquer();
    expect(v.google()).toHaveLength(1);
    expect(v.meta()).toEqual([]);
    expect(v.gardeEcrite()).toMatchObject({ mesure: true, pub: false });
  });

  it('« Personnaliser » : la publicité seule charge Meta et pas Google', () => {
    const v = monter();
    v.bouton('Personnaliser').cliquer();
    v.cases()[1]!.checked = true;
    v.bouton('Enregistrer mes choix').cliquer();
    expect(v.meta()).toHaveLength(1);
    expect(v.google()).toEqual([]);
    expect(v.gardeEcrite()).toMatchObject({ mesure: false, pub: true });
  });

  it('un choix gardé charge ses seuls outils dès la page suivante, sans bannière', () => {
    const v = monter({ garde: { mesure: true, pub: false, le: recent() } });
    expect(v.google()).toHaveLength(1);
    expect(v.meta()).toEqual([]);
    expect(v.banniere()).toBeNull();
    const w = monter({ garde: { mesure: false, pub: false, le: recent() } });
    expect(w.scripts()).toEqual([]);
    expect(w.banniere()).toBeNull();
  });

  it('un accord gardé avant la mesure vaut pour le pixel seul, et la bannière redemande', () => {
    const v = monter({ garde: { choix: 'accepte', le: recent() } });
    expect(v.meta()).toHaveLength(1);
    expect(v.google()).toEqual([]);
    expect(v.banniere()).not.toBeNull();
    expect(v.cases().map((c) => c.checked)).toEqual([false, true]);
  });

  it('un refus gardé avant la mesure : rien ne part, la bannière redemande', () => {
    const v = monter({ garde: { choix: 'refuse', le: recent() } });
    expect(v.scripts()).toEqual([]);
    expect(v.banniere()).not.toBeNull();
  });

  it('un choix de plus de six mois, ou illisible, ne vaut plus : rien ne part, on redemande', () => {
    for (const garde of [
      { mesure: true, pub: true, le: new Date(Date.now() - SIX_MOIS - 1000).toISOString() },
      { mesure: 'oui', pub: true, le: recent() },
      { mesure: true, pub: true },
    ]) {
      const v = monter({ garde });
      expect(v.scripts()).toEqual([]);
      expect(v.banniere()).not.toBeNull();
    }
  });

  it('« Gérer les cookies » rouvre la bannière, les accords cochés ; retirer la mesure la coupe et efface les _ga', () => {
    const v = monter({ garde: { mesure: true, pub: true, le: recent() }, cookies: `_ga=GA1.1.1; autre=1; _ga_${GA.slice(2)}=GS2.1; _fbp=fb.1.2.3` });
    expect(v.pied.hidden).toBe(false);
    v.gerer.cliquer();
    expect(v.banniere()).not.toBeNull();
    expect(v.etat.actif?.textContent).toBe('Personnaliser');
    v.bouton('Personnaliser').cliquer();
    expect(v.cases().map((c) => c.checked)).toEqual([true, true]);
    v.cases()[0]!.checked = false;
    v.bouton('Enregistrer mes choix').cliquer();
    expect(v.fenetre[`ga-disable-${GA}`]).toBe(true);
    expect(v.file()).toContainEqual(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(v.cookiesEcrits).toContain('_ga=; Max-Age=0; path=/; domain=.messagingme.fr');
    expect(v.cookiesEcrits).toContain(`_ga_${GA.slice(2)}=; Max-Age=0; path=/; domain=.messagingme.fr`);
    expect(v.cookiesEcrits.some((c) => c.startsWith('autre=') || c.startsWith('_fbp='))).toBe(false);
    expect(v.gardeEcrite()).toMatchObject({ mesure: false, pub: true });
    expect(v.etat.actif).toBe(v.gerer);
  });

  it('un refus sans accord donné ici ne touche pas aux _ga, qui peuvent venir de www', () => {
    const v = monter({ cookies: '_ga=GA1.1.1' });
    v.bouton('Tout refuser').cliquer();
    expect(v.cookiesEcrits.some((c) => c.startsWith('_ga'))).toBe(false);
  });

  it('les événements de la mesure ne partent qu’avec son accord', () => {
    const sansMesure = monter({ garde: { mesure: false, pub: true, le: recent() } });
    sansMesure.cliquerLien({ hostname: 'console.messagingme.app', pathname: '/signup', href: 'https://console.messagingme.app/signup' });
    expect(sansMesure.file()).toEqual([]);

    const v = monter({ garde: { mesure: true, pub: false, le: recent() } });
    v.cliquerLien({ hostname: 'console.messagingme.app', pathname: '/signup', href: 'https://console.messagingme.app/signup' });
    v.cliquerLien({ hostname: 'github.com', pathname: '/julienmessagingme/messagingme-plugin' });
    expect(v.file()).toContainEqual(['event', 'clic_console', { destination: '/signup' }]);
    expect(v.file()).toContainEqual(['event', 'interet_developpeur', { geste: 'github' }]);
  });

  it('la page de remerciement du contact envoie contact_envoye, une fois la mesure accordée', () => {
    expect(monter({ merci: true }).file()).toEqual([]);
    const v = monter({ merci: true });
    v.bouton('Tout accepter').cliquer();
    expect(v.file()).toContainEqual(['event', 'contact_envoye', {}]);
  });

  it('le clic vers la console ne porte fbc et fbp qu’avec l’accord de la publicité', () => {
    const lien = () => ({ hostname: 'console.messagingme.app', pathname: '/signup', href: 'https://console.messagingme.app/signup' });
    const sansPub = monter({ garde: { mesure: true, pub: false, le: recent() }, cookies: '_fbp=fb.1.2.3' });
    const a = lien();
    sansPub.cliquerLien(a);
    expect(a.href).toBe('https://console.messagingme.app/signup');

    const avecPub = monter({ garde: { mesure: false, pub: true, le: recent() }, cookies: '_fbp=fb.1.2.3' });
    const b = lien();
    avecPub.cliquerLien(b);
    expect(new URL(b.href).searchParams.get('fbp')).toBe('fb.1.2.3');
  });
});
