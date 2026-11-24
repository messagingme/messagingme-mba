import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { ContactsDep, ContactsRouteDeps } from '../src/http/contacts';
import type { BulkTarget, LigneAExporter } from '../src/crm/contact-store.pg';
import { creerTravauxEnVol } from '../src/lib/en-vol';
import { colonnesExportables, estChampIntegration, EXPORT_CONTACTS_MAX } from '../web/lib/partage/export-contacts';
import { valeurExportee } from '../src/crm/export-contacts';

/**
 * L'EXPORT CSV D'UNE SÉLECTION DU MINI-CRM (2026-11-24) : chaque colonne est choisie, et ni les étiquettes ni les données
 * HubSpot ou Shopify ne sortent. La requête elle-même (espace, fiches vivantes, clés demandées) :
 * `tests/integration/contacts-export.integration.test.ts`.
 */

const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });
const url = '/tenants/t1/contacts/export';
const UUID = '0b6f3d1e-6a43-4c2b-9d7e-2a1f0c9b8e71';

const LIGNE: LigneAExporter = {
  phoneE164: '+33612345678', bsuid: null, externalId: 'crm-42', profileName: 'Léa', optInStatus: 'opted_in',
  createdAt: '2026-11-01T09:00:00.000Z', champs: { prenom: 'Léa', ville: 'Lyon', score: 12 },
};

interface Appel { tenant: string; target: BulkTarget; cles: readonly string[]; limite: number }

function app(lignes: LigneAExporter[] = [LIGNE]) {
  const appels: Appel[] = [];
  const journal: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const contacts: Partial<ContactsDep> = {
    lignesAExporter: async (tenant, target, cles, limite) => { appels.push({ tenant, target, cles: [...cles], limite }); return lignes; },
  };
  const deps = {
    contacts,
    champs: {
      list: async () => [
        { key: 'ville', label: 'Ville', type: 'text' },
        { key: 'score', label: 'Score', type: 'number' },
        { key: 'prenom', label: 'Prénom', type: 'text' },
        { key: 'hs_contact_secteur', label: 'Secteur (HubSpot)', type: 'text' },
        { key: 'shopify_lien_suivi', label: 'Lien de suivi (Shopify)', type: 'url' },
      ],
    },
    audit: async (_t: string, _a: unknown, action: string, _target: unknown, detail: Record<string, unknown> = {}) => { journal.push({ action, detail }); },
    enVol: creerTravauxEnVol(),
  } as unknown as ContactsRouteDeps;
  return { server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, contacts: deps }), appels, journal };
}

describe('les colonnes exportables', () => {
  it('🔴 la base, puis les champs perso, sans HubSpot, sans Shopify, sans doublon de la base', () => {
    const cles = colonnesExportables([
      { key: 'prenom', label: 'Prénom' }, { key: 'ville', label: 'Ville' },
      { key: 'hs_deal_montant', label: 'Montant (HubSpot)' }, { key: 'hs_calc_conseiller', label: 'Conseiller (HubSpot)' },
      { key: 'shopify_lien_suivi', label: 'Lien de suivi (Shopify)' },
    ]).map((c) => c.cle);
    expect(cles).toEqual(['name', 'prenom', 'nom_de_famille', 'phone', 'bsuid', 'wa_id', 'email', 'opt_in', 'external_id', 'created_at', 'ville']);
    expect(cles).not.toContain('tags');
    expect(estChampIntegration('hs_contact_secteur')).toBe(true);
    expect(estChampIntegration('ville')).toBe(false);
  });

  it('la valeur de chaque colonne : le WhatsApp ID depuis le numéro, un champ non texte en JSON, l’absent vide', () => {
    expect(valeurExportee(LIGNE, 'wa_id')).toBe('33612345678');
    expect(valeurExportee({ ...LIGNE, phoneE164: null, bsuid: 'FR.abc' }, 'wa_id')).toBe('FR.abc');
    expect(valeurExportee(LIGNE, 'score')).toBe('12');
    expect(valeurExportee(LIGNE, 'ville')).toBe('Lyon');
    expect(valeurExportee(LIGNE, 'email')).toBeNull();
    expect(valeurExportee(LIGNE, 'opt_in')).toBe('opted_in');
  });
});

