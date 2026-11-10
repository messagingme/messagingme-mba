import type { OutboundCarouselCard } from './template-components';
import { texteDe } from '../lib/erreur';
import { genreParAdresse, typeFichier, verifierVideo } from '../medias/fichier';

/**
 * Prépare les visuels d'un template pour l'envoi : chaque image lue chez Meta est re-téléversée sur le numéro
 * d'envoi, et c'est son `media id` qui part (cartes de carousel et en-tête média d'un template simple).
 *
 * Envoyer l'URL du CDN de Meta (`link`) est accepté par l'API puis échoue en `131053` quelques secondes plus
 * tard : le téléchargeur de Meta prend un 403 sur son propre CDN, alors que l'URL est lisible partout ailleurs.
 * Un seul exemplaire de cette logique, instancié par le worker et par l'API (Inbox).
 */
export interface TemplateMediaDeps {
  /** Numéro d'envoi du tenant : un `media id` est scopé au numéro qui l'a téléversé. */
  getPhoneNumberId(tenantId: string): Promise<string | null>;
  /** Client d'upload résolu par tenant (token du tenant). */
  mediaClientFor(tenantId: string): Promise<{ uploadForSend(phoneNumberId: string, bytes: Buffer, mime: string): Promise<string> }>;
  /**
   * Le fichier de la médiathèque de CET espace derrière un code (`/m/<code>.<ext>`), ou null : un code d'un autre espace
   * n'est jamais lu ici (spec médias, § 3.2). Les vidéos et les PDF ne sont pas servis publiquement : c'est le seul
   * chemin par lequel ils partent.
   */
  lireFichier(tenantId: string, code: string): Promise<{ bytes: Buffer; mime: string; nom: string | null } | null>;
  /**
   * Le téléchargement GARDÉ d'une adresse saisie par un client (`telechargerEnteteProduction`, `src/api/entete-par-url.ts` :
   * `fetchPublic`, `resolutionPublique`, sans redirection, lecture bornée au plafond du format). Un refus est une réponse.
   */
  telecharger(format: 'IMAGE' | 'VIDEO' | 'DOCUMENT', url: string): Promise<{ octets: Buffer; mime: string } | { refus: string }>;
  /**
   * La mémoire DURABLE des fichiers déposés (`medias_meta`, `PgMemoireDesMedias`), partagée par les redémarrages : sans
   * elle, chaque déploiement faisait relire le bucket (1,1 à 7,7 s mesurés le 2026-11-10) et redéposer chaque fichier.
   */
  memoire: MemoireDesMedias;
  /** Le fournisseur d'envoi de l'espace (`meta`, `360dialog`) : un identifiant déposé chez l'un n'est pas repris chez l'autre. */
  fournisseurDe(tenantId: string): Promise<string>;
  /** Téléchargement du visuel chez Meta. Injecté par les tests ; défaut : `fetch` global. */
  fetchImpl?: (url: string) => Promise<Response>;
  /** Horloge (tests du cache). Défaut : Date.now. */
  now?: () => number;
}

/**
 * Un media id vit 30 jours côté Meta : on le garde 7, large marge. 🔴 Pas plus : un identifiant que Meta ne connaît plus
 * peut être refusé APRÈS l'envoi (le message part puis n'est jamais livré), et rien ne le rattrape.
 */
export const MEDIA_CACHE_JOURS = 7;
const MEDIA_CACHE_MS = MEDIA_CACHE_JOURS * 86_400_000;

/** Ce qui identifie un fichier déposé : l'espace, le numéro et le fournisseur qui l'ont déposé, l'usage et l'adresse. */
export interface CleMediaMeta {
  tenantId: string;
  numero: string;
  fournisseur: string;
  /** `visuel` : en-tête ou carte d'un modèle (`prepareOne`, `prepare`) ; `fichier` : bloc « message rapide ». */
  usage: 'visuel' | 'fichier';
  /** L'adresse telle que la mémoire du processus la compare (sans la signature d'une URL du CDN de Meta). */
  adresse: string;
}

/** Un fichier déposé, tel que la mémoire le rend : le `type` et le `nom` ne valent que pour l'usage `fichier`. */
export interface MediaMemorise {
  mediaId: string;
  type: FichierPrepare['type'] | null;
  nom: string | null;
}

/** La mémoire durable des fichiers déposés (`PgMemoireDesMedias`). */
export interface MemoireDesMedias {
  /** Le dépôt de moins de `maxJours`, avec sa date (ms), ou null. */
  lire(cle: CleMediaMeta, maxJours: number): Promise<(MediaMemorise & { televerseLe: number }) | null>;
  /** Note un dépôt ; `codeMediatheque` permet de l'oublier quand le fichier est supprimé de la médiathèque. */
  noter(cle: CleMediaMeta, media: MediaMemorise, codeMediatheque: string | null): Promise<void>;
}

