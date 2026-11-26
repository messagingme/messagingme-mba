import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { ContactStore, ContactUpsert, LotContacts } from '../src/crm/import';
import type { UserFieldStore } from '../src/crm/fields';
import type { UserFieldDef } from '../src/crm/types';
import type { ContactFilters } from '../src/crm/contact-store.pg';
import type { ImportRouteDeps } from '../src/http/import';
import { collectionsInertes, etiquettesInertes, journalMuet } from './routes-inertes';
import { MIDI_COLLECTIONS, T_COLLECTIONS, monterCollections } from './collections-faux';
import { traiterCollections } from '../src/shopify/collections';
import { MIDI_ETIQUETTES, monterEtiquettes } from './etiquettes-faux';
import { csvLent, retardPendant } from './boucle';
import { LimiteOffreError } from '../src/offres/refus';
import { DROITS, type Fonction } from '../src/offres/offres';
import { ACTIVITE_COMPLETE_DEPUIS } from '../src/crm/segments';
import { CLES_SEGMENT, filtreSegment } from '../web/lib/partage/segments';

const SECRET = 'test-secret';
let token = '';
let agentToken = '';
beforeAll(async () => {
  token = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentToken = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const auth = () => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
const asAgent = () => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}` } });

class FakeContacts implements ContactStore {
  readonly upserts: ContactUpsert[] = [];
  /** Nombre de lots recus : un import ne doit plus faire une requete par ligne (R9). */
  lots = 0;
  /** L'autorité de chaque lot reçu. */
  readonly autorites: Array<LotContacts['autorite']> = [];
  /** La limite de contacts de l'offre (lot 6) : sans limite ici, sauf si le test la pose. */
  refuserPlace = false;
  /** Les places de l'offre (lot 2 du 2026-11-24) : sans limite ici, sauf si le test les pose. */
  places = { limite: null as number | null, comptees: 0, presents: new Set<string>(), remplacer: false };
  readonly placesLues: number[] = [];
  lirePlaces(numeros: readonly string[]) {
    this.placesLues.push(numeros.length);
    return { ...this.places, presents: new Set(numeros.filter((n) => this.places.presents.has(n))) };
  }
  async verifierPlaceContacts(tenantId: string): Promise<void> {
    if (this.refuserPlace) throw new LimiteOffreError(tenantId, 'contacts', 100);
  }
  async upsertManyByPhone(lot: LotContacts): Promise<Array<'created' | 'updated'>> {
    this.lots += 1;
    this.autorites.push(lot.autorite);
    for (const c of lot.contacts) {
      this.upserts.push({
        tenantId: lot.tenantId,
        phoneE164: c.phoneE164,
        profileName: c.profileName,
        fields: c.fields,
        optInStatus: lot.optInStatus,
        ...(lot.optInSource ? { optInSource: lot.optInSource } : {}),
        ...(lot.tags ? { tags: lot.tags } : {}),
      });
    }
    return lot.contacts.map(() => 'created');
  }
}
class FakeFields implements UserFieldStore {
  readonly defs: UserFieldDef[] = [];
  async list(): Promise<UserFieldDef[]> {
    return this.defs;
  }
  async upsert(_tenantId: string, def: UserFieldDef): Promise<void> {
    this.defs.push(def);
  }
}

// Capture des appels de requête filtrée (pour asserter le parsing des query params -> ContactFilters + le
// routage query vs list). Partagé par les tests qui en ont besoin via un objet passé à inject.
type QueryCapture = {
  queryFilters: unknown[]; countFilters: unknown[]; idsFilters: unknown[];
  produits?: Array<{ t: string; recherche: string | undefined; limite: number }>;
};

/** Trace d'audit telle que la route l'écrit. `journal` est fourni par les tests qui l'observent. */
interface Trace { action: string; target: { kind: string; id: string }; detail: Record<string, unknown>; actor: { userId: string | null } }

function inject(
  contacts: ContactStore, userFields: UserFieldStore, cap?: QueryCapture, journal?: Trace[], collections?: ImportRouteDeps['collections'],
  etiquettesShopify?: ImportRouteDeps['etiquettesShopify'], fonctions: ReadonlySet<Fonction> = DROITS.entreprise.fonctions,
) {
  return buildServer({
    queue: new FakeQueue(),
    auth: { users: noUsers, secret: SECRET },
    import: {
      contacts: Object.assign(contacts, {
        list: async () => [
          { id: 'c1', phoneE164: '+33611111111', bsuid: null, externalId: null, profileName: 'Julie', optInStatus: 'opted_in' as const, fields: { ville: 'Lyon' }, tags: ['salon-2026'], createdAt: '2026-07-05T00:00:00.000Z', blockedAt: null, whatsappJoignable: null, whatsappJoignableLe: null, risque: null },
        ],
        query: async (_t: string, filters: ContactFilters) => { cap?.queryFilters.push(filters); return [
          { id: 'c2', phoneE164: '+33612345678', bsuid: null, externalId: null, profileName: 'Marc', optInStatus: 'opted_in' as const, fields: { ville: 'Paris' }, tags: ['vip'], createdAt: '2026-07-06T00:00:00.000Z', blockedAt: null, whatsappJoignable: null, whatsappJoignableLe: null, risque: null },
        ]; },
        count: async (_t: string, filters: ContactFilters) => { cap?.countFilters.push(filters); return 3; },
        idsForFilters: async (_t: string, filters: ContactFilters) => { cap?.idsFilters.push(filters); return ['c2', 'c3']; },
        suiviSegments: async () => ({ boutique: { devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null } }),
        placesContacts: async (_t: string, numeros: readonly string[]) => (contacts instanceof FakeContacts
          ? contacts.lirePlaces(numeros) : { limite: null, comptees: 0, presents: new Set<string>(), remplacer: false }),
        produitsVus: async (t: string, recherche: string | undefined, limite: number) => {
          cap?.produits?.push({ t, recherche, limite });
          return [{ produitId: '8801', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', commandes: 4 }];
        },
      }),
      userFields,
      audit: journalMuet,
      collections: collections ?? collectionsInertes,
      etiquettesShopify: etiquettesShopify ?? etiquettesInertes,
      fonctions: async () => fonctions,
      ...(journal ? { audit: async (_t: string, actor: { userId: string | null }, action: string, target: { kind: string; id: string }, detail: Record<string, unknown> = {}) => { journal.push({ action, target, detail, actor }); } } : {}),
    },
  });
}

describe('POST /tenants/:tenantId/contacts/import', { timeout: 30_000 }, () => {
  it('parse le CSV, reconnaît les colonnes, upsert les contacts opt-in', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: { csv: 'Nom,Téléphone,Ville\nJulie,+33611111111,Lyon\nMarc,0622222222,Paris', optIn: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ created: number; skipped: number }>();
    expect(body.created).toBe(2);
    expect(contacts.upserts).toHaveLength(2);
    expect(contacts.upserts[0]?.optInStatus).toBe('opted_in');
    expect(contacts.upserts[0]?.phoneE164).toBe('+33611111111');
    expect(contacts.upserts[1]?.phoneE164).toBe('+33622222222'); // normalisé FR
    expect(contacts.upserts[0]?.fields).toMatchObject({ ville: 'Lyon' }); // colonne custom
    await app.close();
  });

  it('🔴 la limite de contacts de l’offre : 402 plan_limit_reached, le lien vers l’offre, rien n’est écrit', async () => {
    const contacts = new FakeContacts();
    contacts.refuserPlace = true;
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: { csv: 'Nom,Téléphone\nJulie,+33611111111', optIn: true },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ code: 'plan_limit_reached', limite: 'contacts', max: 100 });
    expect(res.json().upgradeUrl).toMatch(/\/offre$/);
    expect(contacts.upserts).toEqual([]);
    await app.close();
  });

  it('POST /import/preview -> colonnes + mapping suggéré (sans écrire)', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import/preview',
      ...auth(),
      payload: { csv: 'Nom,Téléphone,Ville\nJulie,+33611111111,Lyon' },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json<{ headers: string[]; rowCount: number; mapping: { columns: Record<string, { target: string }> } }>();
    expect(b.headers).toEqual(['Nom', 'Téléphone', 'Ville']);
    expect(b.rowCount).toBe(1);
    expect(res.json<{ sampleRows: unknown[] }>().sampleRows).toEqual([{ Nom: 'Julie', 'Téléphone': '+33611111111', Ville: 'Lyon' }]);
    expect(b.mapping.columns['Téléphone']?.target).toBe('phone');
    expect(b.mapping.columns['Nom']?.target).toBe('name');
    expect(b.mapping.columns['Ville']?.target).toBe('custom');
    expect(contacts.upserts).toHaveLength(0); // aperçu = zéro écriture
    // Sans l'option « le plus ancien laisse sa place » : aucun effacement annoncé, et le fichier n'est pas relu.
    expect(b).not.toHaveProperty('remplacement');
    expect(contacts.placesLues).toEqual([0]);
    await app.close();
  });

  it('🔴 POST /import/preview, « le plus ancien laisse sa place » (lot 2 du 2026-11-24) : les effacements annoncés, déjà-là non comptés', async () => {
    const contacts = new FakeContacts();
    // Plein (5 sur 5), l'option cochée ; un des trois numéros du fichier est déjà une fiche active.
    contacts.places = { limite: 5, comptees: 5, presents: new Set(['+33611111111']), remplacer: true };
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST', url: '/tenants/t1/contacts/import/preview', ...auth(),
      payload: { csv: ['Nom,Téléphone', 'Julie,+33611111111', 'Marc,06 12 34 56 78', 'Lou,+33622222222', 'Bis,+33622222222', 'Vide,'].join('\n') },
    });
    expect(res.statusCode).toBe(200);
    // Deux numéros nouveaux (le doublon et la ligne vide ne comptent pas), aucune place libre : deux effacements.
    expect(res.json()).toMatchObject({ remplacement: { nouveaux: 2, placesLibres: 0 } });
    expect(contacts.upserts).toHaveLength(0);
    // Sans colonne de téléphone, rien n'est compté.
    const sans = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import/preview', ...auth(), payload: { csv: 'Nom,Ville\nJulie,Lyon' } });
    expect(sans.json()).not.toHaveProperty('remplacement');
    await app.close();
  });

  it('mapping explicite respecté (une colonne forcée en Ignorer)', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: {
        csv: 'A,B,C\nJulie,+33611111111,secret',
        optIn: true,
        mapping: { columns: { A: { target: 'name' }, B: { target: 'phone' }, C: { target: 'ignore' } } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(contacts.upserts[0]?.profileName).toBe('Julie');
    expect(contacts.upserts[0]?.phoneE164).toBe('+33611111111');
    expect(contacts.upserts[0]?.fields).toEqual({}); // C ignorée
    await app.close();
  });

  it('sans token -> 401', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      headers: { 'content-type': 'application/json' },
      payload: { csv: 'Tel\n+33611111111' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET liste des contacts du tenant -> 200', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ contacts: Array<{ profileName: string }> }>();
    expect(body.contacts[0]?.profileName).toBe('Julie');
    await app.close();
  });

  it('🔴 GET des segments : sans la fonction analyse (le Pro), la commande face à la dernière analyse n’est pas annoncée', async () => {
    const app = inject(new FakeContacts(), new FakeFields(), undefined, undefined, undefined, undefined, DROITS.pro.fonctions);
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('analyseCommandes');
    expect(res.json()).toMatchObject({ segmentsShopify: true });
  });

  it('GET des segments : la boutique, ses dates de suivi et celle de l’activité, en texte', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: ACTIVITE_COMPLETE_DEPUIS,
      // 🔴 L'annonce des critères produit (lot 3) : sans elle, la console ne les propose pas.
      produits: true,
      // 🔴 Et celle du critère de collection (lot 6a), de même.
      collections: true,
      // 🔴 Et celle du critère d'étiquette Shopify (lot 6b), de même.
      etiquettesShopify: true,
      // 🔴 Et celle du critère de segment Shopify (lot 6c), de même.
      segmentsShopify: true,
      // 🔴 Et celle de la commande face à la dernière analyse (lot 7b) : l'Entreprise, avec une boutique.
      analyseCommandes: true,
      // Les pastilles des deux boutons prêts (lot 4) : le faux compte rend 3.
      boutons: { ecritSansCommande: 3, clicSansCommande: 3 },
    });
    expect((await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments' })).statusCode).toBe(401);
    await app.close();
  });

  it('🔴 GET des segments : chaque pastille compte le bouton SEUL ; aucune sans boutique ; une panne les omet, la réponse reste', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields(), cap);
    const lire = () => app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments', headers: { authorization: `Bearer ${token}` } });
    expect((await lire()).json()).toMatchObject({ boutons: { ecritSansCommande: 3, clicSansCommande: 3 } });
    // Deux comptes, chacun avec le seul filtre de son bouton : jamais croisés avec d'autres filtres.
    expect(cap.countFilters).toEqual([
      { fieldFilters: [filtreSegment(CLES_SEGMENT.ecritSansCommande, true)] },
      { fieldFilters: [filtreSegment(CLES_SEGMENT.clicSansCommande, true)] },
    ]);
    // Sans boutique, le volet n'est pas là : ni pastille, ni compte.
    cap.countFilters.length = 0;
    Object.assign(contacts, { suiviSegments: async () => ({ boutique: null }) });
    const sans = await lire();
    expect(sans.statusCode).toBe(200);
    expect(sans.json()).not.toHaveProperty('boutons');
    // Ni la commande face à la dernière analyse (lot 7b), même en Entreprise : elle lit les commandes.
    expect(sans.json()).not.toHaveProperty('analyseCommandes');
    expect(cap.countFilters).toEqual([]);
    // Une panne des comptes : la réponse, garde de TOUS les critères de segment, reste ; seules les pastilles partent.
    Object.assign(contacts, {
      suiviSegments: async () => ({ boutique: { devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null } }),
      count: async () => { throw new Error('délai dépassé'); },
    });
    const panne = await lire();
    expect(panne.statusCode).toBe(200);
    expect(panne.json()).toMatchObject({ produits: true, boutique: { devise: 'EUR' } });
    expect(panne.json()).not.toHaveProperty('boutons');
    await app.close();
  });

  it('🔴 GET des collections lues (lot 6a) : la liste et l’état de la lecture, une lecture enfilée au besoin, la recherche bornée à 80 caractères ; 401 sans session', async () => {
    const c = monterCollections({ lignes: ['8801'], catalogue: { 8801: { titre: 'Sérum', collections: [{ id: '4401', titre: 'Été' }] } } });
    const app = inject(new FakeContacts(), new FakeFields(), undefined, undefined, c.deps);
    const lire = (q = '') => app.inject({ method: 'GET', url: `/tenants/t1/contacts/segments/collections${q}`, headers: { authorization: `Bearer ${token}` } });
    // Un produit commandé jamais lu : la lecture est demandée et enfilée, la liste dit « en cours ».
    const avant = await lire(`?q=${encodeURIComponent(`été${'x'.repeat(100)}`)}`);
    expect(avant.statusCode).toBe(200);
    expect(avant.json()).toEqual({ collections: [], lecture: { lueLe: null, enCours: true, refus: null, incompletes: false } });
    expect(c.trace.jobs).toEqual([{ job: { tenantId: 't1' }, dansSecondes: 0 }]);
    expect(c.trace.recherches).toEqual([`été${'x'.repeat(77)}`]);
    // Le job passé, la liste rend la collection lue et sa date ; plus rien à lire, rien n'est enfilé.
    await traiterCollections(c.deps, { tenantId: T_COLLECTIONS });
    const apres = await lire();
    expect(apres.json()).toEqual({
      collections: [{ collectionId: '4401', titre: 'Été', produits: 1 }],
      lecture: { lueLe: new Date(MIDI_COLLECTIONS).toISOString(), enCours: false, refus: null, incompletes: false },
    });
    expect(c.trace.jobs).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/collections' })).statusCode).toBe(401);
    await app.close();
  });

  it('🔴 GET des étiquettes Shopify lues (lot 6b) : la liste et l’état de la synchronisation, une lecture seule qui ne lance rien, la recherche bornée à 80 caractères ; 401 sans session', async () => {
    const e = monterEtiquettes({ etat: { allumee: true, synchroLe: new Date(MIDI_ETIQUETTES) } });
    e.etiquettes.set('c1', ['VIP']);
    e.etiquettes.set('c2', ['vip']);
    const recherches: Array<string | undefined> = [];
    const lire = e.deps.magasin.etiquettes;
    e.deps.magasin.etiquettes = async (t, q, limite) => { recherches.push(q); return lire(t, q, limite); };
    const app = inject(new FakeContacts(), new FakeFields(), undefined, undefined, undefined, e.deps);
    const res = await app.inject({ method: 'GET', url: `/tenants/t1/contacts/segments/etiquettes-shopify?q=${encodeURIComponent(`vip${'x'.repeat(100)}`)}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      etiquettes: [],
      synchro: {
        allumee: true, synchroLe: new Date(MIDI_ETIQUETTES).toISOString(), enCours: false, refus: null,
        comptes: { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 },
      },
    });
    expect(recherches).toEqual([`vip${'x'.repeat(77)}`]);
    const toutes = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/etiquettes-shopify', headers: { authorization: `Bearer ${token}` } });
    expect(toutes.json().etiquettes).toEqual([{ etiquette: 'VIP', fiches: 2 }]);
    expect(e.trace.jobs).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/etiquettes-shopify' })).statusCode).toBe(401);
    await app.close();
  });

  it('🔴 GET des segments Shopify lus (lot 6c) : la liste et l’état de la synchronisation, une lecture seule ; 401 sans session', async () => {
    const e = monterEtiquettes({
      etat: { allumee: true, synchroLe: new Date(MIDI_ETIQUETTES) },
      segmentsDeDepart: [{ segmentId: '12', nom: 'Hiver' }, { segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES, membres: 9, fiches: 4 }],
    });
    const app = inject(new FakeContacts(), new FakeFields(), undefined, undefined, undefined, e.deps);
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/segments-shopify', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      segments: [
        { segmentId: '11', nom: 'VIP', requete: null, suivi: true, absent: false, luLe: new Date(MIDI_ETIQUETTES).toISOString(), partiel: false, membres: 9, fiches: 4 },
        { segmentId: '12', nom: 'Hiver', requete: null, suivi: false, absent: false, luLe: null, partiel: false, membres: 0, fiches: 0 },
      ],
      synchro: {
        allumee: true, synchroLe: new Date(MIDI_ETIQUETTES).toISOString(), enCours: false, refus: null,
        comptes: { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 },
      },
    });
    expect(e.trace.jobs).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/segments-shopify' })).statusCode).toBe(401);
    await app.close();
  });

  it('GET des produits vus : la recherche de l’espace, 20 au plus, la requête bornée à 80 caractères ; 401 sans session', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [], produits: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const url = `/tenants/t1/contacts/segments/produits?q=${encodeURIComponent(`sérum${'x'.repeat(100)}`)}`;
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ produits: [{ produitId: '8801', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', commandes: 4 }] });
    expect(cap.produits).toEqual([{ t: 't1', recherche: `sérum${'x'.repeat(75)}`, limite: 20 }]);
    await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/produits', headers: { authorization: `Bearer ${token}` } });
    expect(cap.produits?.[1]).toEqual({ t: 't1', recherche: undefined, limite: 20 });
    expect((await app.inject({ method: 'GET', url: '/tenants/t1/contacts/segments/produits' })).statusCode).toBe(401);
    await app.close();
  });

  it('🔴 GET contacts avec un critère de segment malformé -> 400, jamais la liste entière', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const champs = (f: unknown[]) => '/tenants/t1/contacts?fields=' + encodeURIComponent(JSON.stringify(f));
    const res = await app.inject({ method: 'GET', url: champs([{ key: 'segment_commandes', op: 'segment', value: '{"min":0}' }]), headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
    expect(cap.queryFilters).toHaveLength(0);
    const ok = await app.inject({
      method: 'GET', url: champs([{ key: 'segment_pays', op: 'segment', value: '["be"]' }, { key: 'segment_actif', op: 'segment', value: '30' }]),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(cap.queryFilters).toEqual([{ fieldFilters: [
      { key: 'segment_pays', op: 'segment', value: '["BE"]' }, { key: 'segment_actif', op: 'segment', value: '30' },
    ] }]);
    await app.close();
  });

  it('GET contacts sans token -> 401', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET contacts AVEC filtres -> route sur queryContacts (+ total), pas listContacts', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const res = await app.inject({
      method: 'GET',
      url: '/tenants/t1/contacts?tags=vip,pro&tagMode=or&optIn=opted_in&phonePrefix=%2B336&phoneContains=12%2034&nameSearch=mar&fields=' + encodeURIComponent('[{"key":"ville","op":"contains","value":"par"}]'),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ contacts: Array<{ profileName: string }>; total: number }>();
    expect(body.contacts[0]?.profileName).toBe('Marc'); // vient de queryContacts, pas de listContacts (Julie)
    expect(body.total).toBe(3);
    expect(cap.queryFilters).toHaveLength(1);
    // Le parsing des query params -> ContactFilters typés.
    expect(cap.queryFilters[0]).toEqual({
      tags: ['vip', 'pro'], tagMode: 'or', optIn: 'opted_in', phonePrefix: '+336', phoneContains: '12 34', nameSearch: 'mar',
      fieldFilters: [{ key: 'ville', op: 'contains', value: 'par' }],
    });
    await app.close();
  });

  it('GET /contacts/count et /contacts/ids -> compteur + ids résolus par filtres', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const count = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/count?tags=vip', headers: { authorization: `Bearer ${token}` } });
    expect(count.statusCode).toBe(200);
    expect(count.json<{ total: number }>().total).toBe(3);
    expect(cap.countFilters[0]).toEqual({ tags: ['vip'] });
    const ids = await app.inject({ method: 'GET', url: '/tenants/t1/contacts/ids?optIn=opted_out', headers: { authorization: `Bearer ${token}` } });
    expect(ids.statusCode).toBe(200);
    expect(ids.json<{ ids: string[] }>().ids).toEqual(['c2', 'c3']);
    expect(cap.idsFilters[0]).toEqual({ optIn: 'opted_out' });
    await app.close();
  });

  it('GET contacts?risque=eleve -> chemin requêtable, avec le niveau', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts?risque=eleve', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contacts: Array<{ profileName: string }> }>().contacts[0]?.profileName).toBe('Marc');
    expect(cap.queryFilters).toEqual([{ risque: 'eleve' }]);
    expect(cap.countFilters).toEqual([{ risque: 'eleve' }]);
    await app.close();
  });

  it('🔴 un niveau de risque INCONNU est REFUSÉ en 400 sur la liste, le compte et les identifiants, jamais ignoré', async () => {
    // Ignoré, il ne poserait aucune clause : « élevé » mal écrit rendrait TOUT l'espace, et le compteur
    // annoncerait tout l'espace comme audience d'une campagne « risque élevé ».
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    for (const url of ['/tenants/t1/contacts?risque=%C3%A9lev%C3%A9', '/tenants/t1/contacts/count?risque=high', '/tenants/t1/contacts/ids?risque=critique']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode, url).toBe(400);
      expect(res.json<{ error: string }>().error, url).toMatch(/risque/);
    }
    expect(cap).toEqual({ queryFilters: [], countFilters: [], idsFilters: [] });
    await app.close();
  });

  it('GET contacts filtre de champ ILLISIBLE -> ignoré (pas de 500), retombe sur listContacts', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts?fields=pas-du-json', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    // Aucun filtre valide -> chemin historique listContacts (Julie), queryContacts jamais appelé.
    expect(res.json<{ contacts: Array<{ profileName: string }> }>().contacts[0]?.profileName).toBe('Julie');
    expect(cap.queryFilters).toHaveLength(0);
    await app.close();
  });

  it('GET contacts avec un filtre de champ sans valeur garde le chemin sans filtre', async () => {
    const cap: QueryCapture = { queryFilters: [], countFilters: [], idsFilters: [] };
    const app = inject(new FakeContacts(), new FakeFields(), cap);
    const fields = encodeURIComponent(JSON.stringify([{ key: 'ville', op: 'eq', value: '' }]));
    const res = await app.inject({ method: 'GET', url: `/tenants/t1/contacts?fields=${fields}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contacts: Array<{ profileName: string }> }>().contacts[0]?.profileName).toBe('Julie');
    expect(cap.queryFilters).toEqual([]);
    expect(cap.countFilters).toEqual([]);
    await app.close();
  });

  it('GET contacts/count d un autre tenant -> 403', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({ method: 'GET', url: '/tenants/AUTRE/contacts/count', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('token d un autre tenant -> 403', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/AUTRE/contacts/import',
      ...auth(),
      payload: { csv: 'Tel\n+33611111111' },
    });
    expect(res.statusCode).toBe(403);
    expect(contacts.upserts).toHaveLength(0);
    await app.close();
  });

  it('csv absent -> 400', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('mapping malformé (sans columns) -> 400, pas de 500', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: { csv: 'Tel\n+33611111111', mapping: { foo: 'bar' } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('optIn: false explicite -> statut unknown (le defaut opt-in de la route ne l’ecrase pas)', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: { csv: 'Téléphone\n+33611111111', optIn: false },
    });
    expect(res.statusCode).toBe(200);
    expect(contacts.upserts[0]?.optInStatus).toBe('unknown');
    await app.close();
  });

  /**
   * 🔴 LA CASE COCHÉE D'UN IMPORT CSV EST LE SEUL IMPORT QUI PEUT RÉABONNER QUELQU'UN QUI A DIT STOP (décision de
   * Julien du 2026-09-26) : c'est l'opérateur qui le demande. L'import HubSpot, le webhook entrant et la
   * création à la main ne le peuvent pas.
   */
  it('🔴 case cochée : le lot peut lever un STOP ; décochée, non', async () => {
    const coche = new FakeContacts();
    const decoche = new FakeContacts();
    for (const [contacts, optIn] of [[coche, true], [decoche, false]] as const) {
      const app = inject(contacts, new FakeFields());
      const res = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv: 'Téléphone\n+33611111111', optIn } });
      expect(res.statusCode).toBe(200);
      await app.close();
    }
    expect(coche.autorites).toEqual(['import_csv_coche']);
    expect(decoche.autorites).toEqual(['import']);
  });

  // RBAC (Feature 2) : les contacts (PII : téléphones E164, opt-in) sont réservés aux admins.
  // L'agent (inbox uniquement) doit être refusé (403) AVANT tout accès au store.
  describe('RBAC — agent refusé sur contacts/import', () => {
    it('GET /contacts agent -> 403', async () => {
      const app = inject(new FakeContacts(), new FakeFields());
      const res = await app.inject({ method: 'GET', url: '/tenants/t1/contacts', ...asAgent() });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('POST /import agent -> 403 (aucune écriture)', async () => {
      const contacts = new FakeContacts();
      const app = inject(contacts, new FakeFields());
      const res = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...asAgent(), payload: { csv: 'Tel\n+33611111111', optIn: true } });
      expect(res.statusCode).toBe(403);
      expect(contacts.upserts).toHaveLength(0); // court-circuit au preHandler, store intact
      await app.close();
    });

    it('POST /import/preview agent -> 403', async () => {
      const app = inject(new FakeContacts(), new FakeFields());
      const res = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import/preview', ...asAgent(), payload: { csv: 'Tel\n+33611111111' } });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });
});

describe('journal d’audit de l’import', { timeout: 30_000 }, () => {
  // Littéral multi-ligne : le CSV porte de vrais sauts de ligne, comme le corps réel de la requête.
  const csv = `Nom,Téléphone
Julie,+33611111111
Marc,0622222222`;

  it('🔴 un import laisse UNE trace pour le LOT, jamais une par contact', async () => {
    // Un import de 50 000 lignes écrirait 50 000 entrées et noierait l'historique qu'on cherche à rendre
    // lisible. C'est aussi la principale façon dont des personnes entrent dans la base : sans trace, personne
    // ne peut dire d'où vient un contact ni qui l'a chargé.
    const journal: Trace[] = [];
    const app = inject(new FakeContacts(), new FakeFields(), undefined, journal);
    const res = await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv, optIn: true, tags: 'salon' } });
    expect(res.statusCode).toBe(200);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      action: 'contact.imported',
      target: { kind: 'contact', id: 'lot' },
      detail: { created: 2, updated: 0, skipped: 0, optIn: true, tags: 1 },
      actor: { userId: 'u1' },
    });
    await app.close();
  });

  it('🔴 la trace ne porte AUCUN numéro ni nom, seulement des compteurs', async () => {
    const journal: Trace[] = [];
    const app = inject(new FakeContacts(), new FakeFields(), undefined, journal);
    await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv, optIn: true } });
    const serialise = JSON.stringify(journal);
    expect(serialise).not.toMatch(/[0-9]{9,}/); // aucun numéro, sous aucune forme
    expect(serialise.toLowerCase()).not.toContain('julie');
    await app.close();
  });

  it('🔴 corps SANS `optIn` -> import OPT-IN, et le journal le dit', async () => {
    // L'écran d'import a sa case pré-cochée et envoie toujours le booléen, donc ce défaut ne se voit pas
    // depuis l'interface. Il compte quand même : un appel qui omet le champ chargerait sinon une liste entière
    // que le garde-fou de campagne écarte ensuite du marketing (il exige un opt-in EXPLICITE), en silence.
    const journal: Trace[] = [];
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields(), undefined, journal);
    await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv } });
    expect(contacts.upserts.every((c) => c.optInStatus === 'opted_in')).toBe(true);
    expect(journal[0]?.detail).toMatchObject({ optIn: true });
    await app.close();
  });

  it('🔴 `optIn: false` explicite reste respecté : le défaut ne l’écrase pas', async () => {
    const journal: Trace[] = [];
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields(), undefined, journal);
    await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv, optIn: false } });
    expect(contacts.upserts.every((c) => c.optInStatus === 'unknown')).toBe(true);
    expect(journal[0]?.detail).toMatchObject({ optIn: false });
    await app.close();
  });

  it('un CSV REFUSÉ ne laisse aucune trace', async () => {
    const journal: Trace[] = [];
    const app = inject(new FakeContacts(), new FakeFields(), undefined, journal);
    expect((await app.inject({ method: 'POST', url: '/tenants/t1/contacts/import', ...auth(), payload: { csv: '' } })).statusCode).toBe(400);
    expect(journal).toEqual([]);
    await app.close();
  });
});

/**
 * Le mur du volume (AUDIT-SCALE-2026-08-25.md, R9). Le plafond de corps GLOBAL est de 1 Mo et la route
 * d'import ne le relevait pas : au-delà d'environ 14 000 lignes, l'opérateur recevait un 413 au message
 * anglais brut de Fastify, sans savoir quoi faire. Deux garanties ici : la route d'import accepte
 * beaucoup plus que le plafond global, et le refus, quand il tombe, est en français et dit l'issue.
 */
describe('import : plafond de corps dédié et refus lisible', { timeout: 30_000 }, () => {
  /** CSV synthétique d'environ `mo` mégaoctets (en-tête + lignes de ~40 caractères). */
  function gros(mo: number): string {
    const lignes = ['Nom,Telephone'];
    for (let i = 0; lignes.length * 26 < mo * 1024 * 1024; i += 1) {
      lignes.push(`Nom${String(i).padStart(7, '0')},+336${String(i).padStart(8, '0')}`);
    }
    return lignes.join('\n');
  }

  it('CSV de 2 Mo -> importé (le plafond global de 1 Mo ne s\'applique plus à cette route)', async () => {
    const contacts = new FakeContacts();
    const app = inject(contacts, new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import',
      ...auth(),
      payload: { csv: gros(2), optIn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ created: number }>().created).toBeGreaterThan(50_000);
    // Et l'écriture reste groupée : des dizaines de milliers de lignes, quelques centaines de requêtes.
    expect(contacts.lots).toBeLessThan(200);
    await app.close();
  });

  it('corps qui dépasse le plafond de l\'aperçu -> 413 avec un message EN FRANÇAIS qui dit quoi faire', async () => {
    const app = inject(new FakeContacts(), new FakeFields());
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/t1/contacts/import/preview',
      ...auth(),
      payload: { csv: gros(3) },
    });
    expect(res.statusCode).toBe(413);
    const message = res.json<{ error: string }>().error;
    expect(message).toContain('trop volumineux');
    expect(message).toContain('Découpe');
    expect(message).not.toContain('body'); // plus le « Request body is too large » de Fastify
    await app.close();
  });

  it('🔴 un fichier lent à lire ne bloque pas la boucle d’événements, sur l’aperçu comme sur l’import', async () => {
    // Relevé le 2026-09-30 : lu dans le fil principal, un tel fichier (guillemets mal placés puis des espaces, un
    // coût en N x K dans papaparse) figeait l'API pour tous les espaces. Il se lit désormais dans un worker.
    const app = inject(new FakeContacts(), new FakeFields());
    await app.ready(); // le démarrage du serveur ne doit pas entrer dans la mesure
    for (const url of ['/tenants/t1/contacts/import/preview', '/tenants/t1/contacts/import']) {
      const { retard, duree, resultat } = await retardPendant(() =>
        app.inject({ method: 'POST', url, ...auth(), payload: { csv: csvLent(1_000, 200_000), optIn: true } }));
      expect(resultat.statusCode, url).not.toBe(500);
      expect(duree, url).toBeGreaterThan(500);
      expect(retard, url).toBeLessThan(duree / 4);
    }
    await app.close();
  }, 30_000);

  it('🔴 en-tête de plus de 16 384 colonnes -> 400 en français, sur l’aperçu comme sur l’import, rien d’écrit', async () => {
    // Une ligne unique de 8 Mo occupait l'API plusieurs secondes, pour tous les espaces (mesuré le 2026-09-30).
    const contacts = new FakeContacts();
    const journal: Trace[] = [];
    const app = inject(contacts, new FakeFields(), undefined, journal);
    const csv = `${Array(16_385).fill('Tel').join(';')}\n+33611111111`;
    for (const url of ['/tenants/t1/contacts/import/preview', '/tenants/t1/contacts/import']) {
      const res = await app.inject({ method: 'POST', url, ...auth(), payload: { csv, optIn: true } });
      expect(res.statusCode, url).toBe(400);
      expect(res.json<{ error: string }>().error, url).toContain('16385 colonnes');
    }
    expect(contacts.upserts).toHaveLength(0);
    expect(journal).toEqual([]);
    await app.close();
  });
});
