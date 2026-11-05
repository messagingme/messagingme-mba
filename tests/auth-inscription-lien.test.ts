import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { verifyPassword, hashPasswordSync } from '../src/auth/password';
import { verifySession } from '../src/auth/token';
import { CompteurDebitMemoire } from '../src/db/debit.memoire';
import type { CompteurDebit } from '../src/db/debit';
import type { ComptesAuthDep } from '../src/auth/comptes';
import type { AuthRouteDeps } from '../src/auth/routes';
import type { DemandeInscription, EspaceAConfirmer } from '../src/user/inscriptions';
import {
  DEMANDES_PAR_RESEAU_ET_PAR_HEURE, LIENS_PAR_ADRESSE_ET_PAR_JOUR, MESSAGE_LIENS_DE_L_ADRESSE, MESSAGE_TROP_D_INSCRIPTIONS,
  SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE,
} from '../src/auth/inscription-lien';
import { MESSAGE_PLAFOND_INDISPONIBLE } from '../src/auth/plafond-partage';
import { HEURES_LIEN_INSCRIPTION } from '../web/lib/partage/inscription';
import { MfaEnMemoire } from './mfa';
import { fauxPub } from './pub-faux';

/**
 * 🔴 L'INSCRIPTION PAR E-MAIL PROUVÉE PAR UN LIEN (lot identité B, constat d'audit du 2026-11-04). Une adresse inconnue
 * ne crée plus rien à la demande : un lien part, et l'identité, l'espace et la session naissent au clic. Le mot de passe,
 * le nom de l'espace et l'accord publicitaire se donnent au clic, par la personne qui a reçu l'e-mail : un tiers qui
 * remplit le formulaire avec l'adresse d'autrui ne pose rien.
 */
const SECRET = 'test-secret';
const KNOWN_HASH = hashPasswordSync('current-pass-123');
const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;

interface Courriel { to: string; subject: string; text: string; html?: string; tags?: Array<{ name: string; value: string }> }
interface Cap {
  demandes: Array<DemandeInscription & { jeton: string; vivante: boolean }>;
  confirmations: Array<{ jeton: string; espace: EspaceAConfirmer }>;
  oubliees: string[];
  courriels: Courriel[];
  crees: string[];
  alertes: string[];
}

function app(over: Partial<Omit<AuthRouteDeps, 'comptes'>> & { comptes?: Partial<ComptesAuthDep>; debit?: CompteurDebit } = {}) {
  const mfa = new MfaEnMemoire([]);
  const cap: Cap = { demandes: [], confirmations: [], oubliees: [], courriels: [], crees: [], alertes: [] };
  const { comptes, debit, ...reste } = over;
  const deps: AuthRouteDeps = {
    users: { findIdentity: async () => null },
    secret: SECRET,
    mfa,
    comptes: {
      createTenantWithAdmin: async (_nom, admin) => {
        cap.crees.push(admin.email);
        mfa.ajouterCompte({ userId: 'uConnu', tenantId: 'tConnu', role: 'admin', email: admin.email });
        return { tenantId: 'tConnu', userId: 'uConnu' };
      },
      motDePasseDeLAdresse: async (email) => (email === 'deja@x.fr' ? KNOWN_HASH : undefined),
      demanderInscription: async (d) => {
        const jeton = `jeton${cap.demandes.length + 1}${'x'.repeat(38)}`;
        cap.demandes.push({ ...d, jeton, vivante: true });
        return jeton;
      },
      oublierDemande: async (jeton) => {
        cap.oubliees.push(jeton);
        for (const d of cap.demandes) if (d.jeton === jeton) d.vivante = false;
      },
      inscriptionVivante: async (jeton) => cap.demandes.some((d) => d.jeton === jeton && d.vivante),
      confirmerInscription: async (jeton, espace) => {
        const d = cap.demandes.find((x) => x.jeton === jeton && x.vivante);
        if (!d) return { statut: 'lien_invalide' };
        if (d.email === 'nee-entre-temps@x.fr') return { statut: 'adresse_connue' };
        cap.confirmations.push({ jeton, espace });
        for (const x of cap.demandes) if (x.email === d.email) x.vivante = false;
        mfa.ajouterCompte({ userId: 'uNeuf', tenantId: 'tNeuf', role: 'admin', email: d.email });
        return {
          statut: 'cree', tenantId: 'tNeuf', userId: 'uNeuf', email: d.email, langue: d.langue, offrePro: d.offrePro,
          application: d.application, pubFbc: d.pubFbc, pubFbp: d.pubFbp,
        };
      },
      ...comptes,
    },
    sendEmail: async (e) => { cap.courriels.push(e); },
    appUrl: 'https://console.messagingme.app/',
    alerter: async (texte) => { cap.alertes.push(texte); },
    ...reste,
  };
  const server = buildServer({ queue: new FakeQueue(), auth: deps, debit: debit ?? new CompteurDebitMemoire() });
  return { server, cap };
}

