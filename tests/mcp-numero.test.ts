import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { OUTILS, outilsPour, type DepsMcp, type OutilMcp } from '../src/mcp/outils';
import { DELAI_ATTENTE_MS, PAS_ATTENTE_MS, modeDuLienNeuf, rappelDeLAbonnement, rappelDeLaSuiteDuPro } from '../src/mcp/outils-numero';
import type { EtatDeLEspace } from '../src/stripe/abonnements.pg';
import { RefusOutil } from '../src/mcp/saisie';
import type { Issue } from '../src/lib/issue';
import { signLienNumero, verifyLienNumero, DUREE_LIEN_NUMERO_MS } from '../src/auth/token';
import { empreinteEtat, type EtatConnexion } from '../src/otp/etat-connexion';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META, PREREQUIS_META } from '../web/lib/partage/etapes-meta';
import { ETAPES_COMPTE_FOURNI, ETAPES_FENETRE_GARDER, ETAPES_RELIER_APPLICATION } from '../web/lib/partage/etapes-application';
import { CODE_VERIFICATION_FOURNI, ETAPES_NUMERO_FOURNI } from '../web/lib/partage/etapes-numero-fourni';
import { AIDE_GARDER_APPLICATION } from '../web/lib/partage/aide-connexion';
import { COEXISTENCE_BOUTON } from '../web/lib/fenetre-meta';
import { NOTE_CARTE_APPLICATION } from '../web/lib/questions-numero';

/**
 * LES OUTILS DE LA CONNEXION DU NUMÉRO (lot 3c, livraison A, tâche 4). `start_whatsapp_connection` donne le lien qui
 * ouvre la page de connexion sans la console ; `watch_whatsapp_connection` attend le prochain changement (numéro
 * attribué, code, connexion) et rend le code pour que Claude l'affiche dans le terminal.
 */
const SECRET = randomBytes(32).toString('hex');
const PERSONNE = { userId: 'u-admin', autorisationId: 'aut-1' };
const VIDE: EtatConnexion = { fourni: null, code: null, connecte: null, abonnement: null, inclusDansLePro: false };
const outil = (nom: string): OutilMcp => OUTILS.find((o) => o.nom === nom)!;

/** Une horloge simulée : `attendre` avance le temps, et chaque lecture de l'état est comptée avec son heure. */
function monter(etats: (t: number) => EtatConnexion, o: { portail?: Issue<{ url: string }>; abonnement?: EtatDeLEspace | null; proVivant?: boolean } = {}) {
  let t = 1_000_000;
  const lectures: Array<{ tenant: string; t: number }> = [];
  const portails: Array<{ tenant: string; payeur: string }> = [];
  const paiements: Array<{ tenant: string; payeur: string }> = [];
  const couteux: string[] = [];
  const rendus: Array<{ tenant: string; rendre: boolean }> = [];
  const destinations: Array<{ tenant: string; destination: string }> = [];
  const deps = {
    numero: {
      retenirDestination: async (tenant: string, destination: string) => { destinations.push({ tenant, destination }); },
      signerLien: (l: Parameters<typeof signLienNumero>[0]) => signLienNumero(l, SECRET),
      etat: async (tenant: string) => { lectures.push({ tenant, t }); return etats(t); },
      urlConsole: 'https://console.exemple.test',
      attendre: async (ms: number) => { t += ms; },
      maintenant: () => t,
      ouvrirPortail: async (tenant: string, payeur: string) => {
        portails.push({ tenant, payeur });
        return o.portail ?? { ok: true as const, valeur: { url: 'https://billing.stripe.com/p/session/x' } };
      },
      abonnement: async () => (o.abonnement === undefined ? null : o.abonnement),
      ouvrirAbonnement: async (tenant: string, payeur: string) => {
        paiements.push({ tenant, payeur });
        return { ok: true as const, valeur: { url: 'https://checkout.stripe.com/c/pay/cs_reabo' } };
      },
      suiteDuPro: async () => null,
      rendreLeNumero: async (tenant: string, rendre: boolean) => { rendus.push({ tenant, rendre }); return o.proVivant ?? true; },
    },
    couteux: { consommer: async (tenant: string) => { couteux.push(tenant); return { accepte: true, attenteMs: 0 }; } },
  } as unknown as DepsMcp;
  return { deps, lectures, debut: t, portails, couteux, paiements, rendus, destinations };
}

