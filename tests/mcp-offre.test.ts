import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { RefusOutil } from '../src/mcp/saisie';
import { DROIT_RELAIS, DROITS_CLE_APPLICATION, VARIABLE_CLE } from '../web/lib/partage/droits-api';
import { PRIX_PRO_HT_CENTIMES } from '../src/offres/offres';
import { AUTORISATION_REVOQUEE, type PlafondCles } from '../src/auth/api-key-store.pg';
import type { PeriodicitePro } from '../src/stripe/pro';
import { PLACES_OPTION_MAX, PRIX_OPTION_WA_HT_CENTIMES } from '../src/stripe/option-credit-whatsapp';

/**
 * CE QU'UNE FREE FAIT DEPUIS CLAUDE CODE PLUTÔT QUE DANS LA CONSOLE (spec offres v2, livraison 4) : créer la clé de son
 * application, et payer le Pro. Les deux appellent la MÊME fonction que la console (`creerCleApi`, `ouvrirPro`, testées à
 * part) ; ce fichier tient ce que l'outil ajoute : la personne requise, le plafond des opérations lourdes, la clé montrée
 * une fois et dite comme telle, et le retour du paiement sur la page publique.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;

function deps(o: {
  limiteCles?: number | null; creee?: boolean | 'revoquee'; couteuxAccepte?: boolean; pro?: 'ok' | 'entreprise' | 'portail' | 'essai';
  /** La prise de l'option : un refus de `ouvrirOption` (son code), ou l'option déjà vivante. */
  option?: { refus?: string; vivante?: { statut: 'actif' | 'en_retard' | 'resilie'; places: number } };
} = {}) {
  const cap = {
    creations: [] as Array<{ name: string; scopes: string[]; plafond: PlafondCles; autorisation: string | null }>,
    audit: [] as Array<{ action: string; userId: string | null; detail: unknown }>,
    pro: [] as Array<{ periodicite: PeriodicitePro; payeur: string; retour: string }>,
    option: [] as Array<{ places: number; payeur: string }>,
  };
  const d = {
    cles: {
      cles: {
        creerSousPlafond: async (_t: string, name: string, scopes: string[], plafond: PlafondCles, autorisation: string | null) => {
          if (o.creee === 'revoquee') return AUTORISATION_REVOQUEE;
          cap.creations.push({ name, scopes, plafond, autorisation });
          return o.creee === false ? null : { id: 'k1', key: 'mba_cle_montree_une_fois' };
        },
      },
      limiteCles: async () => (o.limiteCles === undefined ? 2 : o.limiteCles),
      audit: async (_t: string, acteur: { userId: string | null }, action: string, _c: unknown, detail: unknown) => {
        cap.audit.push({ action, userId: acteur.userId, detail });
      },
    },
    offre: {
      pro: {
        ouvrir: async (_t: string, periodicite: PeriodicitePro, payeur: string, retour: string) => {
          cap.pro.push({ periodicite, payeur, retour });
          return o.pro === 'entreprise'
            ? { ok: false as const, statut: 409 as const, erreur: 'Votre espace est en offre Entreprise : le Pro ne lui ajouterait rien.', details: { code: 'deja_entreprise' } }
            : o.pro === 'essai'
              ? { ok: true as const, valeur: { url: 'https://checkout.stripe.com/c/pay/cs_pro', portail: false, essaiJours: 14 } }
              : o.pro === 'portail'
              ? { ok: true as const, valeur: { url: 'https://billing.stripe.com/p/session/portail', portail: true } }
              : { ok: true as const, valeur: { url: 'https://checkout.stripe.com/c/pay/cs_pro', portail: false } };
        },
      },
      option: {
        ouvrir: async (_t: string, places: number, payeur: string) => {
          cap.option.push({ places, payeur });
          return o.option?.refus
            ? { ok: false as const, statut: 409 as const, erreur: `refus ${o.option.refus}`, details: { code: o.option.refus } }
            : { ok: true as const, valeur: { url: 'https://checkout.stripe.com/c/pay/cs_option' } };
        },
        etat: async () => o.option?.vivante ?? null,
      },
    },
    couteux: { consommer: async () => ({ accepte: o.couteuxAccepte ?? true, attenteMs: 3000 }) },
  } as unknown as DepsMcp;
  return { d, cap };
}