type Serveur = ReturnType<typeof app>['server'];
const demander = (server: Serveur, corps: Record<string, unknown>, ip = '203.0.113.7') => server.inject({
  method: 'POST', url: '/auth/signup',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'user-agent': 'Formulaire/1.0' },
  payload: corps,
});
const cliquer = (server: Serveur, corps: Record<string, unknown>, ip = '198.51.100.9') => server.inject({
  method: 'POST', url: '/auth/signup/confirm',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'user-agent': 'Clic/2.0' },
  payload: corps,
});
const jetonDu = (c: Courriel): string => {
  const m = /\/signup\/confirm\/([^?\s]+)\?lang=(fr|en)/.exec(c.text);
  if (!m) throw new Error(`aucun lien dans ${c.text}`);
  return decodeURIComponent(m[1]!);
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Les mots d'un texte : un tutoiement se cherche par mot entier, jamais par motif (« n’êtes » contient « tes »). */
const mots = (texte: string): Set<string> => new Set(texte.toLowerCase().split(/[^a-zà-ÿœæç]+/));

describe('🔴 la demande : une adresse inconnue ne crée rien, un lien part', () => {
  it('202, ni espace ni session ; la demande ne garde que l’adresse, la langue, le Pro, l’application et les identifiants publicitaires', async () => {
    const journal = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
    const p = fauxPub();
    const { server, cap } = app({ pub: p.deps });
    // Le corps d'une console d'avant le lot : mot de passe, nom d'espace, nom et case cochée, que rien ne doit garder.
    const res = await demander(server, {
      email: ' Neuve@X.fr ', password: 'mot-de-passe-du-tiers', workspaceName: 'Compte suspendu, appelez le 0123456789', name: 'Tiers',
      langue: 'en', offre: 'pro', application: true, fbc: 'fb.1.1793300000000.formulaire', pub: { accord: true, fbp: 'fb.1.1793300000000.p' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ lienEnvoye: true });
    expect(cap.crees).toEqual([]);
    expect(cap.demandes).toHaveLength(1);
    const { jeton, vivante: _vivante, ...gardee } = cap.demandes[0]!;
    expect(gardee).toEqual({ email: 'neuve@x.fr', langue: 'en', offrePro: true, application: true, pubFbc: 'fb.1.1793300000000.formulaire', pubFbp: 'fb.1.1793300000000.p' });
    // Rien de l'accord publicitaire à la demande : il se donne au clic.
    expect(p.notes).toEqual([]);
    // Ni la réponse ni le journal ne portent le jeton.
    expect(res.body).not.toContain(jeton);
    for (const espion of journal) for (const appel of espion.mock.calls) expect(JSON.stringify(appel)).not.toContain(jeton);
    await server.close();
  });

  it('🔴 l’e-mail : le lien et sa durée, au vouvoiement ; ni le nom d’espace ni le nom saisis, même piégés ; ni « Business Agent » ; étiqueté', async () => {
    const { server, cap } = app();
    await demander(server, { email: 'cible@x.fr', workspaceName: 'Appelez le https://hameconnage.example', name: 'Support <b>officiel</b>', password: 'x'.repeat(14) });
    expect(cap.courriels).toHaveLength(1);
    const c = cap.courriels[0]!;
    expect(c.to).toBe('cible@x.fr');
    expect(c.subject).toBe('Confirmez votre adresse pour créer votre espace Messaging Me');
    expect(c.text).toContain(`https://console.messagingme.app/signup/confirm/${cap.demandes[0]!.jeton}?lang=fr`);
    expect(c.text).toContain(`${HEURES_LIEN_INSCRIPTION} heures`);
    for (const corps of [c.text, c.html ?? '']) {
      expect(corps).not.toMatch(/hameconnage|Appelez|Support|officiel/);
      expect(corps).not.toContain('Business Agent');
      for (const mot of ['tu', 'ton', 'ta', 'tes', 'toi', 'te']) expect(mots(corps).has(mot), mot).toBe(false);
    }
    expect(c.html).toContain('Créer mon espace');
    expect(c.tags).toEqual([{ name: 'categorie', value: 'inscription' }]);
    await server.close();
  });

  it('en anglais quand la page était en anglais', async () => {
    const { server, cap } = app();
    await demander(server, { email: 'english@x.fr', langue: 'en' });
    expect(cap.courriels[0]!.subject).toBe('Confirm your address to create your Messaging Me workspace');
    expect(cap.courriels[0]!.text).toMatch(/\?lang=en/);
    await server.close();
  });

  it('🔴 fermé sans envoi : sans `sendEmail` ou sans `appUrl`, 503 et aucune demande ; l’adresse connue garde son 201', async () => {
    for (const manque of [{ sendEmail: undefined }, { appUrl: undefined }]) {
      const { server, cap } = app(manque);
      const res = await demander(server, { email: 'neuve@x.fr' });
      expect(res.statusCode).toBe(503);
      expect(cap.demandes).toEqual([]);
      const connue = await demander(server, { email: 'deja@x.fr', password: 'current-pass-123', workspaceName: 'Deuxième' });
      expect(connue.statusCode).toBe(201);
      await server.close();
    }
  });

  it('🔴 un envoi qui échoue : 503, et la demande est oubliée (le lien qui n’est pas parti ne confirme rien)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { server, cap } = app({ sendEmail: async () => { throw new Error('Resend indisponible'); } });
    const res = await demander(server, { email: 'neuve@x.fr' });
    expect(res.statusCode).toBe(503);
    expect(cap.oubliees).toEqual([cap.demandes[0]!.jeton]);
    expect(cap.demandes[0]!.vivante).toBe(false);
    await server.close();
  });

  it('un envoi en échec ne tue pas le lien que le titulaire tient déjà', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let echoue = false;
    const { server, cap } = app({ sendEmail: async (e) => { if (echoue) throw new Error('panne'); cap.courriels.push(e); } });
    await demander(server, { email: 'titulaire@x.fr' });
    echoue = true;
    expect((await demander(server, { email: 'titulaire@x.fr' })).statusCode).toBe(503);
    const res = await cliquer(server, { jeton: jetonDu(cap.courriels[0]!), workspaceName: 'Mon espace', password: 'mot-de-passe-du-titulaire' });
    expect(res.statusCode).toBe(201);
    await server.close();
  });
});

