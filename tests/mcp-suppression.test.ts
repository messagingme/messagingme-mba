import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, RefusOutil, type DepsMcp } from '../src/mcp/outils';
import type { BulkTarget, ContactFilters, FicheASupprimer } from '../src/crm/contact-store.pg';
import { FICHES_DE_L_APERCU, MAX_FICHES_PAR_SUPPRESSION } from '../web/lib/partage/catalogue-mcp';
import { MAX_IDENTIFIANTS_CIBLE } from '../src/mcp/cible';
import { MESSAGE_OPERATIONS_LOURDES } from '../src/auth/plafond-partage';
import { creerTravauxEnVol } from '../src/lib/en-vol';
import { QuotaSuppressions } from '../src/offres/compteurs';
import { CompteurDebitMemoire } from '../src/db/debit.memoire';
import { DROITS } from '../src/offres/offres';
import { accepter, proposer } from '../src/mise-en-ligne/mise-en-ligne';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import { ADMIN, BROUILLON, CSM, V1, WF, ligne, monter as monterOui } from './mise-en-ligne-fixtures';

/**
 * LA SUPPRESSION DE CONTACTS EN MASSE DEPUIS CLAUDE (plan `docs/superpowers/plans/2026-10-26-free-au-dela-de-100-contacts.md`).
 * Ce que les outils ajoutent à l'effacement partagé (`effacerContacts`, dont la limite du jour a ses tests dans
 * `tests/offres-compteurs.test.ts`) : lire la sélection et la refuser plutôt que l'élargir, montrer avant d'effacer, et
 * n'effacer que les fiches montrées, sur le clic d'un admin (B8 : le oui, plus de code). Ce que la REQUÊTE de la sélection fait vraiment (l'espace, les fiches supprimées,
 * l'ordre) : `tests/contact-selection-suppression.test.ts` pour sa forme, et
 * `tests/integration/contacts-suppression.integration.test.ts`, en CI, sur une vraie base.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const AUTRE = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const MOI = { userId: '99999999-9999-4999-8999-999999999999', autorisationId: 'aut-1' };
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const preparer = outil('prepare_contacts_deletion');
const supprimer = outil('delete_contacts');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Une fiche du faux magasin. */
interface Fiche {
  id: string; tenant: string; nom: string | null; tel: string | null; creeLe: string; tags: string[]; optIn: string; supprimee: boolean;
}

function fiche(n: number, o: Partial<Fiche> = {}): Fiche {
  return {
    id: id(n), tenant: T, nom: `Client ${n}`, tel: `+336123456${String(n).padStart(2, '0')}`,
    creeLe: `2026-01-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.000Z`, tags: [], optIn: 'unknown', supprimee: false,
    ...o,
  };
}

/** Les filtres de la cible, comme le sélecteur de l'action en masse les applique. */
function correspond(f: Fiche, filtres: ContactFilters): boolean {
  const tags = filtres.tags ?? [];
  if (tags.length > 0 && !(filtres.tagMode === 'or' ? tags.some((t) => f.tags.includes(t)) : tags.every((t) => f.tags.includes(t)))) return false;
  return filtres.optIn === undefined || f.optIn === filtres.optIn;
}