describe('les outils MCP d’une Free : la clé de son application et le Pro', () => {
  it('🔴 les deux exigent une personne (un consentement OAuth, donné par un administrateur) : une clé d’API ne les voit pas', () => {
    for (const nom of ['create_api_key', 'subscribe_pro']) {
      expect(outil(nom).exigePersonne, nom).toBe(true);
      expect(outil(nom).scope, nom).toBe('mcp:write');
      // Ouverts à toutes les offres : c'est la Free qui en a besoin.
      expect(outil(nom).fonction, nom).toBeNull();
    }
    const parCle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    expect(parCle).not.toContain('create_api_key');
    expect(parCle).not.toContain('subscribe_pro');
  });

  it('🔴 create_api_key : la clé rendue une fois, avec la variable où la ranger, et la description qui dit qu’elle passe par la conversation', async () => {
    const { d, cap } = deps();
    const r = await outil('create_api_key').executer(d, T, { name: 'Mon application' }, PERSONNE) as Record<string, unknown>;
    expect(r).toMatchObject({ id: 'k1', key: 'mba_cle_montree_une_fois', name: 'Mon application', variable: VARIABLE_CLE });
    // Sans droits demandés : ceux de la clé d'une application (les mêmes que la page « Démarrer »).
    // 🔴 Lot D de l'audit : la clé est rattachée à l'autorisation de la personne, que sa révocation par un admin coupe.
    expect(cap.creations).toEqual([{ name: 'Mon application', scopes: [...DROITS_CLE_APPLICATION], plafond: { max: 2, horsDroit: DROIT_RELAIS }, autorisation: 'aut-1' }]);
    expect(outil('create_api_key').description).toMatch(/shown ONCE/);
    expect(outil('create_api_key').description).toMatch(/passes through this conversation/);
    expect(outil('create_api_key').description).toContain('revokes this connection in the console (Authorized applications) revokes the key');
    // L'audit signe la personne et l'origine, jamais la clé.
    expect(cap.audit).toEqual([{ action: 'cle_api.creee', userId: 'u1', detail: { scopes: [...DROITS_CLE_APPLICATION], via: 'mcp', autorisation: 'aut-1' } }]);
    expect(JSON.stringify(cap.audit)).not.toContain('mba_cle_montree_une_fois');
  });

  it('🔴 create_api_key : jamais le droit du relais, ni un droit inconnu ; la 3e clé d’une Free est refusée avec la phrase de l’offre', async () => {
    const { d, cap } = deps();
    await expect(outil('create_api_key').executer(d, T, { name: 'x', scopes: [DROIT_RELAIS] }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    await expect(outil('create_api_key').executer(d, T, { name: 'x', scopes: ['god:mode'] }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    // Une clé à droits LIMITÉS (spec) : ni le MCP, ni les webhooks, ni la suppression de contacts. Une consigne glissée
    // dans un message lu par Claude ne fabrique pas une clé qui survivrait à la révocation de Claude ; la console les crée.
    for (const large of ['mcp:read', 'mcp:write', 'webhooks:write', 'contacts:admin']) {
      await expect(outil('create_api_key').executer(d, T, { name: 'x', scopes: ['sends:create', large] }, PERSONNE), large)
        .rejects.toBeInstanceOf(RefusOutil);
    }
    expect(cap.creations).toEqual([]);
    const annonces = (outil('create_api_key').entree.properties as Record<string, { items?: { enum?: string[] } }>).scopes!.items!.enum!;
    expect([...annonces].sort()).toEqual(['contacts:read', 'contacts:write', 'conversations:read', 'sends:create', 'templates:write']);
    await outil('create_api_key').executer(d, T, { name: 'Lecture', scopes: ['contacts:read'] }, PERSONNE);
    expect(cap.creations.map((c) => c.scopes)).toEqual([['contacts:read']]);
    await expect(outil('create_api_key').executer(deps({ creee: false }).d, T, { name: 'x' }, PERSONNE))
      .rejects.toThrow(/Limite de votre offre atteinte : 2 clés d’API actives.*Passez en Pro/);
  });

  it('🔴 lot D de l’audit : une autorisation révoquée pendant l’appel refuse la clé, sans trace', async () => {
    const { d, cap } = deps({ creee: 'revoquee' });
    await expect(outil('create_api_key').executer(d, T, { name: 'x' }, PERSONNE)).rejects.toThrow(/vient d’être révoquée/);
    expect(cap.audit).toEqual([]);
  });

  it('🔴 subscribe_pro : l’adresse de Stripe, le montant hors taxe de la grille, et le retour sur la page publique', async () => {
    const { d, cap } = deps();
    const r = await outil('subscribe_pro').executer(d, T, { periodicite: 'an' }, PERSONNE);
    expect(r).toMatchObject({
      url: 'https://checkout.stripe.com/c/pay/cs_pro', periodicite: 'an', portail: false, montant_ht_eur: PRIX_PRO_HT_CENTIMES.an / 100,
    });
    expect(cap.pro).toEqual([{ periodicite: 'an', payeur: 'u1', retour: 'claude' }]);
    await expect(outil('subscribe_pro').executer(d, T, { periodicite: 'semaine' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    await expect(outil('subscribe_pro').executer(deps({ pro: 'entreprise' }).d, T, { periodicite: 'mois' }, PERSONNE))
      .rejects.toThrow(/offre Entreprise/);
    // Déjà en Pro : le portail de Stripe, et aucun montant que Claude annoncerait « à payer ».
    const portail = await outil('subscribe_pro').executer(deps({ pro: 'portail' }).d, T, { periodicite: 'mois' }, PERSONNE) as Record<string, unknown>;
    expect(portail).toMatchObject({ url: 'https://billing.stripe.com/p/session/portail', portail: true });
    expect(portail).not.toHaveProperty('montant_ht_eur');
    expect(portail).not.toHaveProperty('taxe');
    // L'essai de 14 jours (spec offres v2) : Claude le dit, rien n'est prélevé avant sa fin.
    const essai = await outil('subscribe_pro').executer(deps({ pro: 'essai' }).d, T, { periodicite: 'mois' }, PERSONNE) as Record<string, unknown>;
    expect(essai).toMatchObject({ portail: false, essai_jours: 14 });
    expect(outil('subscribe_pro').description).toMatch(/14-day free trial/);
  });

  it('🔴 spec Business : get_plan décrit les quatre offres, et subscribe_pro dit qu’un Business ne se paie pas en ligne', () => {
    expect(outil('get_plan').description).toMatch(/free, pro, business or entreprise/);
    expect(outil('get_plan').description).toMatch(/Business and Entreprise are set up by Messaging Me/);
    expect(outil('get_plan').description).not.toMatch(/commission/i);
    expect(outil('subscribe_pro').description).toMatch(/Business or Entreprise workspace is refused/);
  });

  it('🔴 les trois comptent dans les opérations lourdes : refusées, elles n’appellent ni la création ni Stripe', async () => {
    const { d, cap } = deps({ couteuxAccepte: false });
    await expect(outil('create_api_key').executer(d, T, { name: 'x' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    await expect(outil('subscribe_pro').executer(d, T, { periodicite: 'mois' }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    await expect(outil('take_credit_line').executer(d, T, {}, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    expect([cap.creations, cap.pro, cap.option]).toEqual([[], [], []]);
  });

  it('🔴 take_credit_line : une personne requise, l’adresse de Stripe, 1 numéro par défaut et 30 € HT par numéro', async () => {
    expect(outil('take_credit_line').exigePersonne).toBe(true);
    const { d, cap } = deps();
    expect(await outil('take_credit_line').executer(d, T, {}, PERSONNE)).toMatchObject({
      url: 'https://checkout.stripe.com/c/pay/cs_option', places: 1, montant_ht_eur_par_mois: PRIX_OPTION_WA_HT_CENTIMES / 100,
    });
    expect(await outil('take_credit_line').executer(d, T, { places: 3 }, PERSONNE)).toMatchObject({ places: 3, montant_ht_eur_par_mois: 3 * PRIX_OPTION_WA_HT_CENTIMES / 100 });
    expect(cap.option).toEqual([{ places: 1, payeur: 'u1' }, { places: 3, payeur: 'u1' }]);
    // Ce que le schéma annonce, l'outil l'applique (règle des bornes) : un entier de 1 à PLACES_OPTION_MAX.
    expect(outil('take_credit_line').entree).toMatchObject({ properties: { places: { type: 'integer', minimum: 1, maximum: PLACES_OPTION_MAX } } });
    for (const places of [0, 2.5, '2', PLACES_OPTION_MAX + 1]) {
      await expect(outil('take_credit_line').executer(d, T, { places }, PERSONNE)).rejects.toBeInstanceOf(RefusOutil);
    }
    expect(cap.option).toHaveLength(2);
  });

  it('🔴 take_credit_line : chaque refus de la prise remonte avec son code (Free, Entreprise, numéro avec sa carte, Pro à confirmer…)', async () => {
    for (const code of ['option_avec_le_pro', 'option_inutile', 'numero_avec_carte', 'option_apres_essai', 'formule_en_retard', 'option_en_cours', 'option_indisponible']) {
      await expect(outil('take_credit_line').executer(deps({ option: { refus: code } }).d, T, {}, PERSONNE)).rejects.toThrow(new RegExp(code));
    }
  });

  it('🔴 take_credit_line : une option déjà vivante rend son état, sans ouvrir de second paiement', async () => {
    const { d, cap } = deps({ option: { vivante: { statut: 'actif', places: 2 } } });
    const r = await outil('take_credit_line').executer(d, T, {}, PERSONNE) as Record<string, unknown>;
    expect(r).toEqual({ deja_prise: true, statut: 'actif', places: 2 });
    expect(r).not.toHaveProperty('url');
    expect(cap.option).toEqual([]);
  });

  it('🔴 start_whatsapp_connection renvoie à take_credit_line avant son lien quand la personne choisit la ligne de crédit', () => {
    expect(outil('start_whatsapp_connection').description).toMatch(/chose the credit line.*take_credit_line first/);
  });

  it('🔴 take_credit_line dit l’ordre : après la confirmation du Pro, AVANT tout lien de connexion', () => {
    const d = outil('take_credit_line').description;
    expect(d).toMatch(/get_plan/);
    expect(d).toMatch(/before .*start_whatsapp_connection/i);
    expect(d).toMatch(/even during the trial/);
  });
});
