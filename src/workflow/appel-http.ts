import { creerAppelConnecteur, type DepsResolveurHttp } from '../agent/resolvers/http';
import type { JournalAppels } from '../agent/catalog';
import { messageDe } from '../lib/erreur';
import type { PgPiecesQuestion } from './pieces-question.pg';
import { DUREE_LIEN_PIECE_MS, jetonPiece, lienPiece } from './piece-lien';
import { ressembleAUneMention } from './question-piece';
import { MAX_OCTETS_CHAMP_JSON, jsonDeChamp } from '../crm/fields';
import type { UserFieldType } from '../crm/types';

/**
 * Le bloc « Appel HTTP » d'un scénario : jouer un appel déjà mis au point dans Tools > Connecteurs API, et
 * ranger sa réponse dans un champ du contact.
 *
 * Il ne décrit aucun appel, il en désigne un : adresse, méthode, corps, variables et filtre de sortie vivent
 * dans la bibliothèque, éprouvés une fois avec « Essayer ». Une seconde façon de déclarer un appel aurait ses
 * propres gardes à écrire et à oublier. Seule exception, voulue (spec du 2026-11-11) : vers un champ `json`, la réponse
 * se range ENTIÈRE, sans le filtre de sortie, qui ne borne plus que l'agent IA.
 *
 * Aucune garde ici : elles sont toutes dans `creerAppelConnecteur`, partagé avec l'agent IA et la poussée
 * d'un opt-out. Il n'y a ici que la traduction « réponse -> valeur de champ ».
 */

/** Plafond de lecture du corps pour ce chemin, en octets. Une réponse plus grosse est refusée, pas tronquée. */
export const MAX_OCTETS_APPEL_HTTP = 64 * 1024;

/**
 * Combien de temps un bloc de scénario attend son connecteur. Plus court que pour l'agent IA (30 s) : un
 * contact attend la suite de son parcours. Au-delà, le champ est vidé et le parcours continue.
 */
export const DELAI_APPEL_HTTP_MS = 10_000;

/**
 * La réponse d'un connecteur, telle qu'elle se range dans un champ de contact. Pure.
 *
 * Un seul champ déclaré -> sa valeur nue, pour qu'une condition puisse la tester (l'écran de condition ne lit
 * pas de JSON). Plusieurs champs -> l'objet JSON, faute de façon honnête d'en choisir un. Une valeur absente
 * donne une chaîne vide, comme un échec : le scénario branche sur « le champ est vide ».
 */