/** Un faux magasin : les règles de `selectionAEffacer` (espace, fiches vivantes, cible, ordre total, limite). */
function monter(fiches: Fiche[], o: { quota?: { ok: true } | { ok: false; max: number }; couteuxAccepte?: boolean } = {}) {
  const traces = {
    lectures: [] as Array<{ tenant: string; cible: BulkTarget; limite: number }>,
    purges: [] as Array<{ tenant: string; ids: string[] }>,
    quota: [] as Array<{ tenant: string; n: number }>,
    plafond: 0,
    audit: [] as Array<{ tenant: string; userId: string | null; action: string; cible: string; detail: unknown }>,
  };
  const versFiche = (f: Fiche): FicheASupprimer => ({ id: f.id, profileName: f.nom, phoneE164: f.tel, bsuid: null, createdAt: f.creeLe });
  const selection = async (tenant: string, cible: BulkTarget, limite: number) => {
    traces.lectures.push({ tenant, cible, limite });
    const vivantes = fiches.filter((f) => f.tenant === tenant && !f.supprimee);
    const visees = 'ids' in cible ? vivantes.filter((f) => cible.ids.includes(f.id)) : vivantes.filter((f) => correspond(f, cible.filters));
    return [...visees].sort((a, b) => a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id)).slice(0, limite).map(versFiche);
  };
  const effacement = {
    contacts: {
      purgeMany: async (tenant: string, ids: readonly string[]) => {
        traces.purges.push({ tenant, ids: [...ids] });
        let purges = 0;
        for (const f of fiches) if (f.tenant === tenant && ids.includes(f.id) && !f.supprimee) { f.supprimee = true; purges += 1; }
        return { purges, conversations: purges, messages: 2 * purges, analyses: 0, listeAgent: [] };
      },
    },
    suppressionsDuJour: { consommer: async (tenant: string, n: number) => { traces.quota.push({ tenant, n }); return o.quota ?? { ok: true as const }; } } as unknown,
    listeDeLAgent: { oublierChezMeta: async () => {} },
    enVol: creerTravauxEnVol(),
  };
  // Le oui (B8) : le clic d'un admin efface par l'effacement partagé, sur les fiches que l'aperçu a gardées.
  const m = monterOui({ envois: { campagnes: {}, suppression: { selection, effacement } } as unknown as DepsEnvoisAuOui });
  // La personne du jeton OAuth est un admin de l'espace (la garde du MCP le relit) : son accès reste valide au clic.
  m.store.admins.add(MOI.userId);
  m.deps.audit = async (tenant, actor, action, cible, detail) => {
    traces.audit.push({ tenant, userId: actor.userId, action, cible: cible.id, detail });
  };
  const d = {
    couteux: { consommer: async () => { traces.plafond += 1; return { accepte: o.couteuxAccepte ?? true, attenteMs: 2000 }; } },
    inbox: { contactIdsDesConversations: async () => { throw new Error('les conversations ne sont pas un critère de suppression'); } },
    contacts: {
      // Comme le vrai : DANS l'espace, fiches supprimées comprises (c'est la sélection qui les écarte).
      contactIdsForTarget: async (tenant: string, cible: BulkTarget) => ('ids' in cible ? fiches.filter((f) => f.tenant === tenant && cible.ids.includes(f.id)).map((f) => f.id) : []),
    },
    suppression: { selection },
    misesEnLigne: m.deps,
  } as unknown as DepsMcp;
  return { d, traces, m, effacement };
}

/** Le clic d'un admin sur le bouton de l'aperçu. */
const clic = (m: ReturnType<typeof monter>['m'], goLiveId: string, tenant = T) => accepter(m.deps, tenant, goLiveId, ADMIN);

/** Un aperçu, et le bouton du oui qu'il rend. */
async function apercu(d: DepsMcp, args: Record<string, unknown>, tenant = T) {
  return await preparer.executer(d, tenant, args, MOI) as {
    count: number; sample: Array<{ name: string | null; phone: string; created_at: string }>;
    go_live: { go_live_id: string; bouton: string; lien: string; expire_le: string };
  };
}