describe('start_whatsapp_connection', () => {
  it('rend un lien vers /brancher, le jeton APRÈS le #, signé pour cet espace, cette personne et ce mode', async () => {
    const { deps, debut } = monter(() => VIDE);
    const r = await outil('start_whatsapp_connection').executer(deps, 't1', { mode: 'fourni' }, PERSONNE) as Record<string, string>;
    const [base, jeton] = r.url!.split('#');
    expect(base).toBe('https://console.exemple.test/brancher');
    expect(await verifyLienNumero(jeton!, SECRET)).toEqual({ tenantId: 't1', userId: 'u-admin', mode: 'fourni', emisLe: expect.any(Number) });
    expect(r.expire_le).toBe(new Date(debut + DUREE_LIEN_NUMERO_MS).toISOString());
    expect(typeof r.consigne).toBe('string');
  });

  it('🔴 J4 : à un espace en Pro, Claude ne fait pas payer le numéro fourni ; hors Pro, il dit le prix', async () => {
    const pro = monter(() => ({ ...VIDE, inclusDansLePro: true })).deps;
    const enPro = await outil('start_whatsapp_connection').executer(pro, 't1', { mode: 'fourni' }, PERSONNE) as Record<string, string>;
    expect(enPro.consigne).toMatch(/inclus/);
    expect(enPro.consigne).not.toMatch(/3,50|Payer/);
    const base = monter(() => VIDE).deps;
    const horsPro = await outil('start_whatsapp_connection').executer(base, 't1', { mode: 'fourni' }, PERSONNE) as Record<string, string>;
    expect(horsPro.consigne).toMatch(/Payer 3,50 € HT par mois/);
    // La description le dit aussi, avant même l'appel.
    expect(outil('start_whatsapp_connection').description).toMatch(/Pro/);
  });

  it('🔴 essai 99 : la consigne exige le lien EN ENTIER, hors bloc de code, et la page gardée ouverte jusqu’au bout', async () => {
    for (const mode of ['fourni', 'apporte'] as const) {
      const { deps } = monter(() => VIDE);
      const r = await outil('start_whatsapp_connection').executer(deps, 't1', { mode }, PERSONNE) as Record<string, string>;
      // Claude avait écrit « j'ai généré le lien » sans le lien : la personne ne voit pas le résultat de l'outil.
      expect(r.consigne).toMatch(/en entier/i);
      expect(r.consigne).toMatch(/bloc de code/);
      expect(r.consigne).toMatch(/ouverte jusqu’au bout/);
      expect(r.consigne).toMatch(/fenêtre de Meta/);
    }
  });

  it('🔴 numéro API (fourni, apporte) : la fenêtre de Meta sur le profil Facebook, le compte créé en chemin, qui paie, avant le lien', async () => {
    for (const mode of ['fourni', 'apporte'] as const) {
      const { deps } = monter(() => VIDE);
      const r = await outil('start_whatsapp_connection').executer(deps, 't1', { mode }, PERSONNE) as Record<string, string>;
      const c = r.consigne!;
      expect(c, mode).toMatch(/profil Facebook/);
      expect(c, mode).toMatch(/en chemin/);
      expect(c, mode).toContain(CE_QUI_EST_FACTURE.api.fr);
      expect(c.indexOf(CE_QUI_EST_FACTURE.api.fr), mode).toBeLessThan(c.indexOf(r.url!));
    }
  });

  it('🔴 numéro fourni : ce qu’est le code de vérification, et pourquoi il arrive chez nous ; pas pour son propre numéro', async () => {
    const fourni = await outil('start_whatsapp_connection').executer(monter(() => VIDE).deps, 't1', { mode: 'fourni' }, PERSONNE) as Record<string, string>;
    expect(fourni.consigne).toContain(CODE_VERIFICATION_FOURNI.fr);
    const apporte = await outil('start_whatsapp_connection').executer(monter(() => VIDE).deps, 't1', { mode: 'apporte' }, PERSONNE) as Record<string, string>;
    expect(apporte.consigne).not.toContain(CODE_VERIFICATION_FOURNI.fr);
  });

  it('🔴 onboarding du 2026-11-07 : la consigne porte l’adresse elle-même, dans les quatre modes', async () => {
    for (const mode of ['fourni', 'apporte', 'coexistence', 'fourni_application'] as const) {
      const { deps } = monter(() => VIDE);
      const r = await outil('start_whatsapp_connection').executer(deps, 't1', { mode }, PERSONNE) as Record<string, string>;
      expect(r.consigne, mode).toContain(r.url!);
    }
  });

  it('le mode apporté est porté par le jeton, et sa consigne parle de l’application WhatsApp', async () => {
    const { deps } = monter(() => VIDE);
    const r = await outil('start_whatsapp_connection').executer(deps, 't1', { mode: 'apporte' }, PERSONNE) as Record<string, string>;
    expect((await verifyLienNumero(r.url!.split('#')[1]!, SECRET))?.mode).toBe('apporte');
    // La description est en anglais depuis le 2026-10-14 (répertoire de Claude).
    expect(outil('start_whatsapp_connection').description).toMatch(/WhatsApp app/);
  });

  it('🔴 refuse quand un numéro est déjà connecté, et un mode inconnu', async () => {
    const { deps } = monter(() => ({ ...VIDE, connecte: { chiffres: '33600000000', aActiver: false } }));
    await expect(outil('start_whatsapp_connection').executer(deps, 't1', { mode: 'fourni' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    const vide = monter(() => VIDE).deps;
    await expect(outil('start_whatsapp_connection').executer(vide, 't1', { mode: 'autre' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
  });
});

describe('watch_whatsapp_connection', () => {
  const ATTRIBUE: EtatConnexion = { ...VIDE, fourni: '+441235619343' };
  const AVEC_CODE: EtatConnexion = { ...ATTRIBUE, code: { code: '123456', recuLe: '2026-10-06T08:53:01.000Z' } };

  it('sans état connu : rend tout de suite, une seule lecture', async () => {
    const { deps, lectures } = monter(() => ATTRIBUE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(lectures).toHaveLength(1);
    expect(r.change).toBe(true);
    expect(r.empreinte).toBe(empreinteEtat(ATTRIBUE));
  });

  it('rend dès que l’état change, avec le code en clair pour que Claude l’affiche', async () => {
    const { deps, debut } = monter((t) => (t >= 1_000_000 + 6_000 ? AVEC_CODE : ATTRIBUE));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', { etat_connu: empreinteEtat(ATTRIBUE) }, PERSONNE) as Record<string, unknown>;
    expect(r.change).toBe(true);
    expect(r.code).toBe('123456');
    expect(r.empreinte).toBe(empreinteEtat(AVEC_CODE));
    expect(deps.numero.maintenant() - debut).toBe(6_000);
  });

  it(`🔴 sans changement : rend au plus tard à ${DELAI_ATTENTE_MS / 1000} s, sans aucune lecture au-delà`, async () => {
    const { deps, lectures, debut } = monter(() => ATTRIBUE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', { etat_connu: empreinteEtat(ATTRIBUE) }, PERSONNE) as Record<string, unknown>;
    expect(r.change).toBe(false);
    expect(lectures.every((l) => l.t - debut <= DELAI_ATTENTE_MS)).toBe(true);
    expect(deps.numero.maintenant() - debut).toBeLessThanOrEqual(DELAI_ATTENTE_MS);
    expect(lectures.length).toBe(Math.floor(DELAI_ATTENTE_MS / PAS_ATTENTE_MS) + 1);
    expect(lectures.every((l) => l.tenant === 't1')).toBe(true);
  });

  it('le délai passe sous les 45 s du proxy de l’API, avec de la marge', () => {
    expect(DELAI_ATTENTE_MS).toBeLessThanOrEqual(30_000);
  });

  it('🔴 essai 99 : numéro attribué sans code, la suite dit où être (la page, la fenêtre de Meta, CE numéro)', async () => {
    const { deps } = monter(() => ATTRIBUE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(String(r.suite)).toMatch(/\+441235619343/);
    expect(String(r.suite)).toMatch(/fenêtre de Meta/);
    expect(String(r.suite)).toMatch(/etat_connu/);
  });

  it('🔴 essai 99 : le code arrivé, la suite dit de le lire à la personne pour la fenêtre de Meta', async () => {
    const { deps } = monter(() => AVEC_CODE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(r.code).toBe('123456');
    expect(String(r.suite)).toMatch(/code/);
    expect(String(r.suite)).toMatch(/fenêtre de Meta/);
  });

  it('🔴 essai 99 : connecté, la suite fait relire get_setup_state (Claude annonçait 0 € après le crédit offert)', async () => {
    const { deps } = monter(() => ({ ...ATTRIBUE, connecte: { chiffres: '441235619343', aActiver: false } }));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(String(r.suite)).toMatch(/get_setup_state/);
    // Le crédit offert est écrit quelques secondes APRÈS la liaison (relecture du lot) : une seconde lecture.
    expect(String(r.suite)).toMatch(/quelques secondes/);
  });

  it('🟡 payé, la réserve vidée entre-temps : la suite dit « en préparation », jamais « rien n’a bougé »', async () => {
    const { deps } = monter(() => ({ ...VIDE, abonnement: { statut: 'actif', periodeFin: '2026-11-13T09:00:00.000Z' } }));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(String(r.suite)).toMatch(/préparation/);
    expect(String(r.suite)).not.toMatch(/Rien n’a encore bougé/);
  });

  it('rien encore : la suite dit de redonner le lien et ses étapes si la personne revient', async () => {
    const { deps } = monter(() => VIDE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(String(r.suite)).toMatch(/lien/);
    expect(String(r.suite)).toMatch(/etat_connu/);
  });

  /**
   * L'onboarding du 2026-11-07 : Claude a dit « ce lien expire à 19 h 19, je surveille », sans jamais écrire le lien, et
   * a tourné 2 min 30 dans l'attente. Tant que rien n'a bougé, l'attente redonne un lien neuf et exige qu'il soit écrit.
   */
  it('🔴 rien n’a bougé, mode passé : l’attente rend un lien neuf, pour cet espace, cette personne et ce mode', async () => {
    // Un numéro fourni : start_whatsapp_connection a retenu sa destination (0280), que le lien neuf suit.
    const cas = [
      ['coexistence', VIDE], ['apporte', VIDE],
      ['fourni', { ...VIDE, destination: 'api' }], ['fourni_application', { ...VIDE, destination: 'application' }],
    ] as const;
    for (const [mode, etat] of cas) {
      const { deps } = monter(() => etat);
      const r = await outil('watch_whatsapp_connection').executer(deps, 't1', { mode }, PERSONNE) as { lien: string | null; suite: string };
      expect(r.lien, mode).toMatch(/^https:\/\/console\.exemple\.test\/brancher#/);
      expect(await verifyLienNumero(r.lien!.split('#')[1]!, SECRET), mode)
        .toEqual({ tenantId: 't1', userId: 'u-admin', mode, emisLe: expect.any(Number) });
      expect(r.suite, mode).toContain(r.lien!);
      expect(r.suite, mode).toMatch(/ne voit pas/);
      // Pas de répétition à chaque tour : seulement si son dernier message ne contenait aucun lien de connexion, et
      // chaque réponse en porte un neuf qui vaut les précédents.
      expect(r.suite, mode).toMatch(/dernier message/);
      expect(r.suite, mode).toMatch(/ils se valent/);
    }
  });

  /**
   * Jaune 1 de la relecture du lot 1 : l'attente signait des liens que start_whatsapp_connection refuse, ou d'un autre
   * mode que celui que la suite suit. Un lien de la fenêtre de Meta pendant que la suite dit de taper le code dans
   * l'application, c'est un code perdu (une demande de plus sur les dix que Meta tolère en 72 heures).
   */
  it('🔴 jamais de lien neuf que start refuserait, ni d’un autre mode que la destination retenue : le rappel seul', async () => {
    const refus: Array<[Record<string, unknown>, EtatConnexion]> = [
      [{ mode: 'coexistence', filiere: 'application' }, VIDE],
      [{ mode: 'fourni_application', filiere: 'application' }, VIDE],
      [{ mode: 'apporte', filiere: 'application' }, VIDE],
      [{ mode: 'fourni', filiere: 'application' }, VIDE],
      [{ mode: 'fourni' }, { ...VIDE, destination: 'application' }],
      [{ mode: 'fourni_application' }, { ...VIDE, destination: 'api' }],
      [{ mode: 'fourni' }, VIDE],
      [{ mode: 'coexistence' }, { ...VIDE, destination: 'api' }],
      [{ mode: 'apporte' }, { ...VIDE, destination: 'application' }],
      [{ mode: 'inconnu' }, VIDE],
    ];
    for (const [args, etat] of refus) {
      const { deps } = monter(() => etat);
      const r = await outil('watch_whatsapp_connection').executer(deps, 't1', args, PERSONNE) as { lien: string | null; suite: string };
      expect(r.lien, JSON.stringify([args, etat.destination])).toBeNull();
      // Le rappel reste : il renvoie au lien de start_whatsapp_connection.
      expect(r.suite, JSON.stringify(args)).toMatch(/start_whatsapp_connection t’a rendu/);
    }
    expect(modeDuLienNeuf({}, 'api', 'coexistence')).toBe('coexistence');
    expect(modeDuLienNeuf({ destination: 'api' }, 'api', 'fourni')).toBe('fourni');
    expect(modeDuLienNeuf({ destination: 'application' }, 'api', 'fourni_application')).toBe('fourni_application');
  });

  it('🔴 rien n’a bougé, sans mode (un plugin 0.3.28) : pas de lien neuf, la suite renvoie à celui de start_whatsapp_connection', async () => {
    const { deps } = monter(() => VIDE);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as { lien: string | null; suite: string };
    expect(r.lien).toBeNull();
    expect(r.suite).toMatch(/start_whatsapp_connection/);
    expect(r.suite).toMatch(/en entier/i);
    expect(r.suite).toMatch(/dernier message/);
  });

  it('🔴 dès qu’un signe arrive (numéro attribué, code, numéro connecté, paiement), plus de lien ni de rappel', async () => {
    const signes: EtatConnexion[] = [
      ATTRIBUE, AVEC_CODE,
      { ...ATTRIBUE, connecte: { chiffres: '441235619343', aActiver: false } },
      { ...VIDE, abonnement: { statut: 'actif', periodeFin: '2026-11-13T09:00:00.000Z' } },
    ];
    for (const etat of signes) {
      const { deps } = monter(() => etat);
      const r = await outil('watch_whatsapp_connection').executer(deps, 't1', { mode: 'fourni' }, PERSONNE) as { lien: string | null; suite: string };
      expect(r.lien).toBeNull();
      expect(r.suite).not.toMatch(/ne voit pas/);
    }
  });

  it('🔴 relié mais pas encore activé par Meta : ni « connecté » ni « fini », et Claude le dit', async () => {
    const { deps } = monter(() => ({ ...ATTRIBUE, connecte: { chiffres: '441235619343', aActiver: true } }));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(r.etat).toMatchObject({ connecte: false, a_activer: true });
    expect(String(r.suite)).toMatch(/activ/);
    expect(String(r.suite)).not.toMatch(/fini/);
  });

  it('le paiement confirmé réveille l’attente, et l’état dit l’abonnement et sa prochaine échéance', async () => {
    const PAYE: EtatConnexion = { ...VIDE, abonnement: { statut: 'actif', periodeFin: '2026-11-06T09:00:00.000Z' } };
    const { deps } = monter((t) => (t >= 1_000_000 + 4_000 ? PAYE : VIDE));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', { etat_connu: empreinteEtat(VIDE) }, PERSONNE) as Record<string, unknown>;
    expect(r.change).toBe(true);
    expect(r.etat).toMatchObject({ abonnement: 'actif', prochaine_echeance: '2026-11-06T09:00:00.000Z' });
  });

  it('pas de code tant qu’il n’est pas arrivé ; le numéro connecté est dit', async () => {
    const { deps } = monter(() => ({ ...ATTRIBUE, connecte: { chiffres: '441235619343', aActiver: false } }));
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(r.code).toBeNull();
    expect(r.etat).toMatchObject({ numero_fourni: '+441235619343', numero_connecte: '+441235619343', connecte: true, a_activer: false });
  });
});

describe('les outils de l’abonnement du numéro (livraison B)', () => {
  it('get_number_subscription : le statut, la prochaine échéance, le numéro fourni ; et sans abonnement, null', async () => {
    const { deps } = monter(() => ({ ...VIDE, fourni: '+441235619343', abonnement: { statut: 'en_retard', periodeFin: '2026-11-06T09:00:00.000Z' } }));
    expect(await outil('get_number_subscription').executer(deps, 't1', {}, null))
      .toEqual({
        abonnement: 'en_retard', prochaine_echeance: '2026-11-06T09:00:00.000Z', numero_fourni: '+441235619343', prix: '3,50 € HT par mois',
        inclus_dans_le_pro: false, etat: null, fin_prevue: null, coupure_le: null, liberation_le: null,
      });
    const sans = monter(() => VIDE).deps;
    expect(await outil('get_number_subscription').executer(sans, 't1', {}, null)).toMatchObject({ abonnement: null, prochaine_echeance: null });
  });

  it('🔴 J4 : en Pro, get_number_subscription dit que le numéro est inclus, sans prix ; l’état de la connexion aussi', async () => {
    const { deps } = monter(() => ({ ...VIDE, fourni: '+441235619343', inclusDansLePro: true }));
    expect(await outil('get_number_subscription').executer(deps, 't1', {}, null))
      .toMatchObject({ abonnement: null, inclus_dans_le_pro: true, prix: 'inclus en formule Pro' });
    expect(outil('get_number_subscription').description).toMatch(/inclus_dans_le_pro/);
    const r = await outil('watch_whatsapp_connection').executer(deps, 't1', {}, PERSONNE) as Record<string, unknown>;
    expect(r.etat).toMatchObject({ inclus_dans_le_pro: true });
  });

  it('🔴 manage_number_subscription : le portail de Stripe au nom de la personne, compté dans les opérations lourdes', async () => {
    const { deps, portails, couteux } = monter(() => VIDE);
    expect(await outil('manage_number_subscription').executer(deps, 't1', {}, PERSONNE)).toEqual({ url: 'https://billing.stripe.com/p/session/x' });
    expect(portails).toEqual([{ tenant: 't1', payeur: 'u-admin' }]);
    expect(couteux).toEqual(['t1']);
    const refus = monter(() => VIDE, { portail: { ok: false, statut: 409, erreur: 'Cet espace n’a aucun abonnement à gérer.' } }).deps;
    await expect(outil('manage_number_subscription').executer(refus, 't1', {}, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
  });

  it('🔴 manage exige une personne ; get se lit avec une clé', () => {
    expect(outil('manage_number_subscription')).toMatchObject({ scope: 'mcp:write', exigePersonne: true });
    expect(outil('get_number_subscription')).toMatchObject({ scope: 'mcp:read' });
    expect(outil('get_number_subscription').exigePersonne).toBeUndefined();
  });
});

const DATE = (iso: string) => new Date(iso);
const etatAbo = (e: Partial<EtatDeLEspace>): EtatDeLEspace => ({
  abonnementId: 'sub_1', etat: 'actif', finPrevueLe: null, liberationLe: null, coupureLe: null, finiLe: null, libereLe: null, ...e,
});

describe('le lot 4 : l’état de l’abonnement pour Claude, et le réabonnement', () => {
  it('get_number_subscription dit l’état et ses dates (coupure, fin prévue, libération)', async () => {
    const { deps } = monter(() => VIDE, { abonnement: etatAbo({ etat: 'suspendu', finiLe: DATE('2026-10-06T15:14:51Z'), liberationLe: DATE('2026-10-13T15:14:51Z') }) });
    expect(await outil('get_number_subscription').executer(deps, 't1', {}, null)).toMatchObject({
      etat: 'suspendu', liberation_le: '2026-10-13T15:14:51.000Z', coupure_le: null, fin_prevue: null,
    });
  });

  it('🔴 resubscribe_number : abonnement FINI, numéro gardé -> un nouveau paiement, au nom de la personne, compté', async () => {
    const { deps, paiements, portails, couteux } = monter(() => VIDE, { abonnement: etatAbo({ etat: 'suspendu', finiLe: DATE('2026-10-06T15:14:51Z') }) });
    const r = await outil('resubscribe_number').executer(deps, 't1', {}, PERSONNE) as Record<string, string>;
    expect(r.url).toBe('https://checkout.stripe.com/c/pay/cs_reabo');
    expect(paiements).toEqual([{ tenant: 't1', payeur: 'u-admin' }]);
    expect(portails).toEqual([]);
    expect(couteux).toEqual(['t1']);
  });

  it('resubscribe_number : impayé (en retard ou suspendu sans fin) ou fin prévue -> le portail', async () => {
    for (const e of [etatAbo({ etat: 'en_retard' }), etatAbo({ etat: 'suspendu' }), etatAbo({ etat: 'fin_prevue', finPrevueLe: DATE('2026-11-06T00:00:00Z') })]) {
      const { deps, portails, paiements } = monter(() => VIDE, { abonnement: e });
      expect((await outil('resubscribe_number').executer(deps, 't1', {}, PERSONNE) as Record<string, string>).url).toBe('https://billing.stripe.com/p/session/x');
      expect([portails.length, paiements.length]).toEqual([1, 0]);
    }
  });

  it('resubscribe_number : actif, libéré, ou aucun abonnement -> un refus qui dit quoi faire', async () => {
    for (const [e, motif] of [[etatAbo({ etat: 'actif' }), /actif/], [etatAbo({ etat: 'libere' }), /start_whatsapp_connection/], [null, /start_whatsapp_connection/]] as const) {
      const { deps } = monter(() => VIDE, { abonnement: e });
      await expect(outil('resubscribe_number').executer(deps, 't1', {}, PERSONNE)).rejects.toThrow(motif);
    }
  });

  it('🔴 resubscribe_number exige une personne (le paiement est son geste)', () => {
    expect(outil('resubscribe_number')).toMatchObject({ scope: 'mcp:write', exigePersonne: true });
  });

  it('le rappel : en retard, avec la date de coupure ; suspendu, avec la libération si le numéro est gardé ; sinon rien', () => {
    expect(rappelDeLAbonnement(etatAbo({ etat: 'en_retard', coupureLe: DATE('2026-10-20T10:00:00Z') }))).toMatch(/2026-10-20/);
    expect(rappelDeLAbonnement(etatAbo({ etat: 'suspendu', finiLe: DATE('2026-10-06T15:14:51Z'), liberationLe: DATE('2026-10-13T15:14:51Z') }))).toMatch(/coupés[\s\S]*2026-10-13/);
    expect(rappelDeLAbonnement(etatAbo({ etat: 'suspendu' }))).toMatch(/resubscribe_number/);
    for (const e of [null, etatAbo({ etat: 'actif' }), etatAbo({ etat: 'fin_prevue' }), etatAbo({ etat: 'libere' })]) {
      expect(rappelDeLAbonnement(e)).toBeNull();
    }
  });

  it('🔴 en retard SANS date de coupure (un autre numéro envoie, rien ne sera coupé) : aucune date inventée', () => {
    const r = rappelDeLAbonnement(etatAbo({ etat: 'en_retard', coupureLe: null }));
    expect(r).toMatch(/resubscribe_number/);
    expect(r).not.toMatch(/coupés|bientôt/);
  });

  it('🔴 get_number_subscription répond même si la lecture de l’état échoue (jaune 7 de A)', async () => {
    const { deps } = monter(() => VIDE);
    deps.numero = { ...deps.numero, abonnement: async () => { throw new Error('pooler injoignable'); } };
    expect(await outil('get_number_subscription').executer(deps, 't1', {}, null)).toMatchObject({ etat: null, liberation_le: null });
  });
});

describe('les deux outils dans le catalogue', () => {
  it('🔴 écritures qui exigent une personne : invisibles avec une clé d’API', () => {
    for (const nom of ['start_whatsapp_connection', 'watch_whatsapp_connection']) {
      expect(outil(nom).scope).toBe('mcp:write');
      expect(outil(nom).exigePersonne).toBe(true);
    }
    const avecCle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    expect(avecCle).not.toContain('start_whatsapp_connection');
    expect(avecCle).not.toContain('watch_whatsapp_connection');
  });

  it('les bornes de l’empreinte sont annoncées dans le schéma', () => {
    const p = outil('watch_whatsapp_connection').entree.properties.etat_connu!;
    expect(p.maxLength).toBe(16);
    expect(p.pattern).toBe('^[0-9a-f]{16}$');
    expect(outil('start_whatsapp_connection').entree.properties.mode!.enum).toEqual(['fourni', 'apporte', 'coexistence', 'fourni_application']);
  });
});

/**
 * LA COEXISTENCE PAR CLAUDE (plan `docs/superpowers/plans/2026-10-24-coexistence.md`, tâche 4) : le numéro de
 * l'application WhatsApp Business de la personne, gardé dans l'application. Le seul mode accepté sur un espace relié par
 * QR code : c'est son passage à l'API, sur le même numéro.
 */
describe('start_whatsapp_connection en coexistence', () => {
  /** Un espace relié par QR code : son compte de l'application vaut « connecté », sous son numéro. */
  const QR_CODE: EtatConnexion = {
    ...VIDE, connecte: { chiffres: '441555479304', aActiver: false }, application: { statut: 'relie', numero: '441555479304' },
  };
  const demarrer = (etat: EtatConnexion, args: Record<string, unknown>) =>
    outil('start_whatsapp_connection').executer(monter(() => etat).deps, 't1', args, PERSONNE) as Promise<Record<string, string>>;

  it('🔴 accepté sur un espace relié par QR code : le jeton porte le mode, sans filière', async () => {
    const r = await demarrer(QR_CODE, { mode: 'coexistence' });
    expect(await verifyLienNumero(r.url!.split('#')[1]!, SECRET)).toEqual({ tenantId: 't1', userId: 'u-admin', mode: 'coexistence', emisLe: expect.any(Number) });
  });

  it('accepté sur un espace sans rien, et avec la filière « api » dite', async () => {
    expect((await demarrer(VIDE, { mode: 'coexistence' })).url).toMatch(/\/brancher#/);
    expect((await demarrer(VIDE, { mode: 'coexistence', filiere: 'api' })).url).toMatch(/\/brancher#/);
  });

  it('🔴 la consigne : le lien en entier, la fenêtre de Meta et l’application, ce qui est facturé, et l’attente en coexistence', async () => {
    const { consigne } = await demarrer(VIDE, { mode: 'coexistence' });
    expect(consigne).toMatch(/en entier/i);
    expect(consigne).toMatch(/bloc de code/);
    // La fenêtre de Meta et l'application : ses cinq temps, dont le profil Facebook, le compte créé en chemin et le QR code.
    for (const e of ETAPES_FENETRE_GARDER) expect(consigne).toContain(e.fr);
    // Et le numéro y reste (gardé de l'ancienne version de ce test, jaune 8 de la relecture du lot 1).
    expect(consigne).toMatch(/son numéro reste dans l’application/);
    // Ce qui est facturé : ce qu'elle tape reste gratuit, ce que Messaging Me envoie est facturé par Meta.
    expect(consigne).toContain(CE_QUI_EST_FACTURE.application.fr);
    expect(consigne).toMatch(/watch_whatsapp_connection avec mode égal à « coexistence »/);
    // Le prérequis du numéro n'est pas dit : le numéro de l'application est déjà choisi.
    expect(consigne).not.toContain(PREREQUIS_META[2]!.fr);
  });

  /**
   * L'onboarding du 2026-11-07 : Claude a dit « avec l'app, Meta facture forcément sur ta carte », comme si tout était
   * payant, et n'a rien annoncé de la fenêtre de Meta. Julien : expliquer le déroulé AVANT, et nuancer qui paie.
   */
  it('🔴 avant le lien : ce qui va se passer, puis qui paie (la nuance AVANT la note sur la carte), puis le mode op', async () => {
    const r = await demarrer(VIDE, { mode: 'coexistence' });
    const c = r.consigne!;
    const lien = c.indexOf(r.url!);
    expect(c.indexOf(ETAPES_FENETRE_GARDER[0]!.fr)).toBeLessThan(lien);
    expect(c.indexOf(CE_QUI_EST_FACTURE.application.fr)).toBeLessThan(lien);
    expect(c.indexOf(CE_QUI_EST_FACTURE.application.fr)).toBeLessThan(c.indexOf(NOTE_CARTE_APPLICATION.fr));
    expect(c).toContain(AIDE_GARDER_APPLICATION.fr);
    expect(c).toContain(AIDE_GARDER_APPLICATION.en);
    // La personne peut demander les étapes de la carte : Claude les a sous la main.
    expect(c).toContain(ETAPES_CARTE_META[0]!.fr);
  });

  it('🔴 refusé avec la filière application : la coexistence est l’API officielle', async () => {
    await expect(demarrer(QR_CODE, { mode: 'coexistence', filiere: 'application' })).rejects.toThrow('coexistence : la filière est « api »');
  });

  it('🔴 refusé quand un numéro de Meta est relié, activé ou non (le message d’aujourd’hui)', async () => {
    await expect(demarrer({ ...VIDE, connecte: { chiffres: '33600000000', aActiver: false } }, { mode: 'coexistence' }))
      .rejects.toThrow('Cet espace a déjà un numéro WhatsApp connecté : il n’y a rien à brancher.');
    await expect(demarrer({ ...VIDE, connecte: { chiffres: '33600000000', aActiver: true } }, { mode: 'coexistence' }))
      .rejects.toThrow(/Activer le numéro/);
  });

  it('🔴 fourni et apporte restent refusés sur un espace relié par QR code', async () => {
    for (const mode of ['fourni', 'apporte'] as const) {
      await expect(demarrer(QR_CODE, { mode }), mode).rejects.toThrow('Cet espace a déjà un numéro WhatsApp connecté');
    }
  });

  it('la description le dit, en anglais comme les autres modes', () => {
    const d = outil('start_whatsapp_connection');
    expect(d.description).toContain('`coexistence`: the person\'s own number, kept in the WhatsApp Business app on their phone; '
      + 'messages sent through Messaging Me are official templates billed by Meta, those typed in the app stay free');
    expect(d.entree.properties.mode!.description).toMatch(/coexistence/);
  });
});

describe('watch_whatsapp_connection en coexistence', () => {
  const EN_COEXISTENCE: EtatConnexion = { ...VIDE, connecte: { chiffres: '441555479304', aActiver: false, coexistence: true } };
  const QR_CODE: EtatConnexion = {
    ...VIDE, connecte: { chiffres: '441555479304', aActiver: false }, application: { statut: 'relie', numero: '441555479304' },
  };
  const attendre = (etat: EtatConnexion, args: Record<string, unknown> = {}) =>
    outil('watch_whatsapp_connection').executer(monter(() => etat).deps, 't1', args, PERSONNE) as Promise<{ etat: Record<string, unknown>; suite: string }>;

  it('🔴 relié en coexistence : l’état le rend (coexistence: true), et la suite est celle d’un numéro connecté', async () => {
    const r = await attendre(EN_COEXISTENCE, { mode: 'coexistence' });
    expect(r.etat).toMatchObject({ connecte: true, coexistence: true, numero_connecte: '+441555479304' });
    expect(r.suite).toMatch(/get_setup_state/);
    // Sans le mode aussi : c'est l'état, pas la question.
    expect((await attendre(EN_COEXISTENCE)).etat).toMatchObject({ coexistence: true });
  });

  it('🔴 en mode coexistence, encore relié par QR code : ni « fini », ni la suite du QR code', async () => {
    const r = await attendre(QR_CODE, { mode: 'coexistence' });
    expect(r.etat).toMatchObject({ coexistence: false });
    expect(r.suite).not.toMatch(/fini/);
    expect(r.suite).toMatch(/coexistence vaut true/);
    expect(r.suite).toMatch(/etat_connu/);
    // L'appareil que WhatsApp vient de délier en chemin ne fait pas redonner un QR code.
    const delie = await attendre({ ...QR_CODE, connecte: null, application: { statut: 'deconnecte', numero: '441555479304' } }, { mode: 'coexistence' });
    expect(delie.suite).not.toMatch(/filiere « application »/);
    expect(delie.suite).toMatch(/coexistence vaut true/);
  });

  it('🔴 un espace relié par QR code qui passe en garder l’application : l’attente porte aussi le lien neuf', async () => {
    const r = await attendre(QR_CODE, { mode: 'coexistence' }) as unknown as { lien: string | null; suite: string };
    expect(r.lien).toMatch(/\/brancher#/);
    expect(r.suite).toContain(r.lien!);
  });

  it('hors mode coexistence, la suite du QR code est celle d’aujourd’hui', async () => {
    expect((await attendre(QR_CODE)).suite).toMatch(/branchement est fini/);
  });

  it('🔴 plus aucun nouveau QR code proposé (2026-10-30) : un appareil retiré ou endormi garde l’application, par Meta', async () => {
    for (const statut of ['deconnecte', 'sommeil'] as const) {
      const { suite } = await attendre({ ...QR_CODE, connecte: null, application: { statut, numero: '441555479304' } });
      expect(suite, statut).not.toMatch(/filiere « application »/);
      expect(suite, statut).toMatch(/mode « coexistence »/);
    }
    const banni = await attendre({ ...QR_CODE, connecte: null, application: { statut: 'banni', numero: '441555479304' } });
    expect(banni.suite).toMatch(/fenêtre de Meta/);
    // Ce que Claude lit de la filière : ne jamais la proposer.
    const filiere = (outil('start_whatsapp_connection').entree as { properties: Record<string, { description: string }> }).properties.filiere!;
    expect(filiere.description).toMatch(/no longer offered: never propose it/);
  });

  it('🔴 l’empreinte change quand la coexistence arrive, et pas autrement', () => {
    const ordinaire: EtatConnexion = { ...VIDE, connecte: { chiffres: '441555479304', aActiver: false } };
    expect(empreinteEtat(EN_COEXISTENCE)).not.toBe(empreinteEtat(ordinaire));
    expect(empreinteEtat({ ...ordinaire })).toBe(empreinteEtat(ordinaire));
  });
});

/** Le numéro inclus dans le Pro (lot 6, B2b) : la suite que Claude rappelle, et le choix de rendre le numéro. */
describe('le numéro inclus dans le Pro', () => {
  const FIN = new Date('2026-11-08T10:00:00Z');

  it('🔴 le rappel : un Pro qui finit annonce le numéro à 3,50 € HT par mois sur la même carte, ou rendu ; rien sans fin', () => {
    expect(rappelDeLaSuiteDuPro(null)).toBeNull();
    expect(rappelDeLaSuiteDuPro({ finPrevueLe: null, rendreNumero: false })).toBeNull();
    const garde = rappelDeLaSuiteDuPro({ finPrevueLe: FIN, rendreNumero: false })!;
    expect(garde).toMatch(/2026-11-08/);
    expect(garde).toMatch(/3,50 € HT par mois/);
    expect(garde).toMatch(/return_number_at_plan_end/);
    const rendu = rappelDeLaSuiteDuPro({ finPrevueLe: FIN, rendreNumero: true })!;
    expect(rendu).toMatch(/rendu/);
    expect(rendu).not.toMatch(/3,50/);
  });

  it('🔴 return_number_at_plan_end pose puis retire le choix sur l’espace de la personne', async () => {
    const { deps, rendus } = monter(() => VIDE);
    expect(await outil('return_number_at_plan_end').executer(deps, 't1', { rendre: true }, PERSONNE)).toMatchObject({ rendre_numero: true });
    expect(await outil('return_number_at_plan_end').executer(deps, 't1', { rendre: false }, PERSONNE)).toMatchObject({ rendre_numero: false });
    expect(rendus).toEqual([{ tenant: 't1', rendre: true }, { tenant: 't1', rendre: false }]);
  });

  it('sans Pro en cours, ou sans booléen : un refus qui le dit, rien d’écrit', async () => {
    const sansPro = monter(() => VIDE, { proVivant: false });
    await expect(outil('return_number_at_plan_end').executer(sansPro.deps, 't1', { rendre: true }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    const m = monter(() => VIDE);
    await expect(outil('return_number_at_plan_end').executer(m.deps, 't1', { rendre: 'oui' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    expect(m.rendus).toEqual([]);
  });

  it('une écriture qui exige une personne : invisible avec une clé d’API', () => {
    expect(outil('return_number_at_plan_end')).toMatchObject({ scope: 'mcp:write', exigePersonne: true, fonction: null });
  });
});

/**
 * LE NUMÉRO FOURNI MIS DANS L'APPLICATION (plan `docs/superpowers/plans/2026-10-31-numero-fourni-dans-application.md`,
 * décision de Julien) : le payer ou l'obtenir, créer avec lui le compte de l'application WhatsApp Business (le code
 * s'affiche sur la page et arrive ici), puis la fenêtre de Meta en coexistence sur ce même numéro.
 */
describe('le mode fourni_application', () => {
  const demarrer = (etat: EtatConnexion, args: Record<string, unknown>) =>
    outil('start_whatsapp_connection').executer(monter(() => etat).deps, 't1', args, PERSONNE) as Promise<Record<string, string>>;
  const attendre = (etat: EtatConnexion) =>
    outil('watch_whatsapp_connection').executer(monter(() => etat).deps, 't1', { mode: 'fourni_application' }, PERSONNE) as Promise<{ suite: string; code: string | null }>;
  const FOURNI: EtatConnexion = { ...VIDE, fourni: '+441235619343', abonnement: { statut: 'actif', periodeFin: null } };

  it('🔴 le lien porte le mode, et la consigne dit les étapes de la page : l’application, son code, puis la garder', async () => {
    const r = await demarrer(VIDE, { mode: 'fourni_application' });
    expect(await verifyLienNumero(r.url!.split('#')[1]!, SECRET)).toEqual({ tenantId: 't1', userId: 'u-admin', mode: 'fourni_application', emisLe: expect.any(Number) });
    for (const e of ETAPES_COMPTE_FOURNI) expect(r.consigne).toContain(e.fr);
    expect(r.consigne).toContain(`« ${COEXISTENCE_BOUTON.fr} »`);
    expect(r.consigne).toMatch(/Payer 3,50 € HT par mois/);
    // Le numéro tout neuf : répondre dès le premier jour, l'envoi attend quelques jours, sans chiffre.
    expect(r.consigne).toMatch(/dès le premier jour/i);
    expect(r.consigne).toMatch(/quelques jours/);
    expect(r.consigne).not.toMatch(/\d+ jours/);
    // Plus aucune voie par QR code (Julien, 2026-10-30) : ni les appareils connectés, ni la filière « application ». Le
    // QR code de la FENÊTRE DE META (garder l'application), lui, est annoncé depuis le lot 1 de l'aide à la connexion.
    for (const e of ETAPES_RELIER_APPLICATION) expect(r.consigne).not.toContain(e.fr);
    expect(r.consigne).not.toMatch(/filiere/);
    // Ni une reformulation du QR code de la PAGE (jaune 8) : seul celui de la fenêtre de Meta est annoncé.
    expect(r.consigne).not.toMatch(/QR code de la page|Nouveau QR code|Appareils connectés|Connecter un appareil/);
  });

  it('🔴 garder l’application, c’est payer Meta avec sa carte (lot C) : la phrase de la console, en fourni_application comme en coexistence', async () => {
    for (const mode of ['fourni_application', 'coexistence']) {
      const { consigne } = await demarrer(VIDE, { mode });
      expect(consigne, mode).toContain(`« ${NOTE_CARTE_APPLICATION.fr} »`);
    }
  });

  it('🔴 fourni dans l’application : le code expliqué, puis la fenêtre de Meta de l’application gardée, qui paie, et le mode op', async () => {
    const consigne = (await demarrer(VIDE, { mode: 'fourni_application' })).consigne!;
    expect(consigne).toContain(CODE_VERIFICATION_FOURNI.fr);
    for (const e of ETAPES_FENETRE_GARDER) expect(consigne).toContain(e.fr);
    expect(consigne).toContain(CE_QUI_EST_FACTURE.application.fr);
    expect(consigne.indexOf(CE_QUI_EST_FACTURE.application.fr)).toBeLessThan(consigne.indexOf(NOTE_CARTE_APPLICATION.fr));
    expect(consigne).toContain(AIDE_GARDER_APPLICATION.fr);
  });

  it('en Pro, le numéro est inclus : la consigne ne demande pas de payer', async () => {
    const { consigne } = await demarrer({ ...VIDE, inclusDansLePro: true }, { mode: 'fourni_application' });
    expect(consigne).toMatch(/inclus dans son offre/);
    expect(consigne).not.toMatch(/Payer/);
  });

  it('🔴 refusé sur la filière application, et sur un espace déjà connecté', async () => {
    await expect(demarrer(VIDE, { mode: 'fourni_application', filiere: 'application' })).rejects.toThrow(RefusOutil);
    await expect(demarrer({ ...VIDE, connecte: { chiffres: '441235619343', aActiver: false } }, { mode: 'fourni_application' })).rejects.toThrow(/déjà un numéro/);
  });

  it('🔴 le code se saisit dans l’application, pas dans la fenêtre de Meta ; puis « Garder mon application »', async () => {
    const r = await attendre({ ...FOURNI, code: { code: '345679', recuLe: '2026-10-31T10:00:00.000Z' } });
    expect(r.code).toBe('345679');
    expect(r.suite).toMatch(/dans l’application WhatsApp Business/);
    expect(r.suite).toMatch(/pas dans la fenêtre de Meta/);
    expect(r.suite).toContain(`« ${COEXISTENCE_BOUTON.fr} »`);
    expect(r.suite).not.toMatch(/Finish/);
  });

  it('le numéro attribué sans code : les étapes de l’application ; relié : le branchement est fini', async () => {
    const attribue = await attendre(FOURNI);
    for (const e of ETAPES_COMPTE_FOURNI) expect(attribue.suite).toContain(e.fr);
    const relie = await attendre({ ...FOURNI, connecte: { chiffres: '441235619343', aActiver: false, coexistence: true } });
    expect(relie.suite).toMatch(/branchement est fini/);
  });
});

/**
 * LA REPRISE D'UN NUMÉRO FOURNI MIS DANS L'APPLICATION (plan 2026-11-06). Vécu par Johan : son compte créé, le code passé
 * de 15 minutes, la suite lui redonnait les étapes de création du compte, et rien ne disait « garder l'application ». Le
 * serveur retient désormais la destination au lien et la relit, quel que soit le `mode` que Claude repasse.
 */
describe('la reprise d’un numéro fourni (Johan, 2026-11-06)', () => {
  const FOURNI: EtatConnexion = { ...VIDE, fourni: '+441235619343', abonnement: { statut: 'actif', periodeFin: null } };
  /** Le compte de l'application créé : un code capté depuis l'attribution, plus lisible (15 minutes passées). */
  const COMPTE_CREE: EtatConnexion = { ...FOURNI, destination: 'application', codeDejaCapte: true };
  const attendre = (etat: EtatConnexion, args: Record<string, unknown>) =>
    outil('watch_whatsapp_connection').executer(monter(() => etat).deps, 't1', args, PERSONNE) as Promise<{ suite: string; code: string | null }>;
  const demarrer = async (etat: EtatConnexion, args: Record<string, unknown>) => {
    const m = monter(() => etat);
    const r = await outil('start_whatsapp_connection').executer(m.deps, 't1', args, PERSONNE) as Record<string, string>;
    return { r, destinations: m.destinations };
  };
  const ditDeGarder = (suite: string) => {
    expect(suite).toContain(`« ${COEXISTENCE_BOUTON.fr} »`);
    expect(suite).toMatch(/start_whatsapp_connection avec mode « coexistence »/);
    expect(suite).toMatch(/Ne redonne PAS les étapes de création du compte/);
    for (const e of ETAPES_COMPTE_FOURNI) expect(suite).not.toContain(e.fr);
    for (const e of ETAPES_NUMERO_FOURNI) expect(suite).not.toContain(e.fr);
  };

  it('🔴 le lien retient la destination : fourni = api, fourni_application = application, rien pour les autres modes', async () => {
    expect((await demarrer(VIDE, { mode: 'fourni' })).destinations).toEqual([{ tenant: 't1', destination: 'api' }]);
    expect((await demarrer(VIDE, { mode: 'fourni_application' })).destinations).toEqual([{ tenant: 't1', destination: 'application' }]);
    expect((await demarrer(FOURNI, { mode: 'coexistence' })).destinations).toEqual([]);
    expect((await demarrer(VIDE, { mode: 'apporte' })).destinations).toEqual([]);
  });

  it('🔴 relecture : écrite seulement quand elle CHANGE, sinon un lien redemandé ferait oublier le compte déjà créé', async () => {
    // Même voie : rien d'écrit, l'heure retenue (depuis quand un code prouve le compte) ne bouge pas.
    expect((await demarrer({ ...FOURNI, destination: 'application' }, { mode: 'fourni_application' })).destinations).toEqual([]);
    expect((await demarrer({ ...FOURNI, destination: 'api' }, { mode: 'fourni' })).destinations).toEqual([]);
    // De la fenêtre de Meta à l'application : retenue, donc un code d'avant ne compte plus.
    expect((await demarrer({ ...FOURNI, destination: 'api', codeDejaCapte: true }, { mode: 'fourni_application' })).destinations)
      .toEqual([{ tenant: 't1', destination: 'application' }]);
  });

  it('🔴 les 15 minutes du code passées : « le compte est créé, il reste à garder l’application », jamais les étapes de création', async () => {
    ditDeGarder((await attendre(COMPTE_CREE, { mode: 'fourni_application' })).suite);
  });

  it('🔴 sans mode (une session reprise), ou avec un mode faux, la destination retenue décide', async () => {
    ditDeGarder((await attendre(COMPTE_CREE, {})).suite);
    ditDeGarder((await attendre(COMPTE_CREE, { mode: 'fourni' })).suite);
  });

  it('un lien d’avant la migration (destination inconnue) : le mode passé décide, à défaut UNE question sur son téléphone', async () => {
    const inconnue: EtatConnexion = { ...FOURNI, codeDejaCapte: true };
    ditDeGarder((await attendre(inconnue, { mode: 'fourni_application' })).suite);
    const question = (await attendre(inconnue, {})).suite;
    expect(question).toMatch(/est-il dans l’application WhatsApp Business de votre téléphone/);
    expect(question).toMatch(/mode « coexistence »/);
    for (const e of ETAPES_NUMERO_FOURNI) expect(question).not.toContain(e.fr);
  });

  it('par la fenêtre de Meta, rien ne change : les étapes du numéro neuf', async () => {
    const suite = (await attendre({ ...FOURNI, destination: 'api', codeDejaCapte: true }, {})).suite;
    for (const e of ETAPES_NUMERO_FOURNI) expect(suite).toContain(e.fr);
  });

  it('🔴 fourni est REFUSÉ pour un numéro déjà mis dans l’application et vérifié, sans rien retenir ; fourni_application passe', async () => {
    const m = monter(() => COMPTE_CREE);
    await expect(outil('start_whatsapp_connection').executer(m.deps, 't1', { mode: 'fourni' }, PERSONNE))
      .rejects.toThrow(/déjà dans l’application WhatsApp Business.*mode « coexistence »/);
    expect(m.destinations).toEqual([]);
    await expect(demarrer(COMPTE_CREE, { mode: 'fourni_application' })).resolves.toBeDefined();
    // Par la fenêtre de Meta, un code capté ne bloque rien.
    await expect(demarrer({ ...FOURNI, destination: 'api', codeDejaCapte: true }, { mode: 'fourni' })).resolves.toBeDefined();
  });
});
