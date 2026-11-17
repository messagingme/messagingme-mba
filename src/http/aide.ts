import type { FastifyInstance } from 'fastify';
import { gardeEtendue, makeRequireRole, type Guard } from '../auth/middleware';
import { RateLimiter } from '../auth/rate-limit';
import { espaceVerifie } from './scope';
import { QUESTION_MAX_CARACTERES, type CoutAide, type QuestionAide, type ReponseAide } from '../aide/repondre';
import { creerCacheRecap } from '../aide/recap-cache';
import type { RecapTexte } from '../aide/recap-rendu';
import { resoudre } from '../aide/carte';
import { lireFicheAide } from '../aide/fiche-disque';
import { reserverBudget, solderReservation, type BudgetAssistantDeps } from '../assistant/budget';
import { addDays, todayParis } from '../stats/range';
import { texteDe } from '../lib/erreur';

/**
 * Le bot d'aide de la console : une route synchrone (la personne attend devant son écran, une file n'apporterait
 * rien). Il n'écrit rien : il répond et pose des liens vers des écrans.
 * 🔴 Les tokens sont à notre charge (clé maison, pas le crédit du client) : chaque question entre dans l'enveloppe
 * mensuelle de l'espace, commune aux deux assistants (`src/assistant/budget.ts`), et le plafond de débit ci-dessous
 * arrête une boucle avant elle.
 */
export interface AideRouteDeps {
  /**
   * Absent = l'aide n'est pas configurée (clé du Gateway ou modèle manquant) -> 503, jamais un repli muet. Il ajoute
   * à `cout` ce que ses appels ont coûté.
   */
  repondre?(q: QuestionAide, cout: CoutAide): Promise<ReponseAide>;
  /** 🔴 Requis : sur notre clé, rien d'autre ne borne la dépense d'un espace sur le mois. */
  budget: BudgetAssistantDeps;
  /** Le récap du jour. Toujours câblé en production. Voir `RecapRouteDeps`. */
  recap: RecapRouteDeps;
}

/** Ce que l'aide répond quand l'enveloppe du mois est vide : une limite voulue, dite comme telle. */
const PLAFOND_AIDE = {
  fr: 'Je ne peux plus répondre aux questions de cet espace jusqu’au mois prochain. '
    + 'Toute la console reste utilisable, comme d’habitude.',
  en: 'I can no longer answer questions for this workspace until next month. '
    + 'The whole console remains available, as usual.',
};

export interface RecapRouteDeps {
  /**
   * Calcule et rédige le récap d'un jour, pour un espace. Le jour est choisi par la route, jamais par le client :
   * le récap porte sur la veille seulement, et laisser nommer le jour rouvrirait toute l'histoire de l'espace.
   */
  calculer(tenantId: string, jour: string, langue: 'fr' | 'en'): Promise<RecapTexte>;
  /** Le jour civil courant dans le fuseau des stats. Injectable : c'est ce qui rend le cache testable. */
  aujourdhui?(): string;
}

/**
 * Où le récap emmène. Résolu dans la route et pas dans le texte mis en cache, parce qu'il dépend du rôle : sinon
 * tout l'espace recevrait les liens du premier qui a cliqué.
 */
const ECRANS_RECAP = ['dashboard-quali'];

/**
 * Qui a droit au récap. 🔴 La garde est côté serveur (masquer le bouton n'est pas un contrôle d'accès) : le récap
 * est un outil de pilotage, un opérateur (`agent`) n'y a pas droit. Le message de refus commun parle
 * d'administrateurs, les managers passent aussi : il reste juste pour qui le reçoit.
 */
const ROLES_RECAP = ['admin', 'manager'] as const;

/**
 * Le plafond de débit de cette route, par espace et non par utilisateur : chaque question coûte un appel de modèle
 * sur notre clé, et c'est l'espace qui la consomme. Vingt par minute laissent une équipe travailler et arrêtent
 * une boucle.
 */
const PAR_MINUTE = 20;

/** Combien d'échanges passés la route accepte. Le moteur en garde autant, ce plafond-ci borne la requête. */
const MAX_ECHANGES_RECUS = 4;
/** Une réponse du bot tient largement là-dedans ; au-delà, c'est un appelant qui gonfle le prompt. */
const REPONSE_MAX_CARACTERES = 4_000;