describe('🔴 le défi anti-robot (Turnstile)', () => {
  it('clé posée : un jeton absent ou refusé ne laisse ni demande ni e-mail ; accepté, le lien part', async () => {
    const vus: Array<{ jeton: string; ip: string | null }> = [];
    const { server, cap } = app({ turnstile: { verifier: async (jeton, ip) => { vus.push({ jeton, ip }); return jeton === 'BON'; } } });
    expect((await demander(server, { email: 'a@x.fr' })).statusCode).toBe(403);
    const refuse = await demander(server, { email: 'a@x.fr', turnstile: 'MAUVAIS' });
    expect(refuse.statusCode).toBe(403);
    expect(refuse.json().code).toBe('defi');
    expect(cap.demandes).toEqual([]);
    expect(cap.courriels).toEqual([]);
    expect((await demander(server, { email: 'a@x.fr', turnstile: 'BON' }, '192.0.2.44')).statusCode).toBe(202);
    expect(vus.at(-1)).toEqual({ jeton: 'BON', ip: '192.0.2.44' });
    await server.close();
  });

  it('le défi ne concerne que l’adresse inconnue : l’adresse connue n’en a pas besoin', async () => {
    const { server } = app({ turnstile: { verifier: async () => false } });
    const res = await demander(server, { email: 'deja@x.fr', password: 'current-pass-123', workspaceName: 'Deuxième' });
    expect(res.statusCode).toBe(201);
    await server.close();
  });

  it('clé absente : pas de défi', async () => {
    const { server } = app();
    expect((await demander(server, { email: 'a@x.fr' })).statusCode).toBe(202);
    await server.close();
  });
});

