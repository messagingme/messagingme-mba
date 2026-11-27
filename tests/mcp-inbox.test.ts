import { describe, it, expect } from 'vitest';
import { OUTILS, RefusOutil, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { BlocsMcp } from '../src/mcp/saisie';
import { TAILLE_MAX_IMAGE_MCP } from '../src/mcp/outils-inbox';
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
/** Ce que get_messages rend d'un message : son identifiant PUBLIC (celui de Meta), traduit par le dépôt de l'API. */
const WAMID = 'wamid.HBgLMzM2MzM5MjE1NzcVAgASGCBBQzczNDYyQjUzOEVBQURFODYzNEU2NkI1RTYxN0Q1RAA=';
/** Un message de l'espace, mais d'une autre conversation. */
const WAMID_AILLEURS = 'wamid.ailleurs';
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
    // Le dépôt de get_message_status : l'identifiant public vers l'interne, dans l'espace.
    messagesApi: {
      message: async (tenant: string, idPublic: string) => {
        if (tenant !== T) return null;
        if (idPublic === WAMID) return { id: WAMID, idInterne: MSG, conversationId: CONV };
        if (idPublic === `msg_${MSG}`) return { id: idPublic, idInterne: MSG, conversationId: CONV };
        if (idPublic === WAMID_AILLEURS) return { id: WAMID_AILLEURS, idInterne: '00000000-0000-4000-8000-0000000000d2', conversationId: '00000000-0000-4000-8000-0000000000c2' };
        return null;
      },
    },
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
    expect(await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: WAMID, translate_to: 'en' }, MOI))
      .toEqual({ texte: 'Bonjour, je rappelle demain.', deja: false });
    // Un message sans identifiant de Meta : get_messages le rend sous la forme msg_<uuid>.
    await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: `msg_${MSG}` }, MOI);
    // Une autre langue est refusée avant le plafond : elle ferait payer sans rien traduire.
    await expect(outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: WAMID, translate_to: 'de' }, MOI))
      .rejects.toMatchObject({ code: 'invalid_args' });
    // La transcription reçoit l'identifiant INTERNE, traduit par le dépôt.
    expect(transcrits).toEqual([{ id: MSG, cible: 'en' }, { id: MSG, cible: null }]);
    expect(consommes).toEqual([T, T]);
  });

  it('🔴 transcribe_message : le message d’une autre conversation, ou d’un autre espace, est introuvable, avant le plafond', async () => {
    const { deps, transcrits, consommes } = monter();
    for (const [tenant, message] of [[T, WAMID_AILLEURS], ['autre', WAMID], [T, 'wamid.inconnu']] as const) {
      await expect(outil('transcribe_message').executer(deps, tenant, { conversation_id: CONV, message_id: message }, MOI), `${tenant} ${message}`)
        .rejects.toMatchObject({ code: 'not_found' });
    }
    expect(transcrits).toEqual([]);
    expect(consommes).toEqual([]);
  });

  it('🔴 transcribe_message : chaque refus dit sa cause dans le vocabulaire fermé', async () => {
    const cas: Array<[unknown, string]> = [
      [new RienATranscrire(), 'unsupported'], [new CreditEpuise(), 'credit_required'], [new PlafondIaAtteint(), 'quota_exceeded'],
      [new MediaTropGros(5_000_000, 1_000_000), 'too_large'], [new MediaExpire(), 'not_found'], [new Error('panne du fournisseur'), 'unavailable'],
    ];
    for (const [erreur, code] of cas) {
      const { deps } = monter({ transcrire: async () => { throw erreur; } });
      const e = await outil('transcribe_message').executer(deps, T, { conversation_id: CONV, message_id: WAMID }, MOI).catch((x: unknown) => x);
      expect(e, code).toBeInstanceOf(RefusOutil);
      expect(e, code).toMatchObject({ code });
    }
    const sans = monter({ sansTranscription: true });
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: CONV, message_id: WAMID }, MOI)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: CONV, message_id: 'm-1' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    // Un identifiant de conversation mal formé : un refus, jamais une erreur de la base.
    await expect(outil('transcribe_message').executer(sans.deps, T, { conversation_id: 'cv-1', message_id: WAMID }, MOI)).rejects.toMatchObject({ code: 'not_found' });
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