export function registerAide(app: FastifyInstance, deps: AideRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };
  const limiter = new RateLimiter(PAR_MINUTE, 60_000);
  const cacheRecap = creerCacheRecap<RecapTexte>();

  app.post('/tenants/:tenantId/aide', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (!limiter.take(tenant)) {
      return reply.code(429).send({ error: 'trop de questions d’un coup, réessaie dans une minute' });
    }
    if (!deps.repondre) return reply.code(503).send({ error: 'aide indisponible (non configurée)' });

    const b = (req.body ?? {}) as { question?: unknown; ecranCourant?: unknown; langue?: unknown; historique?: unknown };
    const question = typeof b.question === 'string' ? b.question.trim() : '';
    if (question === '') return reply.code(400).send({ error: 'question requise' });
    // 4xx et pas 5xx : Cloudflare remplacerait le corps, et le client ne lirait jamais la raison.
    if (question.length > QUESTION_MAX_CARACTERES) {
      return reply.code(400).send({ error: `question trop longue (${QUESTION_MAX_CARACTERES} caractères maximum)` });
    }

    // 🔴 Le rôle vient du jeton, jamais du corps : il décide des écrans qu'on a le droit de montrer.
    const role = req.auth?.role ?? 'agent';
    const ecranCourant = typeof b.ecranCourant === 'string' && b.ecranCourant.trim() !== ''
      ? b.ecranCourant.trim().slice(0, 60) : null;
    const langue = b.langue === 'en' ? 'en' : 'fr';

    /**
     * L'historique de la conversation, envoyé par l'écran. Il vient du client, donc il est borné ici (quatre
     * échanges, aux bornes d'une question et d'une réponse : sinon il gonflerait le prompt, donc notre facture) et
     * validé forme par forme (une entrée mal typée est ignorée, pas devinée).
     */
    const brut = Array.isArray(b.historique) ? b.historique : [];
    const historique = brut
      .filter((e): e is { question: string; reponse: string } => typeof e === 'object' && e !== null
        && typeof (e as { question?: unknown }).question === 'string'
        && typeof (e as { reponse?: unknown }).reponse === 'string')
      .slice(-MAX_ECHANGES_RECUS)
      .map((e) => ({
        question: e.question.slice(0, QUESTION_MAX_CARACTERES),
        reponse: e.reponse.slice(0, REPONSE_MAX_CARACTERES),
      }));

    // Réservée juste avant les appels payés, soldée sur chaque sortie au coût de ceux qui ont abouti.
    const reservation = await reserverBudget(deps.budget, tenant);
    if (!reservation) {
      return reply.code(200).send({ sait: true, texte: PLAFOND_AIDE[langue], sources: [], ecrans: [] } satisfies ReponseAide);
    }
    const cout: CoutAide = { dollars: 0 };
    let r: ReponseAide;
    try {
      r = await deps.repondre({ question, role, langue, ecranCourant, historique }, cout);
    } catch (err) {
      // Journaliser avant de masquer : sinon une panne du Gateway et une faute de programmation rendraient le même
      // message.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        lvl: 'error',
        msg: 'aide_echec',
        tenant,
        err: texteDe(err),
        stack: err instanceof Error ? err.stack : undefined,
      }));
      await solderReservation(deps.budget, tenant, reservation, cout.dollars);
      // 502 gardé : ce corps n'est lu par personne (le panneau `BoutonAide.tsx` affiche son propre texte), et l'échec
      // est bien le nôtre. Le jour où l'écran affichera `error`, ce code passe en 422.
      return reply.code(502).send({ error: 'aide indisponible pour le moment' });
    }
    await solderReservation(deps.budget, tenant, reservation, cout.dollars);
    return reply.code(200).send(r);
  });

  /**
   * Le récap de la veille. Il partage le plafond de débit de la question : calculé une seule fois par espace et par
   * jour (les appels suivants lisent le cache), c'est l'entrée commune vers notre clé qu'il faut borner.
   */
  app.post('/tenants/:tenantId/aide/recap', gardeEtendue(garde, makeRequireRole(ROLES_RECAP)), async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (!limiter.take(tenant)) {
      return reply.code(429).send({ error: 'trop de demandes d’un coup, réessaie dans une minute' });
    }
    const recap = deps.recap;

    // La veille, calculée ici et jamais reçue du client. `todayParis` est le jour civil du fuseau des stats,
    // celui dans lequel le SQL du récap borne ses journées : les deux doivent parler du même jour.
    const jour = addDays((recap.aujourdhui ?? todayParis)(), -1);
    const langue = ((req.body ?? {}) as { langue?: unknown }).langue === 'en' ? 'en' : 'fr';
    const role = req.auth?.role ?? 'agent';
    try {
      const t = await cacheRecap.lire(tenant, jour, langue, () => recap.calculer(tenant, jour, langue));
      // La même forme qu'une réponse d'aide : le fil de la console l'affiche sans chemin de rendu à part.
      return reply.code(200).send({
        sait: true, texte: t.texte, sources: [], ecrans: resoudre(ECRANS_RECAP, role),
      } satisfies ReponseAide);
    } catch (err) {
      // Journaliser avant de masquer, comme la question juste au-dessus.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        lvl: 'error',
        msg: 'aide_recap_echec',
        tenant,
        jour,
        err: texteDe(err),
        stack: err instanceof Error ? err.stack : undefined,
      }));
      // 502 gardé, pour la même raison que la question : l'écran ne lit pas ce corps.
      return reply.code(502).send({ error: 'récap indisponible pour le moment' });
    }
  });

  /**
   * Une fiche citée en source d'une réponse, pour la relire dans le panneau d'aide. Aucun appel payé, donc ni budget
   * ni plafond de cette route : le plafond par utilisateur de la garde suffit. La clé est validée par `lireFicheAide`.
   */
  app.get('/tenants/:tenantId/aide/fiches/:cle', opts, async (req, reply) => {
    espaceVerifie(req);
    const { cle } = req.params as { cle: string };
    const langue = (req.query as { langue?: unknown }).langue === 'en' ? 'en' : 'fr';
    const fiche = await lireFicheAide(cle, langue);
    if (!fiche) return reply.code(404).send({ error: 'fiche introuvable' });
    return reply.code(200).send(fiche);
  });
}
