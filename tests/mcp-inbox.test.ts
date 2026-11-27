import { describe, it, expect } from 'vitest';
import { OUTILS, RefusOutil, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { CreditEpuise, PlafondIaAtteint, RienATranscrire } from '../src/inbox/transcrire';
import { MediaTropGros } from '../src/meta/media';
import { MediaExpire } from '../src/inbox/media-entrant';

/**
 * L'INBOX DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 2a) : les marques d'une conversation sont les MÊMES
 * écritures que ses boutons, la transcription est celle du bouton (`transcrireMessage`), les réglages passent par les
 * MÊMES écritures que l'écran (`reglerReprise`). Les faux sont des classes dont les méthodes lisent `this` et notent
 * l'espace visé.
 */
const T = 't1';
const CONV = '00000000-0000-4000-8000-0000000000c1';
const MSG = '00000000-0000-4000-8000-0000000000d1';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

class FauxMarques {
  readonly ecrits: Array<{ quoi: string; tenant: string; id: string; valeur: boolean; par: unknown }> = [];
  private noter(quoi: string, tenant: string, id: string, valeur: boolean, par: unknown): boolean {
    this.ecrits.push({ quoi, tenant, id, valeur, par });
    return tenant === T && id === CONV;
  }
  async archiverConversation(t: string, id: string, v: boolean, par: unknown) { return this.noter('archive', t, id, v, par); }
  async signalerConversation(t: string, id: string, v: boolean, par: unknown) { return this.noter('signale', t, id, v, par); }
  async marquerUrgente(t: string, id: string, v: boolean, par: unknown) { return this.noter('urgente', t, id, v, par); }
  async marquerTraitee(t: string, id: string, v: boolean, par: unknown) { return this.noter('traitee', t, id, v, par); }
}

class FauxReglages {
  agentsPeuventPrendre = false;
  controlHandbackSeconds: number | null = null;
  readonly ecrits: string[] = [];
  async get(tenant: string) {
    return { agentsPeuventPrendre: tenant === T && this.agentsPeuventPrendre, controlHandbackSeconds: this.controlHandbackSeconds };
  }
  async setAgentsPeuventPrendre(tenant: string, v: boolean) { this.ecrits.push(`${tenant}:prendre:${v}`); this.agentsPeuventPrendre = v; }
  async setControlHandbackSeconds(tenant: string, s: number | null) { this.ecrits.push(`${tenant}:reprise:${s}`); this.controlHandbackSeconds = s; }
}

function monter(o: { transcrire?: (id: string, cible: string | null) => Promise<unknown>; sansTranscription?: boolean } = {}) {
  const marques = new FauxMarques();
  const reglages = new FauxReglages();
  const lues: string[] = [];
  const transcrits: Array<{ id: string; cible: string | null }> = [];
  const consommes: string[] = [];
  const deps = {
    couteux: { consommer: async (t: string) => { consommes.push(t); return { accepte: true }; } },
    marquesConversation: marques,
    reglagesInbox: reglages,
    ouvrirConversation: async (tenant: string, id: string) => {
      // Comme Postgres : un identifiant qui n'est pas un uuid fait lever la requête (22P02).
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('22P02 : invalid input syntax for type uuid');
      if (tenant !== T || id !== CONV) return null;
      return {
        marquerLue: async () => { lues.push(`${tenant}:${id}`); },
        ...(o.sansTranscription ? {} : {
          transcrire: async (messageId: string, cible: string | null) => {
            transcrits.push({ id: messageId, cible });
            return o.transcrire ? o.transcrire(messageId, cible) : { texte: 'Bonjour, je rappelle demain.', deja: false };
          },
        }),
      };
    },
  } as unknown as DepsMcp;
  return { deps, marques, reglages, lues, transcrits, consommes };
}

describe('l’Inbox depuis Claude (CSM, B10, livraison 2a)', () => {
  it('🔴 les réglages et la transcription (le crédit IA) sont signés d’une personne ; les marques restent ouvertes à une clé', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['update_inbox_settings', 'transcribe_message']) expect(cle, nom).not.toContain(nom);
    for (const nom of ['update_conversation', 'get_inbox_settings']) expect(cle, nom).toContain(nom);
  });

  it('🔴 update_conversation : chaque marque donnée, dans l’espace, signée de la personne ; ce qui est omis n’est pas touché', async () => {
    const { deps, marques, lues } = monter();
    const r = await outil('update_conversation').executer(deps, T, { conversation_id: CONV, archived: true, urgent: false, read: true }, MOI);
    expect(r).toEqual({ conversation_id: CONV, archived: true, urgent: false, read: true });
    expect(marques.ecrits).toEqual([
      { quoi: 'archive', tenant: T, id: CONV, valeur: true, par: { collaborateur: 'u1' } },
      { quoi: 'urgente', tenant: T, id: CONV, valeur: false, par: { collaborateur: 'u1' } },
    ]);
    expect(lues).toEqual([`${T}:${CONV}`]);
    // Une clé d'API : l'auteur est la cause, jamais une personne inventée.
    await outil('update_conversation').executer(deps, T, { conversation_id: CONV, flagged: true, done: true }, null);
    expect(marques.ecrits.slice(2).map((e) => [e.quoi, e.valeur])).toEqual([['signale', true], ['traitee', true]]);
    expect(marques.ecrits[2]!.par).toEqual({ cause: 'automatique : agent tiers (MCP)' });
  });

  it('🔴 update_conversation : l’urgence ne se pose pas avec Traité ou Archivé, qui la lèvent', async () => {
    const { deps, marques } = monter();
    for (const args of [{ conversation_id: CONV, urgent: true, done: true }, { conversation_id: CONV, urgent: true, archived: true }]) {
      await expect(outil('update_conversation').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(marques.ecrits).toEqual([]);
    // La lever en rangeant reste permis.
    await outil('update_conversation').executer(deps, T, { conversation_id: CONV, urgent: false, done: true }, MOI);
    expect(marques.ecrits.map((e) => e.quoi)).toEqual(['urgente', 'traitee']);
  });

  it('update_conversation : rien à changer, read: false, une valeur bancale sont refusés ; une conversation inconnue est introuvable', async () => {
    const { deps, marques } = monter();
    for (const args of [{ conversation_id: CONV }, { conversation_id: CONV, read: false }, { conversation_id: CONV, archived: 'oui' }]) {
      await expect(outil('update_conversation').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    await expect(outil('update_conversation').executer(deps, T, { conversation_id: 'cv-1', archived: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    expect(marques.ecrits).toEqual([]);
    const autre = '00000000-0000-4000-8000-0000000000ff';
    await expect(outil('update_conversation').executer(deps, T, { conversation_id: autre, archived: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('update_conversation').executer(deps, T, { conversation_id: autre, read: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('transcribe_message : la transcription du bouton, traduite si demandé, le plafond consommé', async () => {
    const { deps, transcrits, consommes } = monter();
    expect(await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: MSG, translate_to: 'en' }, MOI))
      .toEqual({ texte: 'Bonjour, je rappelle demain.', deja: false });
    await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: MSG }, MOI);
    // Une autre langue est refusée avant le plafond : elle ferait payer sans rien traduire.
    await expect(outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: MSG, translate_to: 'de' }, MOI))
      .rejects.toMatchObject({ code: 'invalid_args' });
    expect(transcrits).toEqual([{ id: MSG, cible: 'en' }, { id: MSG, cible: null }]);
    expect(consommes).toEqual([T, T]);
  });

  it('🔴 transcribe_message : chaque refus dit sa cause dans le vocabulaire fermé', async () => {
    const cas: Array<[unknown, string]> = [
      [new RienATranscrire(), 'unsupported'], [new CreditEpuise(), 'credit_required'], [new PlafondIaAtteint(), 'quota_exceeded'],
      [new MediaTropGros(5_000_000, 1_000_000), 'too_large'], [new MediaExpire(), 'not_found'], [new Error('panne du fournisseur'), 'unavailable'],
    ];
    for (const [erreur, code] of cas) {
      const { deps } = monter({ transcrire: async () => { throw erreur; } });
      const e = await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: MSG }, MOI).catch((x: unknown) => x);
      expect(e, code).toBeInstanceOf(RefusOutil);
      expect(e, code).toMatchObject({ code });
    }
    const sans = monter({ sansTranscription: true });
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: CONV, message_id: MSG }, MOI)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: CONV, message_id: 'm-1' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    // Un identifiant de conversation mal formé : un refus, jamais une erreur de la base.
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: 'cv-1', message_id: MSG }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('get_inbox_settings et update_inbox_settings : les réglages de l’écran, seul ce qui est donné change, la reprise bornée', async () => {
    const { deps, reglages } = monter();
    expect(await outil('get_inbox_settings').executer(deps, T, {}, MOI)).toEqual({ agents_can_take: false, handback_seconds: null });
    expect(await outil('update_inbox_settings').executer(deps, T, { handback_seconds: 3600 }, MOI)).toEqual({ agents_can_take: false, handback_seconds: 3600 });
    expect(reglages.ecrits).toEqual([`${T}:reprise:3600`]);
    expect(await outil('update_inbox_settings').executer(deps, T, { agents_can_take: true, handback_seconds: null }, MOI))
      .toEqual({ agents_can_take: true, handback_seconds: null });
    for (const args of [{}, { handback_seconds: 604_801 }, { handback_seconds: 1.5 }, { agents_can_take: 'oui' }]) {
      await expect(outil('update_inbox_settings').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(reglages.ecrits).toEqual([`${T}:reprise:3600`, `${T}:reprise:null`, `${T}:prendre:true`]);
  });
});