/**
 * LE FICHIER D'UN MESSAGE (B10, livraison 2c) : la MÊME lecture que l'Inbox et l'API (`lireMediaRecu`), par l'identifiant
 * interne que le dépôt de get_message_status traduit ; une image revient en bloc image, tout le reste est refusé AVANT
 * de télécharger, avec ce qu'il faut faire à la place.
 */
describe('le fichier d’un message depuis Claude (CSM, B10, livraison 2c)', () => {
  const PHOTO = 'wamid.photo';
  const PHOTO_PARAMS = 'wamid.photo-params';
  /** De vrais débuts de fichier : la reconnaissance lit les OCTETS. */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const VOCAL = 'wamid.vocal';
  const PDF = 'wamid.pdf';
  const TEXTE = 'wamid.texte';
  const PERIME = 'wamid.perime';
  const ICI = '00000000-0000-4000-8000-0000000000e1';
  const media = (mimeType: string | null, expired = false) => ({ mimeType, filename: null, expired });
  const lus: Record<string, { idInterne: string; conversationId: string; media: ReturnType<typeof media> | null }> = {
    [PHOTO]: { idInterne: ICI, conversationId: CONV, media: media('image/jpeg') },
    [PHOTO_PARAMS]: { idInterne: ICI, conversationId: CONV, media: media('image/jpeg; charset=binary') },
    [VOCAL]: { idInterne: ICI, conversationId: CONV, media: media('audio/ogg; codecs=opus') },
    [PDF]: { idInterne: ICI, conversationId: CONV, media: media('application/pdf') },
    [TEXTE]: { idInterne: ICI, conversationId: CONV, media: null },
    [PERIME]: { idInterne: ICI, conversationId: CONV, media: media('image/jpeg', true) },
    [WAMID_AILLEURS]: { idInterne: ICI, conversationId: '00000000-0000-4000-8000-0000000000c2', media: media('image/jpeg') },
  };
  function monterMedia(lire: () => Promise<{ bytes: Buffer; mime: string | null } | null> = async () => ({ bytes: JPEG, mime: 'image/jpeg' })) {
    const lectures: Array<{ tenant: string; id: string; conversation: string | undefined }> = [];
    const deps = {
      messagesApi: { message: async (tenant: string, idPublic: string) => (tenant === T ? lus[idPublic] ?? null : null) },
      lireImageRecue: async (tenant: string, id: string, conversation?: string) => { lectures.push({ tenant, id, conversation }); return lire(); },
    } as unknown as DepsMcp;
    return { deps, lectures };
  }
  const voir = (deps: DepsMcp, args: Record<string, unknown>, tenant = T) => outil('get_message_media').executer(deps, tenant, args, null);

  it('🔴 une photo revient en bloc image, lue par l’identifiant interne, dans la conversation', async () => {
    const { deps, lectures } = monterMedia();
    const r = await voir(deps, { conversation_id: CONV, message_id: PHOTO });
    expect(r).toBeInstanceOf(BlocsMcp);
    expect((r as BlocsMcp).blocs).toEqual([{ type: 'image', data: JPEG.toString('base64'), mimeType: 'image/jpeg' }]);
    expect(lectures).toEqual([{ tenant: T, id: ICI, conversation: CONV }]);
    // Un type annoncé avec ses paramètres est une image comme une autre.
    expect(await voir(deps, { conversation_id: CONV, message_id: PHOTO_PARAMS })).toBeInstanceOf(BlocsMcp);
  });

  it('🔴 un message d’une autre conversation, d’un autre espace, ou inconnu est introuvable, sans rien lire', async () => {
    const { deps, lectures } = monterMedia();
    for (const [tenant, message] of [[T, WAMID_AILLEURS], ['autre', PHOTO], [T, 'wamid.inconnu']] as const) {
      await expect(voir(deps, { conversation_id: CONV, message_id: message }, tenant), `${tenant} ${message}`).rejects.toMatchObject({ code: 'not_found' });
    }
    await expect(voir(deps, { conversation_id: 'cv-1', message_id: PHOTO })).rejects.toMatchObject({ code: 'not_found' });
    expect(lectures).toEqual([]);
  });

  it('un vocal renvoie vers transcribe_message ; un autre fichier, vers la console ; sans fichier ou périmé : introuvable ; rien n’est lu', async () => {
    const { deps, lectures } = monterMedia();
    await expect(voir(deps, { conversation_id: CONV, message_id: VOCAL })).rejects.toMatchObject({ code: 'unsupported', message: expect.stringMatching(/transcribe_message/) });
    await expect(voir(deps, { conversation_id: CONV, message_id: PDF }))
      .rejects.toMatchObject({ code: 'unsupported', message: expect.stringMatching(/\/inbox\?c=/), precisions: { action: expect.stringMatching(/\/inbox\?c=/) } });
    await expect(voir(deps, { conversation_id: CONV, message_id: TEXTE })).rejects.toMatchObject({ code: 'not_found' });
    await expect(voir(deps, { conversation_id: CONV, message_id: PERIME })).rejects.toMatchObject({ code: 'not_found' });
    expect(lectures).toEqual([]);
  });

  it('🔴 le type des OCTETS fait foi, jamais celui annoncé ; une image trop lourde et les pannes de lecture se disent dans le vocabulaire fermé', async () => {
    const cas: Array<[() => Promise<{ bytes: Buffer; mime: string | null } | null>, string]> = [
      // Le cas de la relecture : annoncé « image/png » par l'expéditeur, fait de HTML. Rendu en bloc image, il ferait
      // refuser chaque tour suivant de la session de l'opérateur.
      [async () => ({ bytes: Buffer.from('<html><script>alert(1)</script></html>'), mime: 'image/png' }), 'unsupported'],
      [async () => ({ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: 'image/jpeg' }), 'unsupported'],
      [async () => ({ bytes: Buffer.concat([JPEG, Buffer.alloc(TAILLE_MAX_IMAGE_MCP + 1 - JPEG.length)]), mime: 'image/jpeg' }), 'too_large'],
      [async () => { throw new MediaTropGros(30_000_000, 26_000_000); }, 'too_large'],
      [async () => { throw new MediaExpire(); }, 'not_found'],
      [async () => { throw new Error('panne de Meta'); }, 'unavailable'],
      [async () => null, 'not_found'],
    ];
    for (const [lire, code] of cas) {
      const { deps } = monterMedia(lire);
      await expect(voir(deps, { conversation_id: CONV, message_id: PHOTO }), code).rejects.toMatchObject({ code });
    }
    // À la borne, l'image passe ; et son type est celui de ses octets (un PNG annoncé JPEG part en PNG).
    const { deps } = monterMedia(async () => ({ bytes: Buffer.concat([PNG, Buffer.alloc(TAILLE_MAX_IMAGE_MCP - PNG.length)]), mime: 'image/jpeg' }));
    expect(((await voir(deps, { conversation_id: CONV, message_id: PHOTO })) as BlocsMcp).blocs[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('les quatre images que WhatsApp transmet passent, chacune avec le type de ses octets', async () => {
    const GIF = Buffer.from('GIF89a', 'latin1');
    const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1')]);
    for (const [octets, type] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [GIF, 'image/gif'], [WEBP, 'image/webp']] as const) {
      const { deps } = monterMedia(async () => ({ bytes: octets, mime: 'image/jpeg' }));
      expect(((await voir(deps, { conversation_id: CONV, message_id: PHOTO })) as BlocsMcp).blocs[0], type).toMatchObject({ type: 'image', mimeType: type });
    }
  });

  it('une lecture, ouverte à une clé comme get_messages', () => {
    const cle = outilsPour({ scopes: ['mcp:read'], personne: null }).map((o) => o.nom);
    expect(cle).toContain('get_message_media');
  });
});