export function valeurPourChamp(contenu: unknown): string {
  if (contenu === null || typeof contenu !== 'object' || Array.isArray(contenu)) return '';
  const entrees = Object.entries(contenu as Record<string, unknown>);
  if (entrees.length === 0) return '';
  if (entrees.length === 1) {
    const v = entrees[0]![1];
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return JSON.stringify(contenu);
}

/**
 * La réponse ENTIÈRE, telle qu'elle se range dans un champ `json` (spec du 2026-11-11). Pure. La lecture `entier` du
 * résolveur rend le JSON parsé, le texte tel quel s'il n'en est pas (il devient alors une chaîne JSON), `null` pour un
 * corps vide. `null` en retour = trop gros pour le champ, traité comme un échec.
 */
export function valeurPourChampJson(contenu: unknown): string | null {
  const reponse = contenu !== null && typeof contenu === 'object' && !Array.isArray(contenu)
    ? (contenu as { reponse?: unknown }).reponse ?? null
    : null;
  return jsonDeChamp(JSON.stringify(reponse));
}

/** Ce que le câblage doit fournir en plus des dépendances du connecteur. */
export interface DepsAppelHttpScenario extends DepsResolveurHttp {
  /**
   * Le type du champ cible, qui décide de la lecture : `json` range la réponse entière, tout autre type lit les champs
   * de réponse du connecteur, comme avant. `null` = champ inconnu (lecture d'avant). Requise : sans elle, un champ JSON
   * recevrait la valeur filtrée sans que rien ne le dise.
   */
  typeDuChamp(tenantId: string, cle: string): Promise<UserFieldType | null>;
  /**
   * Le journal des appels de connecteur, où le client voit qu'un connecteur a refusé l'appel d'un scénario.
   * Optionnel : absent, seul un `console.warn` en garde trace.
   */
  journalAppels?: JournalAppels;
  /** Le libellé de la requête jouée, pour que le journal nomme ce qu'un humain reconnaît. */
  libelleRequete?(tenantId: string, requestId: string): Promise<string | null>;
  /**
   * La projection du contact (`{nom, tags, champs}`), source des variables `champ` (celles d'origine `fiche` se
   * lisent par `ficheDuContact`). Chargée à
   * chaque appel : le bloc peut suivre un bloc qui vient d'écrire un champ, et une photo d'avant enverrait
   * l'ancienne valeur.
   */
  projectionContact(tenantId: string, waId: string): Promise<Record<string, unknown> | null>;
  /**
   * 🔴 LA PIÈCE D'UN BLOC QUESTION (spec du 2026-11-02). Le champ ne porte qu'une mention ; le lien vers le fichier se
   * fabrique ICI, au moment où l'appel part, et seulement si le champ porte ENCORE la mention notée. Ce câblage est le
   * seul à recevoir cette capacité : l'agent IA, la poussée d'un désabonnement et le bouton « Essayer » envoient la
   * mention telle quelle. Requises, pour qu'un câblage qui les oublie ne compile pas.
   */
  pieces: Pick<PgPiecesQuestion, 'liensPossibles'>;
  /** Le secret qui signe le lien (`AUTH_SECRET`, dérivé pour cet usage dans `piece-lien.ts`). */
  secretPiece: string;
  /** La base des adresses servies par l'API, où vit `/f/:jeton`. */
  baseApi: string;
  maintenant?(): Date;
}

/**
 * La projection du contact où chaque champ qui porte encore la mention d'une pièce notée devient un lien neuf, valable
 * quinze minutes. Une copie : la projection reçue n'est pas modifiée. Sans champ qui ressemble à une mention, les pièces
 * ne sont même pas lues.
 */
async function avecLiensDesPieces(
  deps: DepsAppelHttpScenario, tenantId: string, waId: string, contact: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  const champs = contact?.champs;
  if (contact === null || champs === null || typeof champs !== 'object' || Array.isArray(champs)) return contact;
  const valeurs = champs as Record<string, unknown>;
  if (!Object.values(valeurs).some(ressembleAUneMention)) return contact;
  const notees = await deps.pieces.liensPossibles(tenantId, waId);
  const vivantes = notees.filter((p) => valeurs[p.cle] === p.mention);
  if (vivantes.length === 0) return contact;
  const maintenant = deps.maintenant ? deps.maintenant() : new Date();
  const expireLe = new Date(maintenant.getTime() + DUREE_LIEN_PIECE_MS);
  const copie: Record<string, unknown> = { ...valeurs };
  for (const p of vivantes) copie[p.cle] = lienPiece(deps.baseApi, jetonPiece(tenantId, p.metaMessageId, expireLe, deps.secretPiece));
  return { ...contact, champs: copie };
}

/**
 * Le câblage du bloc, prêt à être posé sur `WorkflowExecutorDeps.appelHttp`. N'échoue jamais vers
 * l'appelant : un connecteur en panne rend `{ok: false}` (champ vidé), sans arrêter le parcours au milieu.
 */
export function creerAppelHttpScenario(deps: DepsAppelHttpScenario) {
  const appel = creerAppelConnecteur(deps);
  return async (
    tenantId: string, waId: string, requestId: string, champCible: string,
  ): Promise<{ ok: boolean; valeur: string }> => {
    try {
      /**
       * La lecture se décide sur le champ cible : aucun -> l'appel pousse ; un champ `json` -> la réponse entière, sans le
       * filtre du connecteur (qui ne borne plus que l'agent IA) ; tout autre -> les champs de réponse, comme avant.
       */
      const lecture = champCible === '' ? 'pousse' : (await deps.typeDuChamp(tenantId, champCible)) === 'json' ? 'entier' : 'integre';
      const contact = await avecLiensDesPieces(deps, tenantId, waId, await deps.projectionContact(tenantId, waId));
      const r = await appel({
        tenantId,
        waId,
        contact,
        requestId,
        // Pour un champ `json`, le plafond du champ borne la LECTURE : une réponse plus grosse est refusée par le transport
        // (`trop_gros`), donc écrite au journal des appels comme tout refus, au lieu d'être lue puis jetée.
        maxBytes: lecture === 'entier' ? MAX_OCTETS_CHAMP_JSON : MAX_OCTETS_APPEL_HTTP,
        // Aucun argument de modèle : un scénario n'a pas de modèle qui décide. Une requête qui déclare une
        // variable `modele` requise sera refusée avec sa raison.
        args: {},
        /**
         * Un bloc avec champ cible intègre la réponse et lit les champs de la requête (`champs: null`) : il n'a
         * pas d'outil, donc pas de liste à lui. Sans champ cible, il pousse : le corps n'est pas lu, un 2xx
         * (204 compris) vaut succès, et la requête n'a pas à déclarer de champ de réponse.
         */
        lecture: lecture === 'pousse' ? { nature: 'pousse' } as const
          : lecture === 'entier' ? { nature: 'entier' } as const
          : { nature: 'integre', champs: null } as const,
        signal: AbortSignal.timeout(DELAI_APPEL_HTTP_MS),
        journal: deps.journalAppels
          ? {
            journal: deps.journalAppels,
            source: 'scenario',
            // Le libellé si on sait le lire, l'identifiant sinon : une ligne de journal incomplète vaut mieux que
            // pas de ligne.
            nom: (deps.libelleRequete ? await deps.libelleRequete(tenantId, requestId) : null) ?? requestId,
            // Un scénario n'ouvre aucune session d'agent et n'a aucun outil.
            sessionId: null,
            toolId: null,
          }
          : null,
      });
      if (r.ok === false) {
        // eslint-disable-next-line no-console
        console.warn(`workflow appelHttp: ${requestId} a echoue pour ${waId} (${r.erreur ?? 'sans raison'}), le champ est vide`);
        return { ok: false, valeur: '' };
      }
      // Un appel qui pousse n'a rien à ranger : son contenu n'est que le verdict (`{ok, statut}`).
      if (lecture === 'pousse') return { ok: true, valeur: '' };
      if (lecture === 'integre') return { ok: true, valeur: valeurPourChamp(r.contenu) };
      // Un texte non JSON devient une chaîne JSON, échappée : il peut dépasser le plafond que son corps tenait.
      const json = valeurPourChampJson(r.contenu);
      if (json === null) {
        // eslint-disable-next-line no-console
        console.warn(`workflow appelHttp: ${requestId} pour ${waId}, reponse trop grosse pour un champ JSON, le champ est vide`);
        return { ok: false, valeur: '' };
      }
      return { ok: true, valeur: json };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`workflow appelHttp: ${requestId} a leve pour ${waId}:`, messageDe(err));
      return { ok: false, valeur: '' };
    }
  };
}