describe('les deux outils : qui, quelle offre, quels indices', () => {
  it('🔴 ouverts à toutes les offres, au nom d’une personne, jamais d’une clé d’API ; destructeurs', () => {
    for (const o of [preparer, supprimer]) {
      expect(o.fonction, o.nom).toBeNull();
      expect(o.scope, o.nom).toBe('mcp:write');
      expect(o.exigePersonne, o.nom).toBe(true);
      expect(o.annotations, o.nom).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    // Chaque aperçu prépare un nouveau oui ; l'identifiant du oui rend toujours le même résultat (B8).
    expect(preparer.annotations).toMatchObject({ idempotentHint: false });
    expect(supprimer.annotations).toMatchObject({ idempotentHint: true });
    // La purge retire aussi les contacts de la liste de l'agent de Meta, chez Meta : monde ouvert. L'aperçu, non.
    expect(supprimer.annotations.openWorldHint).toBe(true);
    expect(preparer.annotations.openWorldHint).toBe(false);
    const parCle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    expect(parCle).not.toContain('prepare_contacts_deletion');
    expect(parCle).not.toContain('delete_contacts');
  });

  it('🔴 les bornes appliquées sont annoncées : schéma fermé, oldest, contact_ids ; l’effacement ne prend que l’identifiant du oui ; aucune inactivité', () => {
    const p = preparer.entree.properties;
    expect(preparer.entree.additionalProperties).toBe(false);
    expect(p.oldest).toMatchObject({ type: 'integer', minimum: 1, maximum: MAX_FICHES_PAR_SUPPRESSION });
    expect(p.contact_ids).toMatchObject({ maxItems: MAX_IDENTIFIANTS_CIBLE });
    // Ni l'analyse, ni les conversations, ni l'inactivité : la sélection ne les accepte pas, le schéma ne les annonce pas.
    expect(Object.keys(p).sort()).toEqual(['contact_ids', 'oldest', 'opt_in', 'tag_mode', 'tags']);
    for (const o of [preparer, supprimer]) expect(`${o.description}${JSON.stringify(o.entree.properties)}`, o.nom).not.toMatch(/inactive|inactivity/);
    expect(MAX_FICHES_PAR_SUPPRESSION).toBe(1000);
    // Plus de code de confirmation (B8) : la sélection est celle que le bouton a montrée.
    expect(supprimer.entree).toMatchObject({ additionalProperties: false, required: ['go_live_id'] });
    expect(Object.keys(supprimer.entree.properties)).toEqual(['go_live_id']);
  });
});

describe('la sélection', () => {
  it('par étiquettes : le compte, dix fiches au plus, les plus anciennes d’abord, numéro masqué, et le bouton du oui (24 heures)', async () => {
    const fiches = Array.from({ length: 15 }, (_, i) => fiche(i + 1, { tags: ['ancien'] }));
    const { d, traces, m } = monter(fiches);
    const r = await apercu(d, { tags: ['ancien'] });
    expect(r.count).toBe(15);
    expect(r.sample).toHaveLength(FICHES_DE_L_APERCU);
    const attendues = [...fiches].sort((a, b) => a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id)).slice(0, FICHES_DE_L_APERCU);
    expect(r.sample.map((s) => s.created_at)).toEqual(attendues.map((f) => f.creeLe));
    expect(r.sample[0]!.phone).toMatch(/^\+33 •• •• •• \d\d$/);
    expect(JSON.stringify(r.sample)).not.toMatch(/\+336123456\d\d/);
    expect(r.go_live).toMatchObject({ bouton: 'Supprimer 15 contacts' });
    expect(Date.parse(r.go_live.expire_le)).toBe(m.horloge.now + 24 * 3_600_000);
    // Rien n'est effacé, rien n'est compté dans la limite du jour ; le plafond des opérations lourdes, une fois.
    expect([traces.purges, traces.quota, traces.audit]).toEqual([[], [], []]);
    expect(traces.plafond).toBe(1);
    expect(traces.lectures[0]).toEqual({ tenant: T, cible: { filters: { tags: ['ancien'] }, excludeIds: [] }, limite: MAX_FICHES_PAR_SUPPRESSION + 1 });
  });

  it('chaque critère seul : tags (tous ou l’un), consentement, liste, les plus anciennes', async () => {
    const fiches = [
      fiche(1, { tags: ['a', 'b'], optIn: 'opted_out' }),
      fiche(2, { tags: ['a'], optIn: 'opted_in' }),
      fiche(3, { tags: ['b'], optIn: 'unknown' }),
      fiche(4, { tags: [], optIn: 'opted_in' }),
    ];
    const { d } = monter(fiches);
    const compte = async (args: Record<string, unknown>) => (await apercu(d, args)).count;
    expect(await compte({ tags: ['a', 'b'] })).toBe(1);
    expect(await compte({ tags: ['a', 'b'], tag_mode: 'any' })).toBe(3);
    expect(await compte({ opt_in: 'opted_in' })).toBe(2);
    expect(await compte({ contact_ids: [id(2), id(4)] })).toBe(2);
    expect(await compte({ oldest: 2 })).toBe(2);
  });

  it('les critères se combinent, et oldest garde les plus anciennes de la sélection, à date égale par identifiant', async () => {
    const meme = '2026-01-05T10:00:00.000Z';
    const fiches = [
      fiche(9, { tags: ['x'], creeLe: meme }), fiche(7, { tags: ['x'], creeLe: meme }), fiche(8, { tags: ['x'], creeLe: meme }),
      fiche(1, { tags: ['x'], creeLe: '2026-03-01T10:00:00.000Z' }), fiche(2, { tags: [], creeLe: '2026-01-01T10:00:00.000Z' }),
      fiche(3, { tags: ['x'], creeLe: '2026-01-02T10:00:00.000Z' }),
    ];
    const { d, traces, m } = monter(fiches);
    const r = await apercu(d, { tags: ['x'], oldest: 3 });
    // La fiche 2, plus ancienne, n'a pas l'étiquette ; la 3 l'a et passe d'abord ; puis, à date égale, 7 puis 8.
    expect(r.count).toBe(3);
    expect(traces.lectures.at(-1)).toMatchObject({ limite: 3 });
    expect((await apercu(d, { contact_ids: [id(1), id(3), id(9)], oldest: 2 })).count).toBe(2);
    // Le oui de « tags x, les trois plus anciennes » garde les fiches 3, 7 et 8, et elles seules.
    expect((await m.deps.store.lire(T, r.go_live.go_live_id))!.actions).toEqual([{ type: 'suppression', contacts: [id(3), id(7), id(8)], nom: '3 contacts' }]);
  });

  it('🔴 une fiche supprimée n’est jamais comptée ni rendue, même nommée par son identifiant', async () => {
    const { d } = monter([fiche(1), fiche(2, { supprimee: true })]);
    expect((await apercu(d, { contact_ids: [id(1), id(2)] })).count).toBe(1);
    await expect(apercu(d, { contact_ids: [id(2)] })).rejects.toThrow(/aucun contact de cet espace ne correspond/);
  });

  it('🔴 un autre espace n’est jamais touché : ses fiches ne se désignent pas, ni par critère ni par identifiant', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] }), fiche(2, { tenant: AUTRE, tags: ['a'] })]);
    expect((await apercu(d, { tags: ['a'] })).count).toBe(1);
    await expect(apercu(d, { contact_ids: [id(2)] })).rejects.toThrow(/aucun de ces contacts n’existe dans cet espace/);
    expect(traces.lectures.every((l) => l.tenant === T)).toBe(true);
  });

  it('🔴 une sélection sans aucun critère est refusée, sans rien lire ni entamer le plafond', async () => {
    const { d, traces } = monter([fiche(1)]);
    for (const args of [{}, { tag_mode: 'any' }, { oldest: null }]) {
      await expect(apercu(d, args), JSON.stringify(args)).rejects.toThrow(RefusOutil);
    }
    expect([traces.lectures, traces.plafond]).toEqual([[], 0]);
  });

  it('🔴 plus de 1 000 contacts : refusé, jamais tronqué ; oldest la ramène sous le plafond', async () => {
    const fiches = Array.from({ length: MAX_FICHES_PAR_SUPPRESSION + 1 }, (_, i) => fiche(i + 1));
    const { d } = monter(fiches);
    await expect(apercu(d, { opt_in: 'unknown' })).rejects.toThrow(/plus de 1000 contacts/);
    expect((await apercu(d, { oldest: MAX_FICHES_PAR_SUPPRESSION })).count).toBe(MAX_FICHES_PAR_SUPPRESSION);
    // Pile au plafond, sans oldest : accepté.
    fiches[0]!.supprimee = true;
    expect((await apercu(d, { opt_in: 'unknown' })).count).toBe(MAX_FICHES_PAR_SUPPRESSION);
  });

  /**
   * 🔴 L'INACTIVITÉ N'EST PAS UN CRITÈRE (relecture du lot, 2026-10-26) : les fils qui datent un dernier message partent avec
   * la conservation et la déconnexion du numéro, et un client qui a écrit il y a trois mois paraîtrait « jamais actif ».
   * Une clé `inactive_days` est donc refusée comme toute clé inconnue : ignorée, elle élargirait la sélection à tout ce
   * que ses autres critères désignent.
   */
  it('🔴 inactive_days est REFUSÉ comme une clé inconnue, seul ou avec d’autres critères, avant toute lecture', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] })]);
    for (const args of [{ inactive_days: 90 }, { tags: ['a'], inactive_days: 90 }, { oldest: 10, inactive_days: 90 }]) {
      await expect(apercu(d, args), JSON.stringify(args)).rejects.toThrow(/paramètre inconnu : inactive_days/);
      await expect(supprimer.executer(d, T, { ...args, go_live_id: id(1) }, MOI), JSON.stringify(args))
        .rejects.toThrow(/paramètre inconnu : .*inactive_days/);
    }
    expect([traces.lectures, traces.purges, traces.plafond]).toEqual([[], [], 0]);
  });

  it('🔴 ce qui élargirait ou ne se lit pas est REFUSÉ, jamais ignoré ni ramené : analyse, conversations, bornes', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] })]);
    const refus = [
      { tags: ['a'], analysis: [{ field: 'sentiment', op: 'in', value: 'negatif' }] },
      { conversation_ids: [id(1)] },
      { tags: ['a'], confirmation_code: 'x' },
      { tags: [] },
      { oldest: 0 }, { oldest: MAX_FICHES_PAR_SUPPRESSION + 1 }, { oldest: 2.5 }, { oldest: '30' },
      { contact_ids: [id(1)], tags: ['a'] },
    ];
    for (const args of refus) await expect(apercu(d, args), JSON.stringify(args)).rejects.toThrow(RefusOutil);
    expect(traces.lectures).toEqual([]);
  });

  it('🔴 l’aperçu compte dans les opérations lourdes, comme prepare_campaign : refusé par le plafond, rien n’est lu', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] })], { couteuxAccepte: false });
    await expect(apercu(d, { tags: ['a'] })).rejects.toThrow(MESSAGE_OPERATIONS_LOURDES);
    expect([traces.lectures, traces.plafond]).toEqual([[], 1]);
  });

  it('sans personne : refusé avant toute lecture', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] })]);
    await expect(preparer.executer(d, T, { tags: ['a'] }, null)).rejects.toThrow(/connexion OAuth requise/);
    await expect(supprimer.executer(d, T, { go_live_id: id(1) }, null)).rejects.toThrow(/connexion OAuth requise/);
    expect([traces.lectures, traces.purges, traces.plafond]).toEqual([[], [], 0]);
  });
});

