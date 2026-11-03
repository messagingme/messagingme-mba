import { describe, it, expect } from 'vitest';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { RefusOutil } from '../src/mcp/saisie';
import { lireCibleMcp, MAX_IDENTIFIANTS_CIBLE } from '../src/mcp/cible';
import { DROITS, type Fonction } from '../src/offres/offres';
import { corpsRefusFonction } from '../src/offres/refus';
import type { BulkTarget, ContactFilters, ContactRow } from '../src/crm/contact-store.pg';
import { ACTIVITE_COMPLETE_DEPUIS, type SuiviSegments } from '../src/crm/segments';
import { BORNES_SEGMENTS, CLES_SEGMENT as S, filtreSegment } from '../web/lib/partage/segments';

/**
 * LA CIBLE DE L'ASSISTANT ET `find_contacts` (plan « Campagnes depuis Claude », tâche 4). La cible passe par
 * `parseBulkTarget`, le même analyseur que le mini-CRM et la création de campagne : ce fichier tient ce que l'assistant
 * ajoute devant lui. 🔴 Une cible sans critère n'existe pas (elle viserait tout l'espace), l'analyse reste à
 * l'Entreprise, et un identifiant d'un autre espace ne désigne personne.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const C1 = '11111111-1111-4111-8111-111111111111';
const CV1 = '33333333-3333-4333-8333-333333333333';
const PRO = DROITS.pro.fonctions;
const ENTREPRISE = DROITS.entreprise.fonctions;
const outil = OUTILS.find((o) => o.nom === 'find_contacts')!;

const fiche = (id: string): ContactRow => ({
  id, phoneE164: '+33600000001', profileName: 'Léa', optInStatus: 'opted_in', tags: ['vip'], fields: {}, createdAt: '2026-10-01T10:00:00.000Z',
} as unknown as ContactRow);

function deps(o: { fonctions?: ReadonlySet<Fonction>; conversations?: Record<string, string>; boutique?: SuiviSegments['boutique'] } = {}) {
  const lus: Array<{ quoi: string; filtres?: ContactFilters; limit?: number; tenant?: string; ids?: string[] }> = [];
  const d = {
    offres: { offreDe: async () => ({ droits: { fonctions: o.fonctions ?? PRO } }) },
    inbox: {
      // La garde d'espace vit dans le store réel : ici, seules les conversations déclarées existent dans l'espace T.
      contactIdsDesConversations: async (tenant: string, ids: string[]) => {
        lus.push({ quoi: 'conversations', tenant, ids });
        return tenant === T ? ids.map((i) => o.conversations?.[i]).filter((x): x is string => x !== undefined) : [];
      },
    },
    contacts: {
      contactIdsForTarget: async (tenant: string, cible: BulkTarget) => (tenant === T && 'ids' in cible ? cible.ids.filter((i: string) => i === C1) : []),
      count: async (_t: string, filtres: ContactFilters) => { lus.push({ quoi: 'count', filtres }); return 238; },
      query: async (_t: string, filtres: ContactFilters, limit: number) => { lus.push({ quoi: 'query', filtres, limit }); return [fiche(C1)]; },
      analysesEtResumes: async () => { lus.push({ quoi: 'analyses' }); return new Map(); },
      suiviSegments: async () => { lus.push({ quoi: 'suivi' }); return { boutique: o.boutique ?? null }; },
    },
  } as unknown as DepsMcp;
  return { d, lus };
}

describe('lireCibleMcp', () => {
  it('🔴 aucun critère : refusé, jamais « tout l’espace »', async () => {
    const { d, lus } = deps();
    for (const args of [{}, { tags: [] }, { tags: ['  '] }, { analysis: [] }, { contact_ids: [] }]) {
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true }), JSON.stringify(args)).rejects.toThrow(RefusOutil);
    }
    expect(lus).toHaveLength(0);
  });

  it('les étiquettes, toutes ou l’une, et le consentement, en filtres du mini-CRM', async () => {
    const { d } = deps();
    expect(await lireCibleMcp({ tags: ['retard-livraison-oct', 'vip'], tag_mode: 'any', opt_in: 'opted_in' }, PRO, d, T, { identifiants: true }))
      .toEqual({ filters: { tags: ['retard-livraison-oct', 'vip'], tagMode: 'or', optIn: 'opted_in' }, excludeIds: [] });
  });

  it('🔴 l’analyse hors Entreprise : refusée avec le lien de l’offre', async () => {
    const { d } = deps();
    const args = { analysis: [{ field: 'analyse_sentiment', op: 'in', value: 'negatif' }] };
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(corpsRefusFonction('analyse').error);
    expect(await lireCibleMcp(args, ENTREPRISE, d, T, { identifiants: true }))
      .toEqual({ filters: { fieldFilters: [{ key: 'analyse_sentiment', op: 'in', value: 'negatif' }] }, excludeIds: [] });
  });

  it('🔴 un champ hors des champs d’analyse filtrables, ou un opérateur faux : refusé, jamais ignoré', async () => {
    const { d } = deps();
    for (const a of [
      { field: 'prenom', op: 'eq', value: 'Léa' },
      { field: 'analyse_sujet', op: 'in', value: 'livraison' },
      { field: 'analyse_urgence', op: 'eq', value: '7' },
      { field: 'analyse_sentiment', op: 'in', value: 'furieux' },
    ]) {
      await expect(lireCibleMcp({ analysis: [a] }, ENTREPRISE, d, T, { identifiants: true }), a.field).rejects.toThrow(RefusOutil);
    }
  });

  it('des conversations : leurs contacts, et 🔴 rien pour celles d’un autre espace', async () => {
    const { d } = deps({ conversations: { [CV1]: C1 } });
    expect(await lireCibleMcp({ conversation_ids: [CV1] }, PRO, d, T, { identifiants: true })).toEqual({ ids: [C1] });
    await expect(lireCibleMcp({ conversation_ids: [CV1] }, PRO, d, 'autre-espace', { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 des contacts d’un autre espace : refusés, jamais « 0 contact » en silence (relecture, constat 2)', async () => {
    const { d } = deps();
    const AUTRE = '99999999-9999-4999-8999-999999999999';
    await expect(lireCibleMcp({ contact_ids: [AUTRE] }, PRO, d, T, { identifiants: true })).rejects.toThrow(/aucun de ces contacts/);
    // Mêlés à un contact de l'espace : seuls ceux de l'espace restent.
    expect(await lireCibleMcp({ contact_ids: [AUTRE, C1] }, PRO, d, T, { identifiants: true })).toEqual({ ids: [C1] });
  });

  it('identifiants mal formés, trop nombreux, ou mêlés à des filtres : refusés', async () => {
    const { d, lus } = deps();
    const trop = Array.from({ length: MAX_IDENTIFIANTS_CIBLE + 1 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
    for (const args of [{ contact_ids: ['pas-un-uuid'] }, { contact_ids: trop }, { contact_ids: [C1], tags: ['vip'] }, { contact_ids: [C1], conversation_ids: [CV1] }]) {
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
    }
    expect(lus).toHaveLength(0);
    expect(MAX_IDENTIFIANTS_CIBLE).toBe(500);
  });

  it('des identifiants là où ils n’ont pas de sens : refusés', async () => {
    const { d } = deps();
    await expect(lireCibleMcp({ contact_ids: [C1] }, PRO, d, T, { identifiants: false })).rejects.toThrow(RefusOutil);
  });
});

describe('find_contacts', () => {
  it('une lecture de l’offre console (Pro), lisible avec une clé', () => {
    expect(outil.fonction).toBe('console');
    expect(outil.scope).toBe('mcp:read');
    expect(outil.exigePersonne).toBeUndefined();
    expect(outil.annotations.readOnlyHint).toBe(true);
  });

  it('rend le total et au plus 100 contacts', async () => {
    const { d, lus } = deps();
    const r = (await outil.executer(d, T, { tags: ['vip'], limit: 500 }, null)) as { total: number; contacts: unknown[] };
    expect(r.total).toBe(238);
    expect(r.contacts).toEqual([{ contact_id: C1, name: 'Léa', phone: '+33600000001', country: 'FR', opt_in: 'opted_in', tags: ['vip'] }]);
    expect(lus.find((l) => l.quoi === 'query')?.limit).toBe(100);
  });

  it('la dernière analyse seulement en Entreprise', async () => {
    const pro = deps();
    await outil.executer(pro.d, T, { tags: ['vip'] }, null);
    expect(pro.lus.some((l) => l.quoi === 'analyses')).toBe(false);
    const ent = deps({ fonctions: ENTREPRISE });
    const r = (await outil.executer(ent.d, T, { tags: ['vip'] }, null)) as { contacts: Array<Record<string, unknown>> };
    expect(ent.lus.some((l) => l.quoi === 'analyses')).toBe(true);
    expect(r.contacts[0]).toHaveProperty('last_analysis', null);
  });

  it('🔴 sans critère, rien n’est lu', async () => {
    const { d, lus } = deps();
    await expect(outil.executer(d, T, {}, null)).rejects.toThrow(RefusOutil);
    expect(lus).toHaveLength(0);
  });
});

/**
 * LES SEGMENTS DE L'ASSISTANT (spec du 2026-10-31) : commandes, dépense, dernière commande, activité, pays. Ils passent
 * par le même analyseur que la console ; l'outil ajoute la forme de ses plages et 🔴 le refus d'un critère de commande
 * sans boutique, qui viserait sinon tout l'espace (« au plus 0 commande »).
 */
