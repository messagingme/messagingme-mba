import { describe, it, expect } from 'vitest';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { RefusOutil } from '../src/mcp/saisie';
import { lireCibleMcp, MAX_IDENTIFIANTS_CIBLE } from '../src/mcp/cible';
import { DROITS, type Fonction } from '../src/offres/offres';
import { corpsRefusFonction } from '../src/offres/refus';
import type { BulkTarget, ContactFilters, ContactRow } from '../src/crm/contact-store.pg';
import { ACTIVITE_COMPLETE_DEPUIS, type SuiviSegments } from '../src/crm/segments';
import { BORNES_SEGMENTS, CLES_SEGMENT as S, MOTIF_ID_COLLECTION, filtreSegment } from '../web/lib/partage/segments';

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

  it('🔴 find_contacts dit la fenêtre du dernier rattrapage TERMINÉ des commandes, que le suivi lit ; sans rattrapage, rien', async () => {
    const rattrapage = { depuis: new Date('2026-09-24T00:00:00Z'), le: new Date('2026-11-23T12:05:00Z') };
    const avec = deps({ boutique: { ...BOUTIQUE, rattrapage } });
    expect(await outil.executer(avec.d, T, { orders: { min: 1 } }, null)).toMatchObject({
      orders_recorded_since: '2026-11-03T10:00:00.000Z', orders_backfilled_since: '2026-09-24T00:00:00.000Z', orders_backfilled_at: '2026-11-23T12:05:00.000Z',
    });
    const sans = (await outil.executer(deps({ boutique: BOUTIQUE }).d, T, { orders: { min: 1 } }, null)) as Record<string, unknown>;
    expect(sans).not.toHaveProperty('orders_backfilled_since');
    expect(sans).not.toHaveProperty('orders_backfilled_at');
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
    await expect(supprimer.executer(d, T, { inactive_for_days: 90 }, { userId: '99999999-9999-4999-8999-999999999999', autorisationId: 'aut-1' }))
      .rejects.toThrow(/paramètre inconnu/);
  });

  it('les critères produit (lot 3), traduits dans le contrat commun', async () => {
    const { d } = deps({ boutique: BOUTIQUE });
    const args = {
      bought: { products: [{ product_id: '8801' }, { sku: 'SER-30' }], within_days: 90 },
      not_bought: { products: [{ sku: 'SER-60' }] },
      days_since_product: { sku: 'SER-30', min: 60, max: 120 },
    };
    expect(await lireCibleMcp(args, PRO, d, T, { identifiants: true })).toEqual({
      filters: { fieldFilters: [
        filtreSegment(S.achete, { produits: [{ produit: '8801' }, { sku: 'SER-30' }], jours: 90 }),
        filtreSegment(S.pasAchete, { produits: [{ sku: 'SER-60' }] }),
        filtreSegment(S.reassort, { sku: 'SER-30', min: 60, max: 120 }),
      ] },
      excludeIds: [],
    });
  });

  it('🔴 un critère produit sans boutique est refusé avant toute lecture des contacts', async () => {
    for (const args of [{ bought: { products: [{ sku: 'A' }] } }, { days_since_product: { sku: 'A', min: 30 } }]) {
      const { d, lus } = deps();
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: false }), JSON.stringify(args)).rejects.toThrow(/aucune boutique Shopify/);
      expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
    }
  });

  const produitsMalformes: Array<Record<string, unknown>> = [
    { not_bought: { products: [{ sku: 'A' }] } }, { bought: { products: [] } }, { bought: { products: [{ product_id: '1', sku: 'A' }] } },
    { bought: { products: [{ title: 'Sérum' }] } }, { bought: { products: [{ product_id: 'abc' }] } },
    { bought: { products: [{ sku: 'A' }], depuis: 3 } }, { bought: [{ sku: 'A' }] },
    { days_since_product: { sku: 'A' } }, { days_since_product: { sku: 'A', min: 30, within_days: 7 } },
  ];
  it.each(produitsMalformes)('🔴 critère produit refusé, jamais ignoré : %j', async (args) => {
    const { d } = deps({ boutique: BOUTIQUE });
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 chaque borne des critères produit est annoncée dans le schéma de l’outil, et sur chaque outil de la cible', () => {
    const p = outil.entree.properties;
    expect(p.bought!.properties!.products).toMatchObject({ type: 'array', minItems: 1, maxItems: BORNES_SEGMENTS.produitsMax });
    expect(p.bought!.properties!.products!.items).toMatchObject({
      additionalProperties: false, properties: { product_id: { pattern: '^\\d{1,30}$' }, sku: { minLength: 1, maxLength: BORNES_SEGMENTS.skuMax } },
    });
    expect(p.bought!.properties!.within_days).toMatchObject({ minimum: 1, maximum: BORNES_SEGMENTS.joursMax });
    expect(p.days_since_product!.properties!.min).toMatchObject({ type: 'integer', minimum: 0, maximum: BORNES_SEGMENTS.joursMax });
    expect(p.days_since_product!.additionalProperties).toBe(false);
    for (const nom of ['tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      expect(Object.keys(OUTILS.find((o) => o.nom === nom)!.entree.properties), nom).toEqual(expect.arrayContaining(['bought', 'not_bought', 'days_since_product']));
    }
  });

  it('les deux boutons prêts (lot 4), traduits dans le contrat commun', async () => {
    const { d } = deps({ boutique: BOUTIQUE });
    expect(await lireCibleMcp({ wrote_without_order: true, clicked_without_order: true }, PRO, d, T, { identifiants: true })).toEqual({
      filters: { fieldFilters: [filtreSegment(S.ecritSansCommande, true), filtreSegment(S.clicSansCommande, true)] },
      excludeIds: [],
    });
  });

  it('🔴 un bouton prêt sans boutique est refusé avant toute lecture des contacts', async () => {
    for (const args of [{ wrote_without_order: true }, { clicked_without_order: true }]) {
      const { d, lus } = deps();
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: false }), JSON.stringify(args)).rejects.toThrow(/aucune boutique Shopify/);
      expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
    }
  });

  it.each([{ wrote_without_order: false }, { clicked_without_order: 'true' }, { wrote_without_order: { within_days: 30 } }])(
    '🔴 un bouton prêt autre que true est refusé, jamais ignoré : %j',
    async (args) => {
      const { d } = deps({ boutique: BOUTIQUE });
      await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow('la valeur true est attendue');
    },
  );

  it('🔴 « true seul » est annoncé dans le schéma, sur chaque outil de la cible', () => {
    for (const nom of ['find_contacts', 'tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      const p = OUTILS.find((o) => o.nom === nom)!.entree.properties;
      for (const cle of ['wrote_without_order', 'clicked_without_order']) expect(p[cle], `${nom} ${cle}`).toMatchObject({ type: 'boolean', enum: [true] });
    }
  });

  it('le critère de collection (lot 6a), traduit dans le contrat commun', async () => {
    const { d } = deps({ boutique: BOUTIQUE });
    expect(await lireCibleMcp({ collections: { ids: ['4401', '4402'], within_days: 90 } }, PRO, d, T, { identifiants: true })).toEqual({
      filters: { fieldFilters: [filtreSegment(S.collection, { collections: ['4401', '4402'], jours: 90 })] },
      excludeIds: [],
    });
  });

  it('🔴 un critère de collection sans boutique est refusé avant toute lecture des contacts', async () => {
    const { d, lus } = deps();
    await expect(lireCibleMcp({ collections: { ids: ['4401'] } }, PRO, d, T, { identifiants: false })).rejects.toThrow(/aucune boutique Shopify/);
    expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
  });

  it.each([
    { collections: { ids: [] } }, { collections: { ids: ['Été'] } }, { collections: { ids: ['1'], depuis: 3 } }, { collections: ['4401'] },
    { collections: { ids: Array.from({ length: BORNES_SEGMENTS.collectionsMax + 1 }, (_, i) => String(i + 1)) } },
    { collections: { ids: ['4401'], within_days: 0 } }, { collections: { within_days: 30 } },
  ])('🔴 critère de collection refusé, jamais ignoré : %j', async (args) => {
    const { d } = deps({ boutique: BOUTIQUE });
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 chaque borne du critère de collection est annoncée dans le schéma, sur chaque outil de la cible', () => {
    for (const nom of ['find_contacts', 'tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      const c = OUTILS.find((o) => o.nom === nom)!.entree.properties.collections!;
      expect(c, nom).toMatchObject({ type: 'object', required: ['ids'], additionalProperties: false });
      expect(c.properties!.ids, nom).toMatchObject({
        type: 'array', minItems: 1, maxItems: BORNES_SEGMENTS.collectionsMax, items: { type: 'string', pattern: MOTIF_ID_COLLECTION },
      });
      expect(c.properties!.within_days, nom).toMatchObject({ type: 'integer', minimum: 1, maximum: BORNES_SEGMENTS.joursMax });
      // La description dit « telles qu'elles sont dans la boutique à la dernière lecture », et où lire sa date : seul
      // `find_contacts` rend `collections_read_at`, `get_shopify_state` la rend pour tous (relecture du lot 6a).
      expect(c.description, nom).toMatch(/as they are in the store at the last reading \(its date: collections\.read_at in get_shopify_state, and collections_read_at in the answer of find_contacts/);
    }
    // Le motif annoncé est celui que la validation applique : 19 chiffres passent, 20 non.
    expect(new RegExp(MOTIF_ID_COLLECTION).test('1'.repeat(19))).toBe(true);
    expect(new RegExp(MOTIF_ID_COLLECTION).test('1'.repeat(20))).toBe(false);
  });

  it('🔴 find_contacts rend la date de la lecture des collections, seulement si le critère est posé', async () => {
    const lue = new Date('2026-11-24T08:00:00Z');
    const avec = deps({ boutique: { ...BOUTIQUE, collectionsLuesLe: lue } });
    expect(await outil.executer(avec.d, T, { collections: { ids: ['4401'] } }, null)).toMatchObject({ collections_read_at: lue.toISOString() });
    const sans = (await outil.executer(avec.d, T, { orders: { min: 1 } }, null)) as Record<string, unknown>;
    expect(sans).not.toHaveProperty('collections_read_at');
  });
});

/**
 * LES ÉTIQUETTES SHOPIFY DANS LA CIBLE DE L'ASSISTANT (segments Shopify enrichis, lot 6b) : `shopify_tags` traduit dans le
 * contrat commun, ses bornes annoncées par chaque outil de la cible, refusé sans boutique, et la date de la synchronisation
 * dans la réponse de `find_contacts`. Jamais mêlé au `tags` des étiquettes Messaging Me.
 */
describe('les étiquettes Shopify de l’assistant', () => {
  const BOUTIQUE_6B: SuiviSegments['boutique'] = { devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null };

  it('🔴 traduites dans le contrat commun, à part des étiquettes Messaging Me du même mot', async () => {
    const { d } = deps({ boutique: BOUTIQUE_6B });
    expect(await lireCibleMcp({ tags: ['VIP'], shopify_tags: { tags: ['VIP', 'Grossiste'], mode: 'any' } }, PRO, d, T, { identifiants: true })).toEqual({
      filters: { tags: ['VIP'], fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes: ['VIP', 'Grossiste'], mode: 'une' })] },
      excludeIds: [],
    });
    expect(await lireCibleMcp({ shopify_tags: { tags: ['VIP'] } }, PRO, d, T, { identifiants: false })).toEqual({
      filters: { fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes: ['VIP'], mode: 'toutes' })] }, excludeIds: [],
    });
  });

  it('🔴 sans boutique : refusé avant toute lecture des contacts', async () => {
    const { d, lus } = deps();
    await expect(lireCibleMcp({ shopify_tags: { tags: ['VIP'] } }, PRO, d, T, { identifiants: false })).rejects.toThrow(/étiquettes Shopify \(shopify_tags\)/);
    expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
  });

  it.each([
    { shopify_tags: { tags: [] } }, { shopify_tags: { tags: ['   '] } }, { shopify_tags: { tags: ['a'.repeat(256)] } },
    { shopify_tags: { tags: ['VIP'], mode: 'aucune' } }, { shopify_tags: { tags: ['VIP'], jours: 3 } }, { shopify_tags: ['VIP'] },
    { shopify_tags: { tags: Array.from({ length: BORNES_SEGMENTS.etiquettesShopifyMax + 1 }, (_, i) => `e${i}`) } },
  ])('🔴 étiquettes Shopify refusées, jamais ignorées : %j', async (args) => {
    const { d } = deps({ boutique: BOUTIQUE_6B });
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 chaque borne est annoncée dans le schéma, sur chaque outil de la cible ; la description dit que ce ne sont pas les étiquettes Messaging Me', () => {
    for (const nom of ['find_contacts', 'tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      const c = OUTILS.find((o) => o.nom === nom)!.entree.properties.shopify_tags!;
      expect(c, nom).toMatchObject({ type: 'object', required: ['tags'], additionalProperties: false });
      expect(c.properties!.tags, nom).toMatchObject({
        type: 'array', minItems: 1, maxItems: BORNES_SEGMENTS.etiquettesShopifyMax,
        items: { type: 'string', minLength: 1, maxLength: BORNES_SEGMENTS.etiquetteShopifyMax, pattern: '\\S' },
      });
      expect(c.properties!.mode, nom).toMatchObject({ type: 'string', enum: ['all', 'any'] });
      expect(c.description, nom).toMatch(/NOT the Messaging Me tags/);
      expect(c.description, nom).toMatch(/tag_contacts/);
      expect(c.description, nom).toMatch(/shopify_tags_synced_at in the answer of find_contacts/);
    }
  });

  it('🔴 find_contacts rend la date de la synchronisation, seulement si le critère est posé ; un critère d’étiquettes seul ne dit rien des commandes', async () => {
    const le = new Date('2026-11-24T08:00:00Z');
    const avec = deps({ boutique: { ...BOUTIQUE_6B, etiquettesSynchroLe: le } });
    const r = (await outil.executer(avec.d, T, { shopify_tags: { tags: ['VIP'] } }, null)) as Record<string, unknown>;
    expect(r).toMatchObject({ shopify_tags_synced_at: le.toISOString() });
    expect(r).not.toHaveProperty('orders_recorded_since');
    const sans = (await outil.executer(avec.d, T, { orders: { min: 1 } }, null)) as Record<string, unknown>;
    expect(sans).not.toHaveProperty('shopify_tags_synced_at');
    expect(sans).toHaveProperty('orders_recorded_since');
  });
});