/** Le fichier d'un bloc prêt pour l'envoi : son identifiant chez Meta, la forme de l'en-tête, et le nom d'un document. */
export interface FichierPrepare {
  mediaId: string;
  type: 'image' | 'video' | 'document';
  nom: string | null;
}

/** Le chemin d'une adresse de la médiathèque, quel que soit son nom d'hôte (`api.`, `mba.`, anciens noms) : le code. */
const CHEMIN_MEDIATHEQUE = /^\/m\/([0-9a-hjkmnp-tv-z]{26})\.[a-z0-9]+$/i;
export function codeDeMediatheque(url: string): string | null {
  try {
    const m = CHEMIN_MEDIATHEQUE.exec(new URL(url).pathname);
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Une adresse du CDN de Meta, la seule que le visuel d'un modèle lu CHEZ META peut porter : elle garde le `fetch`
 * direct d'avant. 🔴 Chez 360dialog, le visuel d'un modèle est une URL publique quelconque, posée par qui a créé le
 * modèle (un autre logiciel sur le numéro, mesuré le 2026-10-15) : elle passe par le téléchargement GARDÉ.
 */
export function estCdnDeMeta(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'lookaside.fbsbx.com' || h.endsWith('.whatsapp.net') || h.endsWith('.fbcdn.net');
  } catch {
    return false;
  }
}

/** La forme d'en-tête que WhatsApp accepte pour un type de fichier, ou null (refus). */
function typeEnTete(mime: string): FichierPrepare['type'] | null {
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/gif') return 'image';
  if (mime === 'video/mp4') return 'video';
  if (mime === 'application/pdf') return 'document';
  return null;
}

/**
 * Le fichier d'un bloc « message rapide », lu et jugé comme l'envoi le lira : une fiche de la médiathèque de l'espace par
 * (espace, code), sinon le téléchargement GARDÉ de l'adresse, le type tranché sur les octets, une vidéo vérifiée. Le
 * point de passage commun de l'envoi (`prepareFichier`) et de la vérification d'un scénario écrit par l'API : un fichier
 * que l'un refuse, l'autre le refuse aussi. Ne lève jamais.
 */
export async function lireFichierDuBloc(
  deps: Pick<TemplateMediaDeps, 'lireFichier' | 'telecharger'>,
  tenantId: string,
  url: string,
): Promise<{ lu: { bytes: Buffer; mime: string; nom: string | null }; type: FichierPrepare['type'] } | { refus: string }> {
  try {
    const code = codeDeMediatheque(url);
    const local = code ? await deps.lireFichier(tenantId, code) : null;
    let lu: { bytes: Buffer; mime: string; nom: string | null };
    if (local) {
      // Le type d'une fiche est celui lu à son dépôt, sur ses octets, et une vidéo y a déjà été lue.
      lu = local;
    } else {
      const genre = genreParAdresse(url);
      const telecharge = await deps.telecharger(genre === 'video' ? 'VIDEO' : genre === 'document' ? 'DOCUMENT' : 'IMAGE', url);
      if ('refus' in telecharge) return { refus: `téléchargement du fichier : ${telecharge.refus}` };
      const mime = typeFichier(telecharge.octets);
      if (mime === 'video/mp4') {
        const raison = verifierVideo(telecharge.octets);
        if (raison) return { refus: raison };
      }
      lu = { bytes: telecharge.octets, mime: mime ?? '', nom: null };
    }
    const type = typeEnTete(lu.mime);
    if (!type) return { refus: `type de fichier non accepté par WhatsApp : ${lu.mime || 'inconnu'}` };
    return { lu, type };
  } catch (err) {
    return { refus: `le fichier n’a pas pu être lu (${texteDe(err).slice(0, 200)})` };
  }
}

/** La vérification d'un scénario écrit par l'API : la raison du refus, ou `null` si l'envoi pourra lire ce fichier. */
export async function verifierFichierDuBloc(
  deps: Pick<TemplateMediaDeps, 'lireFichier' | 'telecharger'>,
  tenantId: string,
  url: string,
): Promise<string | null> {
  const r = await lireFichierDuBloc(deps, tenantId, url);
  return 'refus' in r ? r.refus : null;
}

export class TemplateMediaPreparer {
  /**
   * Cache par chemin d'image (l'URL porte une signature qui change à chaque lecture du template) : sans lui, une
   * campagne re-téléverserait le même visuel pour chaque destinataire.
   */
  private readonly cache = new Map<string, { at: number; id: string }>();

  constructor(private readonly deps: TemplateMediaDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * La clé durable d'un fichier, ou null quand le fournisseur ne se lit pas (jeton invalide, base) : la mémoire durable
   * est alors sautée, et le dépôt qui suit lèvera de lui-même s'il ne peut pas se faire.
   */
  private async cleDurable(tenantId: string, numero: string, usage: CleMediaMeta['usage'], adresse: string): Promise<CleMediaMeta | null> {
    try {
      return { tenantId, numero, fournisseur: await this.deps.fournisseurDe(tenantId), usage, adresse };
    } catch {
      return null;
    }
  }

  /** 🔴 La mémoire durable n'empêche JAMAIS un envoi : en panne (base, table absente), on lit et on dépose comme avant. */
  private async relire(cle: CleMediaMeta | null): Promise<(MediaMemorise & { televerseLe: number }) | null> {
    if (!cle) return null;
    try {
      return await this.deps.memoire.lire(cle, MEDIA_CACHE_JOURS);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mémoire des médias : lecture impossible, le fichier sera redéposé :', texteDe(err));
      return null;
    }
  }

  private async noter(cle: CleMediaMeta | null, media: MediaMemorise): Promise<void> {
    if (!cle) return;
    try {
      await this.deps.memoire.noter(cle, media, codeDeMediatheque(cle.adresse));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mémoire des médias : dépôt non noté :', texteDe(err));
    }
  }

  /**
   * Téléverse (ou relit du cache) un visuel pour un numéro d'envoi déjà résolu. La clé de cache porte le numéro :
   * un `media id` est scopé au numéro qui l'a téléversé, et un numéro remplacé réutiliserait sinon un identifiant
   * inutilisable. La mémoire du processus d'abord, la mémoire durable ensuite, le dépôt enfin.
   */
  private async televerse(tenantId: string, pn: string, mediaUrl: string): Promise<string | null> {
    // Le chemin seul pour le CDN de Meta, dont la query n'est qu'une signature ; l'URL ENTIÈRE ailleurs (modèle
    // 360dialog), où la query peut être ce qui distingue deux images.
    const adresse = estCdnDeMeta(mediaUrl) ? mediaUrl.split('?')[0]! : mediaUrl;
    const cle = `${pn}|${adresse}`;
    const hit = this.cache.get(cle);
    if (hit && this.now() - hit.at < MEDIA_CACHE_MS) return hit.id;
    const durable = await this.cleDurable(tenantId, pn, 'visuel', adresse);
    const relu = await this.relire(durable);
    if (relu) {
      // La date du DÉPÔT, pas celle de la relecture : la mémoire du processus ne prolonge pas les 7 jours.
      this.cache.set(cle, { at: relu.televerseLe, id: relu.mediaId });
      return relu.mediaId;
    }
    const get = this.deps.fetchImpl ?? ((url: string) => fetch(url));
    try {
      const media = await this.deps.mediaClientFor(tenantId);
      const { bytes, mime } = await this.lireVisuel(tenantId, mediaUrl, get);
      const id = await media.uploadForSend(pn, bytes, mime);
      this.cache.set(cle, { at: this.now(), id });
      await this.noter(durable, { mediaId: id, type: null, nom: null });
      return id;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("média de template : visuel non préparé pour l'envoi:", texteDe(err));
      return null;
    }
  }

  /**
   * Les octets d'un visuel de modèle : le CDN de Meta comme avant ; une adresse de NOTRE médiathèque, lue par (espace,
   * code) ; toute autre adresse par le téléchargement gardé, le type tranché sur les octets. Lève en cas d'échec.
   */
  private async lireVisuel(tenantId: string, url: string, get: (url: string) => Promise<Response>): Promise<{ bytes: Buffer; mime: string }> {
    if (estCdnDeMeta(url)) {
      const res = await get(url);
      if (!res.ok) throw new Error(`téléchargement du visuel: HTTP ${res.status}`);
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'image/jpeg' };
    }
    const code = codeDeMediatheque(url);
    const local = code ? await this.deps.lireFichier(tenantId, code) : null;
    if (local) return { bytes: local.bytes, mime: local.mime };
    const genre = genreParAdresse(url);
    const telecharge = await this.deps.telecharger(genre === 'video' ? 'VIDEO' : genre === 'document' ? 'DOCUMENT' : 'IMAGE', url);
    if ('refus' in telecharge) throw new Error(`téléchargement du visuel : ${telecharge.refus}`);
    const mime = typeFichier(telecharge.octets);
    if (!mime || typeEnTete(mime) === null) throw new Error(`type de visuel non accepté par WhatsApp : ${mime ?? 'inconnu'}`);
    return { bytes: telecharge.octets, mime };
  }

  /**
   * Une URL de visuel -> son `media id`, ou null si la préparation a échoué. Ne lève jamais : l'appelant refuse
   * l'envoi en nommant ce qui manque, plutôt que de laisser partir un message que Meta accepterait sans le livrer.
   * Point d'entrée commun aux cartes et à l'en-tête : un même visuel sur un même numéro ne se téléverse qu'une fois.
   */
  async prepareOne(tenantId: string, mediaUrl: string): Promise<string | null> {
    if (mediaUrl === '') return null;
    const pn = await this.deps.getPhoneNumberId(tenantId);
    if (!pn) {
      // eslint-disable-next-line no-console
      console.error('média de template : aucun numéro d’envoi pour le tenant, visuel non préparé');
      return null;
    }
    return this.televerse(tenantId, pn, mediaUrl);
  }

  /** Cache du fichier d'un bloc : même clé que les visuels (numéro et chemin), le type et le nom en plus. */
  private readonly fichiers = new Map<string, { at: number } & FichierPrepare>();

  /**
   * Le fichier d'un bloc « message rapide » prêt pour l'envoi, ou null (le bloc refuse alors en le nommant). Une adresse
   * de la médiathèque se lit DIRECTEMENT par (espace, code), sans passer par HTTP : vidéos et PDF n'ont pas d'adresse
   * publique, et une image y gagne un aller-retour par Cloudflare. Faute de fiche dans cet espace, ou pour une adresse
   * étrangère, 🔴 l'adresse est saisie par le client : elle passe par le téléchargement GARDÉ (`telecharger`, https, adresse
   * publique vérifiée à la connexion, sans redirection, lecture bornée), jamais par un `fetch` nu, et le type se tranche
   * sur les octets, une vidéo lue comme au dépôt. Une image publique d'un autre espace marche comme avant. Ne lève jamais.
   * La clé du cache porte l'ESPACE : un numéro rattaché à un autre espace ne réutilise pas un identifiant qui n'est pas
   * le sien.
   */
  async prepareFichier(tenantId: string, url: string): Promise<FichierPrepare | null> {
    if (url === '') return null;
    const pn = await this.deps.getPhoneNumberId(tenantId);
    if (!pn) {
      // eslint-disable-next-line no-console
      console.error('fichier du bloc : aucun numéro d’envoi pour le tenant, fichier non préparé');
      return null;
    }
    const adresse = url.split('?')[0]!;
    const cle = `${tenantId}|${pn}|${adresse}`;
    const hit = this.fichiers.get(cle);
    if (hit && this.now() - hit.at < MEDIA_CACHE_MS) return { mediaId: hit.mediaId, type: hit.type, nom: hit.nom };
    const durable = await this.cleDurable(tenantId, pn, 'fichier', adresse);
    const relu = await this.relire(durable);
    if (relu?.type) {
      const pret: FichierPrepare = { mediaId: relu.mediaId, type: relu.type, nom: relu.nom };
      this.fichiers.set(cle, { at: relu.televerseLe, ...pret });
      return pret;
    }
    try {
      const fichier = await lireFichierDuBloc(this.deps, tenantId, url);
      if ('refus' in fichier) throw new Error(fichier.refus);
      const { lu, type } = fichier;
      const media = await this.deps.mediaClientFor(tenantId);
      const mediaId = await media.uploadForSend(pn, lu.bytes, lu.mime);
      const pret: FichierPrepare = { mediaId, type, nom: lu.nom };
      this.fichiers.set(cle, { at: this.now(), ...pret });
      await this.noter(durable, pret);
      return pret;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("fichier du bloc : non préparé pour l'envoi:", texteDe(err));
      return null;
    }
  }

  /**
   * Rend les cartes prêtes à l'envoi. Une carte dont le visuel n'a pas pu être préparé revient sans `mediaId` :
   * `carouselSendBlocker` refuse alors l'envoi en la nommant. Le numéro d'envoi est résolu une fois pour toutes.
   */
  async prepare(tenantId: string, cards: OutboundCarouselCard[]): Promise<OutboundCarouselCard[]> {
    const pn = await this.deps.getPhoneNumberId(tenantId);
    if (!pn) {
      // eslint-disable-next-line no-console
      console.error('carousel: aucun numéro d’envoi pour le tenant, visuels non préparés');
      return cards;
    }
    return Promise.all(cards.map(async (card) => {
      if (!card.mediaUrl) {
        // eslint-disable-next-line no-console
        console.error('carousel: carte sans URL de visuel lisible chez Meta (handle non exploitable)');
        return card;
      }
      const id = await this.televerse(tenantId, pn, card.mediaUrl);
      return id ? { ...card, mediaId: id } : card;
    }));
  }
}