describe('les segments de l’assistant', () => {
  const BOUTIQUE = { devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null };

  it('les six critères, traduits dans le contrat commun', async () => {
    const { d } = deps({ boutique: BOUTIQUE });
    const args = {
      orders: { min: 2, within_days: 90 }, spent: { min: 200, max: 1000 }, days_since_last_order: { min: 180 },
      active_within_days: 30, inactive_for_days: 7, countries: ['be', 'FR'],
    };
    expect(await lireCibleMcp(args, PRO, d, T, { identifiants: true })).toEqual({
      filters: {
        fieldFilters: [
          filtreSegment(S.commandes, { min: 2, jours: 90 }), filtreSegment(S.depense, { min: 200, max: 1000 }),
          filtreSegment(S.derniereCommande, { min: 180 }), filtreSegment(S.actif, 30), filtreSegment(S.inactif, 7),
          filtreSegment(S.pays, ['BE', 'FR']),
        ],
      },
      excludeIds: [],
    });
  });

  it('🔴 un critère de commande sans boutique est refusé avant toute lecture des contacts', async () => {
    for (const args of [{ orders: { max: 0 } }, { spent: { min: 1 } }, { days_since_last_order: { min: 1 } }]) {
      const { d, lus } = deps();
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: false }), JSON.stringify(args)).rejects.toThrow(/aucune boutique Shopify/);
      expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
    }
    // Le pays et l'activité, eux, n'ont pas besoin de boutique.
    const { d } = deps();
    expect(await lireCibleMcp({ countries: ['FR'], inactive_for_days: 90 }, PRO, d, T, { identifiants: false }))
      .toEqual({ filters: { fieldFilters: [filtreSegment(S.inactif, 90), filtreSegment(S.pays, ['FR'])] }, excludeIds: [] });
  });

  const malformes: Array<Record<string, unknown>> = [
    { orders: { min: 0 } }, { orders: {} }, { orders: { min: 3, max: 2 } }, { orders: { min: 1, within_days: 0 } },
    { orders: { min: 1, jours: 30 } }, { orders: 3 }, { days_since_last_order: { min: 1, within_days: 3 } },
    { spent: { min: -1 } }, { active_within_days: 0 }, { inactive_for_days: BORNES_SEGMENTS.joursMax + 1 },
    { countries: [] }, { countries: 'FR' }, { countries: ['XX'] }, { countries: ['UK'] }, { countries: ['CA'] }, { countries: ['PR'] },
  ];
  it.each(malformes)('🔴 refusé, jamais ignoré : %j', async (args) => {
    const { d } = deps({ boutique: BOUTIQUE });
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 analyse et segments au-delà de 20 filtres : refusés, jamais tronqués', async () => {
    const { d } = deps({ fonctions: ENTREPRISE, boutique: BOUTIQUE });
    const analysis = Array.from({ length: 20 }, () => ({ field: 'analyse_urgence', op: 'gte', value: '7' }));
    await expect(lireCibleMcp({ analysis, active_within_days: 7 }, ENTREPRISE, d, T, { identifiants: true })).rejects.toThrow(/20 filtres au plus/);
  });

  it('une liste d’identifiants ne se combine pas avec un segment', async () => {
    const { d } = deps({ boutique: BOUTIQUE });
    await expect(lireCibleMcp({ contact_ids: [C1], active_within_days: 7 }, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('find_contacts rend la date du suivi des commandes, la coupure, et celle de l’activité, seulement si le critère est posé', async () => {
    const avec = deps({ boutique: { ...BOUTIQUE, coupeeLe: new Date('2026-11-10T08:00:00Z') } });
    const r = (await outil.executer(avec.d, T, { orders: { min: 1 }, active_within_days: 7 }, null)) as Record<string, unknown>;
    expect(r).toMatchObject({
      orders_recorded_since: '2026-11-03T10:00:00.000Z', shop_cut_at: '2026-11-10T08:00:00.000Z', activity_complete_since: ACTIVITE_COMPLETE_DEPUIS,
    });
    const sans = deps({ boutique: BOUTIQUE });
    const r2 = (await outil.executer(sans.d, T, { countries: ['FR'] }, null)) as Record<string, unknown>;
    expect(Object.keys(r2).sort()).toEqual(['contacts', 'total']);
  });

  it('🔴 chaque borne appliquée est annoncée dans le schéma de l’outil', () => {
    const p = outil.entree.properties;
    expect(p.orders!.properties!.min).toMatchObject({ type: 'integer', minimum: 0, maximum: BORNES_SEGMENTS.commandesMax });
    expect(p.orders!.properties!.within_days).toMatchObject({ type: 'integer', minimum: 1, maximum: BORNES_SEGMENTS.joursMax });
    expect(p.orders!.additionalProperties).toBe(false);
    expect(p.spent!.properties!.max).toMatchObject({ type: 'number', minimum: 0, maximum: BORNES_SEGMENTS.depenseMax });
    expect(p.days_since_last_order!.properties).not.toHaveProperty('within_days');
    expect(p.days_since_last_order!.properties!.min).toMatchObject({ type: 'integer', maximum: BORNES_SEGMENTS.joursMax });
    for (const k of ['active_within_days', 'inactive_for_days']) expect(p[k]).toMatchObject({ type: 'integer', minimum: 1, maximum: BORNES_SEGMENTS.joursMax });
    expect(p.countries).toMatchObject({ minItems: 1, maxItems: BORNES_SEGMENTS.paysMax, items: { pattern: '^[A-Za-z]{2}$' } });
    // Les outils qui prennent la même cible les annoncent aussi.
    for (const nom of ['tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      expect(Object.keys(OUTILS.find((o) => o.nom === nom)!.entree.properties), nom).toEqual(expect.arrayContaining(['orders', 'countries', 'inactive_for_days']));
    }
  });

  it('🔴 les outils de suppression n’annoncent ni n’acceptent l’inactivité', async () => {
    const supprimer = OUTILS.find((o) => o.nom === 'prepare_contacts_deletion')!;
    expect(Object.keys(supprimer.entree.properties)).not.toContain('inactive_for_days');
    const { d } = deps({ boutique: BOUTIQUE });
    await expect(supprimer.executer(d, T, { inactive_for_days: 90 }, { userId: '99999999-9999-4999-8999-999999999999' }))
      .rejects.toThrow(/paramètre inconnu/);
  });
});