describe('le oui (B8 : le clic d’un admin, plus de code)', () => {
  it('🔴 rien n’est effacé avant le clic ; le clic efface CES fiches-là, par l’effacement partagé, audité au nom de l’admin ; l’outil rend le bilan', async () => {
    const fiches = [fiche(1, { tags: ['vieux'] }), fiche(2, { tags: ['vieux'] }), fiche(3, { tags: ['neuf'] })];
    const { d, traces, m } = monter(fiches);
    const { go_live } = await apercu(d, { tags: ['vieux'] });
    await expect(supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    expect([traces.purges, traces.quota, traces.audit]).toEqual([[], [], []]);
    await clic(m, go_live.go_live_id);
    expect(traces.purges).toEqual([{ tenant: T, ids: [id(1), id(2)] }]);
    expect(traces.quota).toEqual([{ tenant: T, n: 2 }]);
    // La purge de la console, une ligne par fiche, signée de l'admin qui a cliqué (le oui laisse aussi les siennes).
    expect(traces.audit.filter((a) => a.action === 'contact.purged')).toEqual([id(1), id(2)].map((c) => ({
      tenant: T, userId: ADMIN.userId, action: 'contact.purged', cible: c, detail: { lot: 2, via: 'mise_en_ligne' },
    })));
    expect(await supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).toEqual({ deleted: 2, conversations: 2, messages: 4 });
    expect(fiches.map((f) => f.supprimee)).toEqual([true, true, false]);
  });

  it('🔴 rejoué : un second clic ou un second appel rend le même résultat, et rien de plus n’est effacé', async () => {
    const fiches = Array.from({ length: 6 }, (_, i) => fiche(i + 1));
    const { d, traces, m } = monter(fiches);
    const { go_live } = await apercu(d, { oldest: 3 });
    await clic(m, go_live.go_live_id);
    await clic(m, go_live.go_live_id);
    for (let i = 0; i < 2; i += 1) expect(await supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).toMatchObject({ deleted: 3 });
    expect(traces.purges).toHaveLength(1);
    expect(fiches.filter((f) => f.supprimee)).toHaveLength(3);
  });

  it('🔴 la sélection a bougé depuis l’aperçu (une fiche de plus porte l’étiquette) : le clic n’efface QUE les fiches montrées', async () => {
    const fiches = [fiche(1, { tags: ['vieux'] }), fiche(2)];
    const { d, traces, m } = monter(fiches);
    const { go_live } = await apercu(d, { tags: ['vieux'] });
    fiches[1]!.tags = ['vieux'];
    await clic(m, go_live.go_live_id);
    expect(traces.purges).toEqual([{ tenant: T, ids: [id(1)] }]);
    expect(fiches.map((f) => f.supprimee)).toEqual([true, false]);
  });

  it('🔴 une fiche montrée a été effacée ailleurs depuis l’aperçu : le clic est refusé, rien n’est effacé', async () => {
    const fiches = [fiche(1, { tags: ['a'] }), fiche(2, { tags: ['a'] })];
    const { d, traces, m } = monter(fiches);
    const { go_live } = await apercu(d, { tags: ['a'] });
    fiches[0]!.supprimee = true;
    expect(await clic(m, go_live.go_live_id)).toMatchObject({ ok: false, statut: 409 });
    expect([traces.purges, traces.quota, traces.audit]).toEqual([[], [], []]);
  });

  it('🔴 le oui d’un autre espace est introuvable, au clic comme par l’outil : rien n’est effacé', async () => {
    const { d, traces, m } = monter([fiche(1, { tags: ['a'] }), fiche(2, { tenant: AUTRE, tags: ['a'] })]);
    const { go_live } = await apercu(d, { tags: ['a'] }, AUTRE);
    expect(await clic(m, go_live.go_live_id)).toMatchObject({ ok: false, statut: 404 });
    await expect(supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    expect(traces.purges).toEqual([]);
  });

  it('🔴 un oui expiré (24 heures) est refusé, et le dit ; rien n’est effacé', async () => {
    const { d, traces, m } = monter([fiche(1, { tags: ['a'] })]);
    const { go_live } = await apercu(d, { tags: ['a'] });
    m.horloge.now += 25 * 3_600_000;
    expect(await clic(m, go_live.go_live_id)).toMatchObject({ ok: false, details: { code: 'expiree' } });
    await expect(supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).rejects.toThrow(/expiré/);
    expect(traces.purges).toEqual([]);
  });

  it('🔴 le oui d’autre chose, accepté et COUPÉ : refusé AVANT toute reprise, rien n’est exécuté', async () => {
    const { d, traces, m } = monter([fiche(1, { tags: ['a'] })]);
    m.rows.set(WF, ligne(WF, 'Qualification', V1, BROUILLON, { tenantId: T }));
    const p = await proposer(m.deps, T, CSM, [{ type: 'publier', scenario: WF }]);
    if (!p.ok) throw new Error(p.erreur);
    // Acceptée, puis coupée avant toute action : la reprise l'exécuterait.
    const accepteeSeule = m.store.reclamer.bind(m.store);
    let coupe = true;
    m.store.reclamer = (async (...a: Parameters<typeof accepteeSeule>) => (coupe ? ((coupe = false), null) : accepteeSeule(...a))) as typeof m.store.reclamer;
    await clic(m, p.valeur.id);
    await expect(supprimer.executer(d, T, { go_live_id: p.valeur.id }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    expect((await m.deps.store.lire(T, p.valeur.id))!.etat).toBe('acceptee');
    expect(traces.purges).toEqual([]);
  });

  it('🔴 le oui d’autre chose (une publication cliquée) : refusé, rien n’est effacé', async () => {
    const { d, traces, m } = monter([fiche(1, { tags: ['a'] })]);
    m.rows.set(WF, ligne(WF, 'Qualification', V1, BROUILLON, { tenantId: T }));
    const p = await proposer(m.deps, T, CSM, [{ type: 'publier', scenario: WF }]);
    if (!p.ok) throw new Error(p.erreur);
    await clic(m, p.valeur.id);
    await expect(supprimer.executer(d, T, { go_live_id: p.valeur.id }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    expect(traces.purges).toEqual([]);
  });

  it('🔴 un identifiant mal formé, ou une clé de sélection, est refusé avant toute lecture, sans entamer le plafond', async () => {
    const { d, traces } = monter([fiche(1, { tags: ['a'] })]);
    await expect(supprimer.executer(d, T, { go_live_id: 'pas-un-uuid' }, MOI)).rejects.toThrow(RefusOutil);
    await expect(supprimer.executer(d, T, { tags: ['a'], go_live_id: id(1) }, MOI)).rejects.toThrow(/paramètre inconnu : tags/);
    await expect(supprimer.executer(d, T, {}, MOI)).rejects.toThrow(/go_live_id/);
    expect([traces.lectures, traces.purges, traces.plafond]).toEqual([[], [], 0]);
  });

  it('🔴 la limite du jour refuse (une Free sous sa limite de contacts) : refus de l’offre, rien n’est effacé ni audité', async () => {
    const { d, traces, m } = monter([fiche(1, { tags: ['a'] }), fiche(2, { tags: ['a'] })], { quota: { ok: false, max: 10 } });
    const { go_live } = await apercu(d, { tags: ['a'] });
    await clic(m, go_live.go_live_id);
    await expect(supprimer.executer(d, T, { go_live_id: go_live.go_live_id }, MOI)).rejects.toThrow(/10/);
    expect([traces.purges, traces.audit.filter((a) => a.action === 'contact.purged')]).toEqual([[], []]);
  });

  it('🔴 par le clic et la VRAIE limite du jour : une Free au-delà de sa limite supprime 50 contacts d’un coup ; sous elle, 11 sont refusés', async () => {
    const fiches = [
      ...Array.from({ length: 50 }, (_, i) => fiche(i + 1, { tags: ['vieux'] })),
      ...Array.from({ length: 11 }, (_, i) => fiche(i + 100, { tags: ['autre'] })),
    ];
    const etat = { comptees: 3000, limite: 100 as number | null };
    const { d, traces, m, effacement } = monter(fiches);
    // La limite du jour de la console et de l'API, sur un compteur en mémoire, et les fiches comptées que l'on fait varier.
    effacement.suppressionsDuJour = new QuotaSuppressions({
      offres: { offreDe: async () => ({ offre: 'base', droits: DROITS.base, retourEnBaseLe: null }) },
      compteur: new CompteurDebitMemoire(), contacts: { placesContacts: async () => ({ ...etat }) },
    });
    const vieux = await apercu(d, { tags: ['vieux'] });
    await clic(m, vieux.go_live.go_live_id);
    expect(await supprimer.executer(d, T, { go_live_id: vieux.go_live.go_live_id }, MOI)).toMatchObject({ deleted: 50 });
    // Revenue sous sa limite : le plafond de dix par jour reprend, et une purge qui le dépasserait est refusée en entier.
    etat.comptees = 42;
    const autres = await apercu(d, { tags: ['autre'] });
    await clic(m, autres.go_live.go_live_id);
    await expect(supprimer.executer(d, T, { go_live_id: autres.go_live.go_live_id }, MOI)).rejects.toThrow(/10/);
    expect(traces.purges).toHaveLength(1);
    expect(fiches.filter((f) => f.supprimee)).toHaveLength(50);
  });

  it('toutes les fiches montrées ont disparu : le clic est refusé, et le refus dit pourquoi', async () => {
    const fiches = [fiche(1, { tags: ['a'] })];
    const { d, m } = monter(fiches);
    const { go_live } = await apercu(d, { tags: ['a'] });
    fiches[0]!.supprimee = true;
    const r = await clic(m, go_live.go_live_id);
    expect(r.ok ? '' : r.erreur).toMatch(/n’existe plus/);
  });
});
