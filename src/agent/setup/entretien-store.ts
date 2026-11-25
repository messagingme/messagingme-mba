import { z } from 'zod';
import { ACTIONS, type Bascule, type Reponse } from './couverture';
import { MAX_CARACTERES_MESSAGE, MAX_TOURS_HISTORIQUE } from './conversation';

/**
 * L'entretien de construction, tel que le serveur le tient.
 *
 * Ce jsonb a été écrit à partir d'une sortie de modèle : il est validé à la relecture (`safeParse`), et un
 * état corrompu redémarre un entretien vierge plutôt que de faire échouer l'écran.
 */

export interface TourEntretien {
  role: 'user' | 'assistant';
  content: string;
}

export interface EntretienComplet {
  messages: TourEntretien[];
  reponses: Reponse[];
  poses: string[];
  /** Les moments de bascule et leur traitement. À part des `reponses` parce que c'est une liste : autant de
   *  moments que le client en cite, chacun avec sa propre action et son propre moyen. */
  bascules: Bascule[];
  /**
   * Qui a écrit chaque message : l'identifiant du membre, dans le même ordre que `messages`, `null` pour
   * l'assistant et pour les tours anciens (d'où un tableau parfois plus court).
   *
   * Un tableau parallèle, pas une clé dans `messages` : `tourSchema` est strict, et une clé obligatoire ferait
   * échouer la relecture de tous les entretiens existants, qui retomberaient en silence sur l'entretien vierge.
   * Un identifiant et pas un e-mail : un auteur parti affiche « auteur inconnu », sans recopier une adresse
   * dans un jsonb que personne ne purge.
   */
  auteurs: Array<string | null>;
  /**
   * L'adresse du site donnée au point `connaissance`, mémorisée pour remplir la base de connaissance au lieu
   * de rester en texte libre dans `reponses`. Optionnelle : les entretiens anciens n'en portent pas, et la
   * route retombe alors sur une extraction depuis la réponse.
   */
  connaissanceUrl?: string;
  /**
   * La dernière proposition pas encore enregistrée ni jetée (`en-attente.ts`), relue par `relireEnAttente`, qui la
   * valide et la recalcule. Optionnelle, sans défaut, comme `connaissanceUrl`.
   */
  enAttente?: unknown;
}

/** Un entretien vierge. C'est aussi ce qu'on rend d'un état illisible : on ne bloque jamais l'écran. */
export const ENTRETIEN_VIERGE: EntretienComplet = { messages: [], reponses: [], poses: [], bascules: [], auteurs: [] };

/**
 * 🔴 AUCUNE BORNE DE LONGUEUR SUR UN MESSAGE RELU. `MAX_CARACTERES_MESSAGE` borne ce que le CLIENT envoie, pas ce
 * que l'assistant écrit : sa réponse (jusqu'à `BORNES_PROPOSITION.message`) reçoit en plus la relance du serveur,
 * l'annonce d'import et le bloc de fin. Une borne ici rendait illisible tout le fil dès qu'un message la dépassait,
 * donc vierge à l'écran, puis écrasé par le message suivant. Ce que le modèle reçoit reste borné par
 * `bornerPourModele`.
 */
const tourSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

/** Une chaîne RAMENÉE à sa borne, plutôt que refusée : une borne dépassée ne doit jamais coûter tout le fil. */
const texteBorne = (max: number) => z.string().transform((s) => s.slice(0, max));

/** Plafond du nombre de moments de bascule. Chacun engendre deux questions : au-delà, l'entretien cesserait
 *  d'être un entretien. */
export const MAX_BASCULES = 12;

/**
 * Plafond de ce que le fil conserve, sans rapport avec `MAX_TOURS_HISTORIQUE` qui borne ce qu'on envoie :
 * une garde contre un jsonb qui grossirait sans fin, pas une politique de contexte.
 */
export const MAX_TOURS_CONSERVES = 4000;

/**
 * 🔴 LES BORNES SE RAMÈNENT, ELLES NE SE REFUSENT PAS. Ce jsonb est écrit par notre serveur ; une borne dépassée y
 * est de l'HYGIÈNE, pas une frontière. Refusée, elle faisait retomber tout l'entretien sur le vierge (cf. `lireEtat`),
 * et le tour suivant écrasait le fil en base : une seule valeur trop longue coûtait toute la conversation. Les listes
 * gardent leurs premiers éléments, le fil et ses auteurs leurs derniers.
 */
const etatSchema = z.object({
  /**
   * Plafonné large, pas à la taille du contexte : ce qu'on envoie au modèle est borné ailleurs.
   */
  messages: z.array(tourSchema).default([]).transform((m) => m.slice(-MAX_TOURS_CONSERVES)),
  reponses: z.array(z.object({
    point: texteBorne(64),
    valeur: texteBorne(2000),
  })).default([]).transform((r) => r.slice(0, 64)),
  poses: z.array(texteBorne(64)).default([]).transform((p) => p.slice(0, 64)),
  bascules: z.array(z.object({
    moment: texteBorne(400),
    action: z.enum(ACTIONS).optional().catch(undefined),
    moyen: texteBorne(2000).optional(),
  })).default([]).transform((b) => b.slice(0, MAX_BASCULES)),
  auteurs: z.array(z.string().max(320).nullable().catch(null)).default([]).transform((a) => a.slice(-MAX_TOURS_CONSERVES)),
  // Sans `.default()`, contrairement au reste : « absente » et « vide » ne disent pas la même chose, et un
  // défaut écrirait une chaîne vide dans le jsonb de chaque entretien existant. Une adresse hors borne est
  // oubliée plutôt que tronquée : coupée, elle désignerait une autre page.
  connaissanceUrl: z.string().max(2000).optional().catch(undefined),
  // Validée à son usage (`relireEnAttente`) : une forme illisible y rend « pas de proposition », jamais un fil vierge.
  enAttente: z.unknown().optional(),
});


/** Relit un état stocké. Illisible -> entretien vierge, jamais une exception. */
export function lireEtat(brut: unknown): EntretienComplet {
  const parse = etatSchema.safeParse(brut ?? {});
  return parse.success ? parse.data : ENTRETIEN_VIERGE;
}

/**
 * Borne l'historique envoyé au modèle, pas ce qui est conservé : le fil garde tout, le prompt reste borné,
 * sinon un historique sans fin pousserait la fiche courante hors de la fenêtre du modèle. Appelée à la
 * lecture, jamais à l'écriture, où elle détruirait les tours anciens. On garde les derniers tours.
 */
export function bornerPourModele(messages: readonly TourEntretien[]): TourEntretien[] {
  return messages
    .slice(-MAX_TOURS_HISTORIQUE * 2)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CARACTERES_MESSAGE) }));
}

export interface EntretienStore {
  /** L'entretien en cours, ou `null` s'il n'y en a jamais eu. Scopé tenant. */
  lire(tenantId: string, agentId: string): Promise<EntretienComplet | null>;
  ecrire(tenantId: string, agentId: string, etat: EntretienComplet): Promise<void>;
  /** Repart de zéro. Le client doit pouvoir jeter un entretien qui a mal tourné sans supprimer son agent. */
  effacer(tenantId: string, agentId: string): Promise<void>;
}
