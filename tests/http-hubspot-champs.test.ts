import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { HubspotChampsRouteDeps } from '../src/http/hubspot-champs';
import type { ChampChoisi, ChampLibelle } from '../src/hubspot-workflow/champs';
import {
  ConnecteurEnReveil, ConnecteurPasAJour, HubspotServiceError, ProprietesInconnues, ReconsentRequiredError, type ChampsDuPortail,
} from '../src/crm/hubspot-service';

/**
 * `GET` et `PUT /tenants/:t/hubspot/champs` (lot 2 du 2026-11-02) : le client choisit les champs HubSpot que les workflows
 * écrivent sur ses fiches. 🔴 Trois choses se prouvent ici : les libellés viennent du connecteur, jamais du corps ; les
 * champs de fiche sont DÉCLARÉS AVANT que la liste soit posée ; un connecteur pas encore à jour ne se lit jamais
 * « aucun champ ». L'offre (`crm`) est posée au montage : `tests/offres-fonctions.test.ts`.
 */
const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
let autreAdminTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
  autreAdminTok = await signSession({ userId: 'u3', tenantId: 't2', role: 'admin' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const appel = (methode: 'GET' | 'PUT', tok: string, body?: unknown) => ({
  method: methode, url: '/tenants/t1/hubspot/champs', ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${tok}` },
});

const PORTAIL: ChampsDuPortail = {
  proprietes: {
    contact: [
      { nom: 'firstname', libelle: 'Prénom', type: 'string' },
      { nom: 'ville', libelle: 'Ville', type: 'string' },
      { nom: 'engagements_last_meeting_booked', libelle: 'Dernière réunion réservée', type: 'datetime' },
    ],
    deal: [{ nom: 'montant_devis', libelle: 'Montant du devis', type: 'number' }],
  },
  calcules: [
    { cle: 'conseiller', libelle: 'Conseiller (propriétaire de la transaction)', disponible: true },
    { cle: 'lien_agenda', libelle: 'Lien de réservation du conseiller', disponible: true },
  ],
  choisis: [],
};

function app(o: { lire?: () => Promise<ChampsDuPortail>; poserLeve?: unknown } = {}) {
  const journal: string[] = [];
  const declares: ChampLibelle[][] = [];
  const poses: ChampChoisi[][] = [];
  const deps: HubspotChampsRouteDeps = {
    lire: async (t) => { journal.push(`lire:${t}`); return o.lire ? o.lire() : PORTAIL; },
    declarer: async (t, champs) => { journal.push(`declarer:${t}`); declares.push([...champs]); },
    poser: async (t, champs) => {
      journal.push(`poser:${t}`);
      if (o.poserLeve) throw o.poserLeve;
      poses.push([...champs]);
      return champs.map((c) => ({ ...c, libelle: `lu:${c.propriete}` }));
    },
  };
  const server = buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, hubspotChamps: deps });
  return { server, journal, declares, poses };
}

const LISTE = [
  { objet: 'contact', propriete: 'firstname' },
  { objet: 'deal', propriete: 'montant_devis' },
  { objet: 'calcule', propriete: 'conseiller' },
];

describe('GET /tenants/:t/hubspot/champs', () => {
  it('🔴 agent, ou admin d’un AUTRE espace : 403, le connecteur n’est pas appelé', async () => {
    const { server, journal } = app();
    expect((await server.inject(appel('GET', agentTok))).statusCode).toBe(403);
    expect((await server.inject({ ...appel('GET', autreAdminTok) })).statusCode).toBe(403);
    expect(journal).toEqual([]);
    await server.close();
  });

  it('rend ce que le connecteur lit : propriétés, calculés, liste choisie', async () => {
    const { server } = app();
    const res = await server.inject(appel('GET', adminTok));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(PORTAIL);
    await server.close();
  });

  it('🔴 les pannes du connecteur dans les mots de l’écran, jamais « aucun champ »', async () => {
    const cas: Array<[unknown, number, string]> = [
      [new ConnecteurEnReveil(), 503, 'connecteur_en_reveil'],
      [new ConnecteurPasAJour(), 503, 'mise_a_jour_en_cours'],
      [new HubspotServiceError(404, 'tenant_not_connected', false), 409, 'hubspot_non_relie'],
      [new HubspotServiceError(409, 'portal_disconnected', false), 409, 'hubspot_non_relie'],
      [new HubspotServiceError(502, 'reponse_invalide', false), 502, 'hubspot_indisponible'],
      [new ReconsentRequiredError('https://mm-hubspot.messagingme.app/oauth/install?x=1'), 409, 'reconsent_required'],
    ];
    for (const [err, statut, code] of cas) {
      const { server } = app({ lire: async () => { throw err; } });
      const res = await server.inject(appel('GET', adminTok));
      expect(res.statusCode, code).toBe(statut);
      expect(res.json(), code).toMatchObject({ code });
      expect(res.json().proprietes, code).toBeUndefined();
      await server.close();
    }
  });
});

describe('PUT /tenants/:t/hubspot/champs', () => {
  it('🔴 DÉCLARE les champs (avec les libellés lus chez le connecteur) AVANT de poser la liste', async () => {
    const { server, journal, declares, poses } = app();
    const res = await server.inject(appel('PUT', adminTok, { champs: LISTE }));
    expect(res.statusCode).toBe(200);
    expect(journal).toEqual(['lire:t1', 'declarer:t1', 'poser:t1']);
    expect(declares).toEqual([[
      { objet: 'contact', propriete: 'firstname', libelle: 'Prénom', typeHubspot: 'string' },
      { objet: 'deal', propriete: 'montant_devis', libelle: 'Montant du devis', typeHubspot: 'number' },
      { objet: 'calcule', propriete: 'conseiller', libelle: 'Conseiller (propriétaire de la transaction)' },
    ]]);
    expect(poses).toEqual([LISTE]);
    expect(res.json()).toEqual({ choisis: LISTE.map((c) => ({ ...c, libelle: `lu:${c.propriete}` })) });
    await server.close();
  });

  it('🔴 le type HubSpot de la propriété vient du connecteur ; un type fourni par le corps est refusé (400)', async () => {
    const { server, declares } = app();
    const choix = [{ objet: 'contact', propriete: 'engagements_last_meeting_booked' }];
    expect((await server.inject(appel('PUT', adminTok, { champs: choix }))).statusCode).toBe(200);
    expect(declares).toEqual([[{ ...choix[0], libelle: 'Dernière réunion réservée', typeHubspot: 'datetime' }]]);
    const res = await server.inject(appel('PUT', adminTok, { champs: [{ ...choix[0], typeHubspot: 'string' }] }));
    expect(res.statusCode).toBe(400);
    expect(declares).toHaveLength(1);
    await server.close();
  });

  it('🔴 un libellé fourni par le corps est refusé (400), jamais déclaré', async () => {
    const { server, journal } = app();
    const res = await server.inject(appel('PUT', adminTok, { champs: [{ objet: 'contact', propriete: 'firstname', libelle: 'Mot de passe' }] }));
    expect(res.statusCode).toBe(400);
    expect(journal).toEqual([]);
    await server.close();
  });

  it('🔴 21 champs, un doublon, un nom trop long, un objet inconnu : 400, rien n’est lu, déclaré ni posé', async () => {
    const { server, journal } = app();
    const vingtEtUn = Array.from({ length: 21 }, (_, i) => ({ objet: 'contact', propriete: `p${i}` }));
    for (const champs of [
      vingtEtUn,
      [LISTE[0], LISTE[0]],
      [{ objet: 'deal', propriete: 'a'.repeat(54) }],
      [{ objet: 'company', propriete: 'name' }],
      [{ objet: 'calcule', propriete: 'email' }],
    ]) expect((await server.inject(appel('PUT', adminTok, { champs }))).statusCode, JSON.stringify(champs).slice(0, 80)).toBe(400);
    expect((await server.inject(appel('PUT', adminTok, { champs: LISTE, autre: true }))).statusCode).toBe(400);
    expect(journal).toEqual([]);
    await server.close();
  });

  it('une liste vide s’enregistre (tout décoché) : rien n’est déclaré, et rien n’est supprimé', async () => {
    const { server, journal, declares } = app();
    expect((await server.inject(appel('PUT', adminTok, { champs: [] }))).json()).toEqual({ choisis: [] });
    expect(journal).toEqual(['lire:t1', 'declarer:t1', 'poser:t1']);
    expect(declares).toEqual([[]]);
    await server.close();
  });

  it('🔴 une propriété absente du portail (ou filtrée) : 400 qui la nomme, rien n’est déclaré ni posé', async () => {
    const { server, journal } = app();
    const res = await server.inject(appel('PUT', adminTok, { champs: [...LISTE, { objet: 'deal', propriete: 'supprimee' }] }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'propriete_inconnue', champs: [{ objet: 'deal', propriete: 'supprimee' }] });
    expect(journal).toEqual(['lire:t1']);
    await server.close();
  });

  it('le connecteur refuse à la pose (propriété supprimée entre-temps) : 400 qui la nomme', async () => {
    const { server } = app({ poserLeve: new ProprietesInconnues([{ objet: 'contact', propriete: 'firstname' }]) });
    const res = await server.inject(appel('PUT', adminTok, { champs: LISTE }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'propriete_inconnue', champs: [{ objet: 'contact', propriete: 'firstname' }] });
    await server.close();
  });

  it('🔴 un connecteur pas encore à jour, à la lecture ou à la pose : 503 « mise à jour en cours »', async () => {
    const { server: s1, journal } = app({ lire: async () => { throw new ConnecteurPasAJour(); } });
    const r1 = await s1.inject(appel('PUT', adminTok, { champs: LISTE }));
    expect([r1.statusCode, r1.json().code]).toEqual([503, 'mise_a_jour_en_cours']);
    expect(journal).toEqual(['lire:t1']);
    await s1.close();
    const { server: s2 } = app({ poserLeve: new ConnecteurPasAJour() });
    const r2 = await s2.inject(appel('PUT', adminTok, { champs: LISTE }));
    expect([r2.statusCode, r2.json().code]).toEqual([503, 'mise_a_jour_en_cours']);
    await s2.close();
  });

  it('agent : 403, rien n’est déclaré', async () => {
    const { server, journal } = app();
    expect((await server.inject(appel('PUT', agentTok, { champs: LISTE }))).statusCode).toBe(403);
    expect(journal).toEqual([]);
    await server.close();
  });
});
