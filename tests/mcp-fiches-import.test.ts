import { describe, it, expect } from 'vitest';
import { OUTILS, RefusOutil, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { LimiteOffreError } from '../src/offres/refus';
import type { LotContacts } from '../src/crm/import';
import type { UserFieldDef } from '../src/crm/types';

/**
 * L'IMPORT, LES LISTES DE CONFORMITÉ ET L'HISTOIRE D'UNE FICHE DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 1b) :
 * chaque outil appelle la MÊME fonction ou le MÊME magasin que la route (`apercuImport`, `importerCsv`, `refusPossibles`,
 * `exporterHistorique`). Les faux sont des classes dont les méthodes lisent `this`, comme les vrais magasins, et chacun
 * note l'espace visé.
 */
const T = 't1';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const FICHE = '00000000-0000-4000-8000-0000000000a1';
const CSV = 'Téléphone,Nom,Ville\n+33612345678,Claire,Lyon\n+33612345679,Paul,Nantes';
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

class FauxContacts {
  readonly lots: LotContacts[] = [];
  readonly places: Array<{ tenant: string; numeros: readonly string[] }> = [];
  constructor(private readonly o: { remplacer?: boolean; limite?: number; comptees?: number; pleine?: boolean } = {}) {}
  async upsertManyByPhone(lot: LotContacts): Promise<Array<'created' | 'updated'>> {
    this.lots.push(lot);
    return lot.contacts.map(() => 'created' as const);
  }
  async verifierPlaceContacts(tenantId: string): Promise<void> {
    if (this.o.pleine === true) throw new LimiteOffreError(tenantId, 'contacts', 100);
  }
  async placesContacts(tenant: string, numeros: readonly string[]) {
    this.places.push({ tenant, numeros });
    return { limite: this.o.limite ?? null, comptees: this.o.comptees ?? 0, presents: new Set<string>(), remplacer: this.o.remplacer === true };
  }
  readonly desabonnes = [{ id: 'c1', profileName: 'Marc', phoneE164: '+33611111111', desabonneLe: '2026-11-20T10:00:00.000Z', source: 'crm' }];
  readonly bloques = [{ id: 'c2', profileName: null, phoneE164: '+33622222222', blockedAt: '2026-11-21T10:00:00.000Z' }];
  async listeDesabonnes(tenant: string) { return tenant === T ? this.desabonnes : []; }
  async listBlocked(tenant: string) { return tenant === T ? this.bloques : []; }
  async messagesARelire(tenant: string) {
    const m = (id: string, body: string) => ({
      messageId: id, conversationId: 'cv1', contactId: 'c3', waId: '33633333333', profileName: 'Lou', body, recuLe: '2026-11-22T10:00:00.000Z',
    });
    return tenant === T
      ? { scannes: this.lots.length + 3, messages: [m('m1', 'arrêtez de me contacter'), m('m2', 'STOP'), m('m3', 'merci beaucoup')] }
      : { scannes: 0, messages: [] };
  }
}

class FauxChamps {
  readonly crees: Array<{ tenant: string; def: UserFieldDef }> = [];
  async list(tenant: string): Promise<UserFieldDef[]> { return tenant === T ? this.crees.map((c) => c.def) : []; }
  async upsert(tenant: string, def: UserFieldDef): Promise<void> { this.crees.push({ tenant, def }); }
}

class FauxHistorique {
  readonly lus: string[] = [];
  async getContactHistory(tenant: string, id: string) {
    this.lus.push(`historique ${tenant} ${id}`);
    return tenant === T && id === FICHE ? { sends: [], conversations: [] } : null;
  }
  async listSendsForExport(tenant: string, id: string) {
    this.lus.push(`export ${tenant} ${id}`);
    return tenant === T && id === FICHE ? [{ campaignId: 'k1', campaignName: 'Soldes', status: 'sent' }, { campaignId: 'k2', campaignName: 'Relance', status: 'failed' }] : null;
  }
}

class FauxChiffrage {
  readonly lus: string[] = [];
  async getBilanContact(tenant: string, id: string) {
    this.lus.push(`${tenant} ${id}`);
    return tenant === T && id === FICHE
      ? {
        cout: { envoyes: 3, cout: 0.24, nonChiffrables: 1, sansCategorie: 1, sansTarif: 0, currency: 'EUR' },
        entonnoir: [{ niveau: 1, parcours: 2 }, { niveau: 2, parcours: 1 }],
      }
      : null;
  }
}

function monter(o: { contacts?: FauxContacts; plafondAccepte?: boolean } = {}) {
  const contacts = o.contacts ?? new FauxContacts();
  const champs = new FauxChamps();
  const historique = new FauxHistorique();
  const chiffrage = new FauxChiffrage();
  const consommes: string[] = [];
  const audits: Array<{ tenant: string; userId: string | null; action: string; detail: unknown }> = [];
  const deps = {
    couteux: {
      consommer: async (t: string) => { consommes.push(t); return o.plafondAccepte === false ? { accepte: false, attenteMs: 30_000 } : { accepte: true }; },
    },
    importCsv: { contacts, userFields: champs, defaultCountry: 'FR' },
    listesContacts: contacts,
    historiqueContacts: historique,
    bilanContact: chiffrage,
    journal: async (tenant: string, acteur: { userId: string | null }, action: string, _cible: unknown, detail: unknown) => {
      audits.push({ tenant, userId: acteur.userId, action, detail });
    },
  } as unknown as DepsMcp;
  return { deps, contacts, champs, historique, chiffrage, consommes, audits };
}

describe('l’import, les listes de conformité et l’histoire d’une fiche depuis Claude (CSM, B10, livraison 1b)', () => {
  it('🔴 l’import et l’export RGPD sont réservés à une personne ; les lectures sont ouvertes à une clé d’API', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['import_contacts', 'export_contact_history']) expect(cle, nom).not.toContain(nom);
    for (const nom of ['preview_contacts_import', 'list_unsubscribed_contacts', 'list_possible_refusals', 'list_blocked_contacts', 'get_contact_history', 'get_contact_report']) {
      expect(cle, nom).toContain(nom);
    }
  });

  it('preview_contacts_import : le fichier lu comme l’import le lira, le mapping en liste, rien d’écrit, le plafond consommé', async () => {
    const { deps, contacts, consommes } = monter();
    const r = await outil('preview_contacts_import').executer(deps, T, { csv: CSV }, MOI) as Record<string, unknown>;
    expect(r).toMatchObject({ headers: ['Téléphone', 'Nom', 'Ville'], row_count: 2 });
    expect(r.mapping).toEqual([
      { header: 'Téléphone', target: 'phone' }, { header: 'Nom', target: 'name' }, { header: 'Ville', target: 'custom', key: 'ville' },
    ]);
    expect(r).not.toHaveProperty('replacement');
    expect(contacts.lots).toEqual([]);
    expect(consommes).toEqual([T]);
  });

  it('preview_contacts_import : un espace plein qui fait de la place annonce les nouveaux numéros et les places libres', async () => {
    const { deps, contacts } = monter({ contacts: new FauxContacts({ remplacer: true, limite: 100, comptees: 99 }) });
    const r = await outil('preview_contacts_import').executer(deps, T, { csv: CSV }, MOI);
    expect(r).toMatchObject({ replacement: { new_numbers: 2, free_places: 1, oldest_deleted: 1 } });
    expect(contacts.places.at(-1)).toEqual({ tenant: T, numeros: ['+33612345678', '+33612345679'] });
  });

  it('🔴 import_contacts : l’autorité `import` même quand l’accord est déclaré (un STOP reste un STOP), la trace au nom de la personne', async () => {
    const { deps, contacts, audits, consommes } = monter();
    const r = await outil('import_contacts').executer(deps, T, { csv: CSV, opt_in: true, tags: ['salon'] }, MOI);
    expect(r).toEqual({ created: 2, updated: 0, skipped: 0, errors: [], oldest_deleted: 0 });
    expect(consommes).toEqual([T]);
    expect(contacts.lots).toHaveLength(1);
    expect(contacts.lots[0]).toMatchObject({ tenantId: T, autorite: 'import', optInStatus: 'opted_in', tags: ['salon'] });
    expect(contacts.lots[0]!.contacts).toEqual([
      { phoneE164: '+33612345678', profileName: 'Claire', fields: { ville: 'Lyon' } },
      { phoneE164: '+33612345679', profileName: 'Paul', fields: { ville: 'Nantes' } },
    ]);
    expect(audits).toEqual([{ tenant: T, userId: 'u1', action: 'contact.imported', detail: { created: 2, updated: 0, skipped: 0, optIn: true, tags: 1 } }]);
  });

  it('import_contacts : le mapping donné en liste, une colonne ignorée ; opt_in: false ne déclare rien', async () => {
    const { deps, contacts } = monter();
    await outil('import_contacts').executer(deps, T, {
      csv: CSV, opt_in: false,
      mapping: [{ header: 'Téléphone', target: 'phone' }, { header: 'Nom', target: 'ignore' }, { header: 'Ville', target: 'custom', key: 'commune' }],
    }, MOI);
    expect(contacts.lots[0]).toMatchObject({ autorite: 'import', optInStatus: 'unknown' });
    expect(contacts.lots[0]!.contacts[0]).toEqual({ phoneE164: '+33612345678', profileName: null, fields: { commune: 'Lyon' } });
  });

  it('🔴 import_contacts : l’accord se dit, et chaque argument est vérifié avant toute écriture', async () => {
    const { deps, contacts, consommes } = monter();
    for (const args of [
      { csv: CSV }, // l'accord omis serait déclaré par défaut
      { csv: CSV, opt_in: 'true' },
      // Chaque mapping porte un téléphone : sinon son refus masquerait celui qu'on vérifie.
      { csv: CSV, opt_in: true, mapping: [{ header: 'Téléphone', target: 'phone' }, { header: 'Ville', target: 'adresse' }] },
      { csv: CSV, opt_in: true, mapping: [{ header: 'Téléphone', target: 'phone' }, { header: 'Ville', target: 'custom' }] },
      { csv: CSV, opt_in: true, mapping: [{ header: 'Téléphone', target: 'phone' }, { header: 'Nom', target: 'name' }, { header: 'Nom', target: 'ignore' }] },
      { csv: CSV, opt_in: true, tags: [42] },
      { csv: CSV, opt_in: true, mapping: [{ header: 'Nom', target: 'name' }] }, // sans téléphone, chaque ligne serait écartée
      { csv: CSV, opt_in: true, delete_oldest: -1 },
      { csv: CSV, opt_in: true, delete_oldest: 1.5 },
      { csv: CSV, opt_in: true, delete_oldest: '2' },
    ]) {
      await expect(outil('import_contacts').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(contacts.lots).toEqual([]);
    expect(consommes).toEqual([]);
  });

  it('🔴 import_contacts : la limite de l’offre refuse tout le fichier, avec sa cause et le lien de l’offre, sans trace', async () => {
    const { deps, contacts, audits } = monter({ contacts: new FauxContacts({ pleine: true }) });
    const e = await outil('import_contacts').executer(deps, T, { csv: CSV, opt_in: true }, MOI).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RefusOutil);
    expect(e).toMatchObject({ code: 'plan_limit', precisions: { cause: 'plan_limit_reached' } });
    expect((e as RefusOutil).precisions.action).toMatch(/\/offre/);
    expect(contacts.lots).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('🔴 import_contacts : un import qui effacerait les plus anciens est refusé avec leur nombre, et passe avec delete_oldest', async () => {
    // Plein à 99 sur 100, l'option cochée : deux numéros nouveaux, une place, donc un effacement.
    const plein = () => monter({ contacts: new FauxContacts({ remplacer: true, limite: 100, comptees: 99 }) });
    const a = plein();
    const e = await outil('import_contacts').executer(a.deps, T, { csv: CSV, opt_in: true }, MOI).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RefusOutil);
    expect(e).toMatchObject({ code: 'conflict', message: expect.stringMatching(/le contact le plus ancien[\s\S]*delete_oldest: 1/) });
    await expect(outil('import_contacts').executer(a.deps, T, { csv: CSV, opt_in: true, delete_oldest: 0 }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    expect(a.contacts.lots).toEqual([]);
    expect(a.audits).toEqual([]);
    const b = plein();
    const r = await outil('import_contacts').executer(b.deps, T, { csv: CSV, opt_in: true, delete_oldest: 1 }, MOI);
    expect(r).toMatchObject({ created: 2, oldest_deleted: 1 });
    expect(b.contacts.lots).toHaveLength(1);
  });

  it('un CSV que le lecteur refuse (16 385 colonnes) revient en refus lisible, jamais en échec interne', async () => {
    const { deps } = monter();
    const large = `${Array.from({ length: 16_385 }, (_, i) => `c${i}`).join(',')}\n`;
    for (const nom of ['preview_contacts_import', 'import_contacts']) {
      const e = await outil(nom).executer(deps, T, { csv: large, opt_in: true }, MOI).catch((x: unknown) => x);
      expect(e, nom).toBeInstanceOf(RefusOutil);
      expect(e, nom).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/colonnes/) });
    }
  });

  it('🔴 le CSV part tel quel : un TSV dont la première cellule d’en-tête est vide ne glisse pas d’une colonne', async () => {
    const { deps, contacts } = monter();
    await outil('import_contacts').executer(deps, T, {
      csv: '\tNom\tTéléphone\n1\tClaire\t+33612345678', opt_in: false,
      mapping: [{ header: 'Nom', target: 'name' }, { header: 'Téléphone', target: 'phone' }],
    }, MOI);
    expect(contacts.lots[0]!.contacts).toEqual([{ phoneE164: '+33612345678', profileName: 'Claire', fields: {} }]);
  });

  it('les listes de conformité : désabonnés, refus possibles (le seul message ambigu), bloqués', async () => {
    const { deps } = monter();
    expect(await outil('list_unsubscribed_contacts').executer(deps, T, {}, MOI)).toEqual({
      contacts: [{ id: 'c1', name: 'Marc', phone: '+33611111111', unsubscribed_at: '2026-11-20T10:00:00.000Z', source: 'crm' }],
    });
    expect(await outil('list_possible_refusals').executer(deps, T, {}, MOI)).toEqual({
      scanned: 3,
      refusals: [{
        message_id: 'm1', conversation_id: 'cv1', contact_id: 'c3', wa_id: '33633333333', name: 'Lou',
        text: 'arrêtez de me contacter', received_at: '2026-11-22T10:00:00.000Z',
      }],
    });
    expect(await outil('list_blocked_contacts').executer(deps, T, {}, MOI)).toEqual({
      contacts: [{ id: 'c2', name: null, phone: '+33622222222', blocked_at: '2026-11-21T10:00:00.000Z' }],
    });
  });

  it('get_contact_history et get_contact_report : la fiche de l’espace, un identifiant illisible refusé, une inconnue introuvable', async () => {
    const { deps, historique, chiffrage } = monter();
    expect(await outil('get_contact_history').executer(deps, T, { contact_id: FICHE }, MOI)).toEqual({ sends: [], conversations: [] });
    expect(historique.lus).toEqual([`historique ${T} ${FICHE}`]);
    expect(await outil('get_contact_report').executer(deps, T, { contact_id: FICHE }, MOI)).toEqual({
      cost: { sent: 3, estimate: 0.24, currency: 'EUR', not_priced: 1, without_category: 1, without_rate: 0 },
      funnel: [{ level: 1, journeys: 2 }, { level: 2, journeys: 1 }],
    });
    expect(chiffrage.lus).toEqual([`${T} ${FICHE}`]);
    await expect(outil('get_contact_history').executer(deps, T, { contact_id: 'c1' }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    const autre = '00000000-0000-4000-8000-0000000000ff';
    await expect(outil('get_contact_history').executer(deps, T, { contact_id: autre }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('get_contact_report').executer(deps, T, { contact_id: autre }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 export_contact_history : tous les envois, la trace au nom de la personne (le nombre, jamais le contenu)', async () => {
    const { deps, audits, consommes } = monter();
    const r = await outil('export_contact_history').executer(deps, T, { contact_id: FICHE }, MOI);
    expect(r).toEqual({ sends: [{ campaignId: 'k1', campaignName: 'Soldes', status: 'sent' }, { campaignId: 'k2', campaignName: 'Relance', status: 'failed' }] });
    expect(audits).toEqual([{ tenant: T, userId: 'u1', action: 'contact.exporte', detail: { envois: 2, via: 'mcp', autorisation: 'aut-1' } }]);
    expect(consommes).toEqual([T]);
  });

  it('🔴 export_contact_history : une fiche inconnue ne laisse aucune trace ; le plafond refusé ne lit rien', async () => {
    const a = monter();
    await expect(outil('export_contact_history').executer(a.deps, T, { contact_id: '00000000-0000-4000-8000-0000000000ff' }, MOI))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(a.audits).toEqual([]);
    const b = monter({ plafondAccepte: false });
    await expect(outil('export_contact_history').executer(b.deps, T, { contact_id: FICHE }, MOI)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(b.historique.lus).toEqual([]);
    expect(b.audits).toEqual([]);
  });
});