describe('POST /contacts/export', () => {
  it('rend les seules colonnes cochées, dans l’ordre demandé, et ne lit en base que les clés de champs utiles', async () => {
    const { server, appels } = app();
    const res = await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { ids: [UUID] }, colonnes: ['phone', 'prenom', 'ville', 'name'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ colonnes: ['phone', 'prenom', 'ville', 'name'], lignes: [['+33612345678', 'Léa', 'Lyon', 'Léa']] });
    expect(appels).toEqual([{ tenant: 't1', target: { ids: [UUID] }, cles: ['prenom', 'ville'], limite: EXPORT_CONTACTS_MAX + 1 }]);
    await server.close();
  });

  it('🔴 refuse une étiquette, un champ HubSpot ou Shopify, une colonne inconnue : rien n’est lu', async () => {
    for (const colonne of ['tags', 'hs_contact_secteur', 'shopify_lien_suivi', 'analyse_sentiment', 'inconnue']) {
      const { server, appels } = app();
      const res = await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { ids: [UUID] }, colonnes: ['phone', colonne] } });
      expect(res.statusCode, colonne).toBe(400);
      expect(res.json<{ error: string }>().error).toContain(colonne);
      expect(appels).toEqual([]);
      await server.close();
    }
  });

  it('refuse sans colonne ou sans cible', async () => {
    const { server, appels } = app();
    for (const payload of [{ target: { ids: [UUID] }, colonnes: [] }, { target: { ids: [UUID] } }, { colonnes: ['phone'] }]) {
      const res = await server.inject({ method: 'POST', url, ...h(adminTok), payload });
      expect(res.statusCode).toBe(400);
    }
    expect(appels).toEqual([]);
    await server.close();
  });

  it('un identifiant qui n’est pas un UUID est retiré de la cible, au lieu de faire échouer la requête', async () => {
    const { server, appels } = app();
    const res = await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { ids: [UUID, 'pas-un-uuid'] }, colonnes: ['phone'] } });
    expect(res.statusCode).toBe(200);
    expect(appels[0]!.target).toEqual({ ids: [UUID] });
    // Même chose pour les exclusions d'une sélection « tous les contacts ».
    await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { filters: {}, excludeIds: [UUID, 'x'] }, colonnes: ['phone'] } });
    expect(appels[1]!.target).toEqual({ filters: {}, excludeIds: [UUID] });
    await server.close();
  });

  it('🔴 au-delà du plafond, refus : rien n’est rendu ni tracé', async () => {
    const { server, journal } = app(Array.from({ length: EXPORT_CONTACTS_MAX + 1 }, () => LIGNE));
    const res = await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { filters: {} }, colonnes: ['phone'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('filtres');
    expect(journal).toEqual([]);
    await server.close();
  });

  it('🔴 l’extraction est tracée au journal : le nombre et les colonnes, jamais les valeurs', async () => {
    const { server, journal } = app();
    await server.inject({ method: 'POST', url, ...h(adminTok), payload: { target: { ids: [UUID] }, colonnes: ['phone', 'ville'] } });
    expect(journal).toEqual([{ action: 'contacts.exportes', detail: { contacts: 1, colonnes: ['phone', 'ville'] } }]);
    expect(JSON.stringify(journal)).not.toContain('+33612345678');
    await server.close();
  });

  it('🔴 réservé à l’admin', async () => {
    const { server, appels } = app();
    const res = await server.inject({ method: 'POST', url, ...h(agentTok), payload: { target: { ids: [UUID] }, colonnes: ['phone'] } });
    expect(res.statusCode).toBe(403);
    expect(appels).toEqual([]);
    await server.close();
  });
});