/**
 * LES SEGMENTS SHOPIFY DANS LA CIBLE DE L'ASSISTANT (segments Shopify enrichis, lot 6c) : `shopify_segments` traduit dans le
 * contrat commun, ses bornes annoncées par chaque outil de la cible, refusé sans boutique. Que le segment soit suivi et lu
 * se juge en base (`tests/segments-shopify-refus.test.ts`).
 */
describe('les segments Shopify de l’assistant', () => {
  const BOUTIQUE_6C: SuiviSegments['boutique'] = { devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null };

  it('🔴 traduits dans le contrat commun : ids et mode, « all » par défaut', async () => {
    const { d } = deps({ boutique: BOUTIQUE_6C });
    expect(await lireCibleMcp({ shopify_segments: { ids: ['11', '12'], mode: 'any' } }, PRO, d, T, { identifiants: true })).toEqual({
      filters: { fieldFilters: [filtreSegment(S.segmentShopify, { segments: ['11', '12'], mode: 'une' })] }, excludeIds: [],
    });
    expect(await lireCibleMcp({ shopify_segments: { ids: ['11'] } }, PRO, d, T, { identifiants: false })).toEqual({
      filters: { fieldFilters: [filtreSegment(S.segmentShopify, { segments: ['11'], mode: 'toutes' })] }, excludeIds: [],
    });
  });

  it('🔴 sans boutique : refusé avant toute lecture des contacts', async () => {
    const { d, lus } = deps();
    await expect(lireCibleMcp({ shopify_segments: { ids: ['11'] } }, PRO, d, T, { identifiants: false })).rejects.toThrow(/segments \(shopify_segments\)/);
    expect(lus.map((l) => l.quoi)).toEqual(['suivi']);
  });

  it.each([
    { shopify_segments: { ids: [] } }, { shopify_segments: { ids: ['abc'] } }, { shopify_segments: { ids: ['gid://shopify/Segment/11'] } },
    { shopify_segments: { ids: ['11'], mode: 'aucune' } }, { shopify_segments: { ids: ['11'], within_days: 3 } }, { shopify_segments: ['11'] },
    { shopify_segments: { ids: Array.from({ length: BORNES_SEGMENTS.segmentsShopifyMax + 1 }, (_, i) => String(i + 1)) } },
  ])('🔴 segments Shopify refusés, jamais ignorés : %j', async (args) => {
    const { d } = deps({ boutique: BOUTIQUE_6C });
    await expect(lireCibleMcp(args, PRO, d, T, { identifiants: true })).rejects.toThrow(RefusOutil);
  });

  it('🔴 chaque borne est annoncée dans le schéma, sur chaque outil de la cible', () => {
    for (const nom of ['find_contacts', 'tag_contacts', 'prepare_campaign', 'set_contact_field']) {
      const c = OUTILS.find((o) => o.nom === nom)!.entree.properties.shopify_segments!;
      expect(c, nom).toMatchObject({ type: 'object', required: ['ids'], additionalProperties: false });
      expect(c.properties!.ids, nom).toMatchObject({
        type: 'array', minItems: 1, maxItems: BORNES_SEGMENTS.segmentsShopifyMax, items: { type: 'string', pattern: MOTIF_ID_COLLECTION },
      });
      expect(c.properties!.mode, nom).toMatchObject({ type: 'string', enum: ['all', 'any'] });
      expect(c.description, nom).toMatch(/IN SHOPIFY/);
      expect(c.description, nom).toMatch(/Not the Messaging Me tags, nor the Shopify tags/);
      expect(c.description, nom).toMatch(/tag_contacts/);
    }
  });
});