describe('🔴 les plafonds de la demande, comptés en un seul appel', () => {
  it(`${LIENS_PAR_ADRESSE_ET_PAR_JOUR} liens par adresse et par jour : le suivant est refusé une heure plus tard, accepté le lendemain`, async () => {
    // L'horloge de `Date` seule : le compteur en mémoire ET la mémoire des fenêtres pleines du serveur la lisent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(1_800_000_000_000));
    const { server, cap } = app();
    for (let i = 0; i < LIENS_PAR_ADRESSE_ET_PAR_JOUR; i++) {
      expect((await demander(server, { email: 'visee@x.fr' }, `203.0.113.${i + 1}`)).statusCode).toBe(202);
    }
    vi.setSystemTime(new Date(Date.now() + HEURE + 1));
    const refus = await demander(server, { email: 'visee@x.fr' }, '203.0.113.50');
    expect(refus.statusCode).toBe(429);
    expect(refus.json().error).toBe(MESSAGE_LIENS_DE_L_ADRESSE);
    expect(cap.courriels).toHaveLength(LIENS_PAR_ADRESSE_ET_PAR_JOUR);
    vi.setSystemTime(new Date(Date.now() + JOUR));
    expect((await demander(server, { email: 'visee@x.fr' }, '203.0.113.51')).statusCode).toBe(202);
    await server.close();
  });

  it('🔴 une rafale depuis un même /64, une adresse IPv6 différente à chaque fois, est arrêtée ; une inscription légitime passe ensuite', async () => {
    const { server, cap } = app();
    for (let i = 0; i < DEMANDES_PAR_RESEAU_ET_PAR_HEURE; i++) {
      expect((await demander(server, { email: `robot${i}@x.fr` }, `2001:db8:1:2::${(i + 1).toString(16)}`)).statusCode).toBe(202);
    }
    const arretee = await demander(server, { email: 'robot-suivant@x.fr' }, '2001:db8:1:2:abcd::9');
    expect(arretee.statusCode).toBe(429);
    expect(arretee.json().error).toBe(MESSAGE_TROP_D_INSCRIPTIONS);
    expect(cap.courriels).toHaveLength(DEMANDES_PAR_RESEAU_ET_PAR_HEURE);
    expect((await demander(server, { email: 'legitime@x.fr' }, '198.51.100.20')).statusCode).toBe(202);
    await server.close();
  });

  it('🔴 tout ou rien : une demande refusée par la fenêtre réseau ne consomme pas les liens du jour de l’adresse visée', async () => {
    const { server } = app();
    for (let i = 0; i < DEMANDES_PAR_RESEAU_ET_PAR_HEURE; i++) await demander(server, { email: `bruit${i}@x.fr` }, '192.0.2.1');
    for (let i = 0; i < 5; i++) expect((await demander(server, { email: 'titulaire@x.fr' }, '192.0.2.1')).statusCode).toBe(429);
    // Depuis un autre réseau, les trois liens du jour de l'adresse sont intacts.
    for (let i = 0; i < LIENS_PAR_ADRESSE_ET_PAR_JOUR; i++) {
      expect((await demander(server, { email: 'titulaire@x.fr' }, `198.51.100.${i + 1}`)).statusCode).toBe(202);
    }
    await server.close();
  });

  it('le total horaire refuse au-delà de son plafond ; 0 le désactive', async () => {
    const { server } = app({ inscriptionPlafondHeure: 2 });
    expect((await demander(server, { email: 't1@x.fr' }, '192.0.2.10')).statusCode).toBe(202);
    expect((await demander(server, { email: 't2@x.fr' }, '192.0.2.11')).statusCode).toBe(202);
    const refus = await demander(server, { email: 't3@x.fr' }, '192.0.2.12');
    expect(refus.statusCode).toBe(429);
    expect(refus.json().error).toBe(MESSAGE_TROP_D_INSCRIPTIONS);
    await server.close();
    const sans = app({ inscriptionPlafondHeure: 0 });
    for (let i = 0; i < 4; i++) expect((await demander(sans.server, { email: `s${i}@x.fr` }, `192.0.2.${20 + i}`)).statusCode).toBe(202);
    await sans.server.close();
  });

  it(`l’alerte part une fois, à la ${SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE}e demande de l’heure`, async () => {
    const { server, cap } = app();
    for (let i = 0; i < SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE + 2; i++) {
      expect((await demander(server, { email: `vague${i}@x.fr` }, `10.${Math.floor(i / 200)}.${i % 200}.1`)).statusCode).toBe(202);
      if (i === SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE - 2) expect(cap.alertes).toEqual([]);
    }
    expect(cap.alertes).toHaveLength(1);
    expect(cap.alertes[0]).toContain(String(SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE));
    await server.close();
  });

  it('🔴 fermé sur panne : un compteur qui ne répond pas refuse, sans demande ni e-mail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const enPanne: CompteurDebit = {
      compter: async (c) => {
        if (c.some((x) => x.cle.startsWith('inscription.'))) throw new Error('base indisponible');
        return { accepte: true, maintenantMs: Date.now(), fenetres: c.map((x) => ({ cle: x.cle, max: x.max, pleine: false, compte: 1, finMs: Date.now() + 60_000 })) };
      },
      lister: async () => [],
    };
    const { server, cap } = app({ debit: enPanne });
    const res = await demander(server, { email: 'neuve@x.fr' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe(MESSAGE_PLAFOND_INDISPONIBLE);
    expect(cap.demandes).toEqual([]);
    expect(cap.courriels).toEqual([]);
    await server.close();
  });
});

describe('🔴 le clic sur le lien', () => {
  const parcours = async (corpsDemande: Record<string, unknown> = {}, pub?: ReturnType<typeof fauxPub>) => {
    const { server, cap } = app(pub ? { pub: pub.deps } : {});
    await demander(server, { email: 'neuve@x.fr', password: 'mot-de-passe-du-formulaire', ...corpsDemande });
    return { server, cap, jeton: jetonDu(cap.courriels[0]!) };
  };

  it('🔴 le mot de passe est celui du clic, jamais celui du formulaire ; la session s’ouvre tout de suite', async () => {
    const { server, cap, jeton } = await parcours({ offre: 'pro', application: true, langue: 'en' });
    const res = await cliquer(server, { jeton, workspaceName: '  Mon espace  ', name: ' Titulaire ', password: 'mot-de-passe-du-clic' });
    expect(res.statusCode).toBe(201);
    const corps = res.json<{ token: string; user: unknown; inscription: unknown }>();
    expect(corps.user).toEqual({ email: 'neuve@x.fr', role: 'admin', tenantId: 'tNeuf' });
    expect(corps.inscription).toEqual({ offre: 'pro', application: true, langue: 'en' });
    expect(await verifySession(corps.token, SECRET)).toMatchObject({ userId: 'uNeuf', tenantId: 'tNeuf', role: 'admin' });
    const { espace } = cap.confirmations[0]!;
    expect(espace.workspaceName).toBe('Mon espace');
    expect(espace.name).toBe('Titulaire');
    expect(await verifyPassword('mot-de-passe-du-clic', espace.passwordHash)).toBe(true);
    expect(await verifyPassword('mot-de-passe-du-formulaire', espace.passwordHash)).toBe(false);
    await server.close();
  });

  it('🔴 un lien ne sert qu’une fois : recliqué, 400 `lien_invalide`, jamais 401', async () => {
    const { server, jeton } = await parcours();
    expect((await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic' })).statusCode).toBe(201);
    const second = await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic' });
    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe('lien_invalide');
    await server.close();
  });

  it('🔴 un jeton inventé ou mort ne va jamais jusqu’à la création (ni hachage)', async () => {
    const confirmer = vi.fn();
    const { server } = app({ comptes: { inscriptionVivante: async () => false, confirmerInscription: confirmer } });
    for (const jeton of ['', 'inconnu', 'x'.repeat(129)]) {
      const res = await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic' });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('lien_invalide');
    }
    expect(confirmer).not.toHaveBeenCalled();
    await server.close();
  });

  it('🔴 une adresse née entre la demande et le clic : 409 `adresse_connue`', async () => {
    const { server, cap } = app();
    await demander(server, { email: 'nee-entre-temps@x.fr' });
    const res = await cliquer(server, { jeton: jetonDu(cap.courriels[0]!), workspaceName: 'Espace', password: 'mot-de-passe-du-clic' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('adresse_connue');
    await server.close();
  });

  it('les règles du clic : nom d’espace requis et borné, nom borné, mot de passe assez long', async () => {
    const { server, cap, jeton } = await parcours();
    const essai = (corps: Record<string, unknown>) => cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic', ...corps });
    const cas = await Promise.all([
      essai({ workspaceName: '' }), essai({ workspaceName: 'a'.repeat(81) }), essai({ workspaceName: 'Mon\nEspace' }),
      essai({ name: 'n'.repeat(61) }), essai({ password: 'court' }),
    ]);
    expect(cas.map((r) => r.statusCode)).toEqual([400, 400, 400, 400, 400]);
    expect(cas[1]!.json().error).toMatch(/80/);
    expect(cas[3]!.json().error).toMatch(/60/);
    expect(cas[4]!.json().error).toMatch(/trop court/);
    expect(cap.confirmations).toEqual([]);
    await server.close();
  });

  it('🔴 l’accord publicitaire du clic : l’adresse prouvée, l’accord, puis l’inscription avec l’IP et le navigateur du clic', async () => {
    const p = fauxPub();
    const { server, jeton } = await parcours({ fbc: 'fb.1.1793300000000.formulaire' }, p);
    expect(p.notes).toEqual([]);
    const res = await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic', pub: { accord: true, fbp: 'fb.1.1793300000000.clic' } });
    expect(res.statusCode).toBe(201);
    expect(p.notes).toEqual([
      'prouvee neuve@x.fr',
      'accord neuve@x.fr fbc=fb.1.1793300000000.formulaire fbp=fb.1.1793300000000.clic',
      'inscription neuve@x.fr ip=198.51.100.9 navigateur=Clic/2.0',
    ]);
    await server.close();
  });

  it('sans accord au clic : l’adresse est prouvée, rien d’autre ne s’écrit ni ne part', async () => {
    const p = fauxPub();
    const { server, jeton } = await parcours({ fbc: 'fb.1.1793300000000.formulaire', pub: { accord: true } }, p);
    await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic' });
    expect(p.notes).toEqual(['prouvee neuve@x.fr']);
    await server.close();
  });

  it('un accord qui ne s’écrit pas (base en panne) ne fait pas échouer le clic', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { server, jeton } = await parcours({}, fauxPub({ leve: true }));
    expect((await cliquer(server, { jeton, workspaceName: 'Espace', password: 'mot-de-passe-du-clic', pub: { accord: true } })).statusCode).toBe(201);
    await server.close();
  });

  it('fermé sans le magasin : 503', async () => {
    const { server } = app({ comptes: { confirmerInscription: undefined } });
    expect((await cliquer(server, { jeton: 'quelconque', workspaceName: 'Espace', password: 'mot-de-passe-du-clic' })).statusCode).toBe(503);
    await server.close();
  });
});

describe('🔴 l’adresse connue, inchangée', () => {
  it('sans mot de passe (l’étape de l’adresse de la console) : 409 `adresse_connue`, sans lien ni e-mail', async () => {
    const { server, cap } = app();
    const res = await demander(server, { email: 'Deja@X.fr' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'un compte existe déjà avec cet email', code: 'adresse_connue' });
    expect(cap.demandes).toEqual([]);
    expect(cap.courriels).toEqual([]);
    await server.close();
  });
});
