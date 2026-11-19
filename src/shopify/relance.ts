import { journaliser } from '../lib/journal';
import { texteDe } from '../lib/erreur';
import { MAX_OPT_IN_SOURCE } from '../api/contacts-upsert';
import { envoyerPremierBloc, pontSelonLOffre, type DepsEnvoiShopify, type IssueShopify } from './envoi';
import { avecPrenomDeSecours } from './donnees';
import { LIGNE_RELANCE_PANIER } from './attribution';
import { origineShopify, prefixeShopify } from './lignes';
import { donneeManquante, premierBloc, type LecturesPremierBloc, type PremierBloc } from './premier-bloc';
import type { PgShopifyStore } from './store.pg';
import { moisDeParis } from '../offres/compteurs';
import type { SourceOffres } from '../offres/offre.pg';
import type { Emission } from '../emails-produit/emission';
import type { WorkflowExecutor } from '../workflow/executor';

/**
 * LA RELANCE DES PANIERS ABANDONNÉS (plan 2026-10-21, lot 2), un passage du balayage ; depuis le lot 5 du menu
 * « Scénario », le PREMIER BLOC du scénario de la ligne du panier, et le pont du parcours quand ce bloc a une suite.
 *
 * 🔴 DANS L'API, PAS DANS LE WORKER, pour la même raison que le traitement des webhooks : l'envoi public n'existe
 * qu'ici. La minuterie d'une minute de `src/index.ts` le lance à chaque copie ; la réclamation pose `relance_le` dans la
 * même écriture (`reclamerPaniersDus`), donc deux copies ne relancent jamais le même panier.
 *
 * 🔴 UNE SEULE RELANCE, et elle peut se perdre (décision de Julien, plan § lot 2) : un envoi qui échoue APRÈS la
 * réclamation laisse le panier réclamé, avec son issue, et il ne repart pas. Pour un message marketing, une relance
 * manquée vaut mieux qu'une relance en double.
 *
 * Le consentement des clients est la responsabilité du marchand (décision de Julien du 2026-10-26 : aucune affirmation
 * ne lui est demandée) : la fiche naît consentante, avec la source `shopify:<boutique>`, et l'envoi public applique
 * ensuite le STOP (jamais levé par ce consentement), `optInAllows` et les limites de l'offre.
 *
 * 🔴 LE PANIER LE PLUS RÉCENT PREND LA PLACE (décision 33) : avant d'envoyer la relance d'un panier, les parcours des
 * AUTRES paniers de ce contact s'arrêtent, pour que la naissance du sien trouve la place unique libre. Un parcours de
 * commande n'est jamais arrêté par un panier (le préfixe ne nomme que les paniers de la boutique).
 */

export interface DepsRelance extends DepsEnvoiShopify {
  store: Pick<PgShopifyStore, 'reclamerPaniersDus' | 'noterIssuePanier' | 'panierOuvert' | 'compterRelance'>;
  /** Ce que lit le premier bloc d'une ligne (`./premier-bloc.ts`) : les magasins des scénarios et des indices, ENTIERS. */
  lectures: LecturesPremierBloc;
  /** L'offre de l'espace (en cache court) : le pont ne se pose qu'avec la fonction `scenarios`. */
  offres: SourceOffres;
  /** L'exécuteur des parcours, ENTIER (sa méthode lit `this`) : la décision 33. */
  parcours: Pick<WorkflowExecutor, 'arreterParcours'>;
  /** La limite de contacts atteinte prévient les admins, une fois par mois, comme un message de commande (décision 6). */
  emails: { emettre(e: Emission): Promise<unknown> };
  pageOffre: string;
  maintenant?: () => number;
}

/** Les paniers relancés à chaque passage, au plus, par copie de l'API. Le reste attend le passage suivant. */
export const PANIERS_PAR_PASSAGE = 50;

export type IssueRelance = Exclude<IssueShopify, 'en_cours'> | 'donnee_manquante' | 'premier_message_absent' | 'erreur' | 'ferme';

export interface BilanRelance {
  reclames: number;
  issues: Partial<Record<IssueRelance | 'en_cours', number>>;
}

export async function relancerPaniers(deps: DepsRelance, limite = PANIERS_PAR_PASSAGE): Promise<BilanRelance> {
  const paniers = await deps.store.reclamerPaniersDus(limite);
  const bilan: BilanRelance = { reclames: paniers.length, issues: {} };
  // Le premier bloc, lu une fois par espace et par scénario pendant ce passage.
  const blocs = new Map<string, Promise<PremierBloc>>();
  const blocDe = (tenantId: string, workflowId: string): Promise<PremierBloc> => {
    const cle = `${tenantId}:${workflowId}`;
    let lecture = blocs.get(cle);
    if (lecture === undefined) {
      lecture = premierBloc(deps.lectures, tenantId, workflowId, 'shopify');
      blocs.set(cle, lecture);
    }
    return lecture;
  };
  for (const p of paniers) {
    let issue: IssueRelance | 'en_cours';
    try {
      // Relu juste avant l'envoi : une commande a pu fermer le panier depuis sa réclamation (relecture du lot 2).
      if (!(await deps.store.panierOuvert(p.tenantId, p.jeton))) issue = 'ferme';
      else {
        const bloc = await blocDe(p.tenantId, p.workflowId);
        if (bloc.etat !== 'pret') issue = 'premier_message_absent';
        else {
          // Un prénom absent prend son mot de secours (facultatif chez Shopify). Le lien ne manque pas (la réclamation
          // l'exige) ; la garde des données manquantes reste pour un bloc qui en demanderait une autre.
          const valeurs = avecPrenomDeSecours({ ...(p.lien ? { checkout_url: p.lien } : {}), ...(p.nom ? { first_name: p.nom } : {}) }, bloc.langue);
          if (donneeManquante(bloc.params, 'checkout_abandoned', valeurs)) issue = 'donnee_manquante';
          else {
            const origine = origineShopify(p.domaine, 'checkout_abandoned', p.jeton);
            await laisserLaPlace(deps, p.tenantId, p.domaine, p.telephone);
            issue = await envoyerPremierBloc(deps, {
              tenantId: p.tenantId, cle: origine.slice(0, 200), nomLigne: LIGNE_RELANCE_PANIER,
              modele: bloc.modele, langue: bloc.langue, params: bloc.params, valeurs, telephone: p.telephone,
              sourceConsentement: `shopify:${p.domaine}`.slice(0, MAX_OPT_IN_SOURCE),
              parcoursEvenement: await pontSelonLOffre(deps.offres, p.tenantId, bloc, origine, 'evenement_shopify'),
            });
          }
        }
      }
    } catch (err) {
      journaliser('error', 'shopify_relance_en_echec', { tenantId: p.tenantId, erreur: texteDe(err) });
      issue = 'erreur';
    }
    bilan.issues[issue] = (bilan.issues[issue] ?? 0) + 1;
    // `en_cours` : un autre appel tient la même clé d'envoi, il notera l'issue.
    if (issue !== 'en_cours') await deps.store.noterIssuePanier(p.tenantId, p.jeton, issue).catch(() => undefined);
    // Le compte anonyme des relances parties (plan 2026-10-28) : un compteur en panne ne touche ni l'envoi ni son issue.
    if (issue === 'envoye') {
      await deps.store.compterRelance(p.tenantId, new Date((deps.maintenant ?? Date.now)())).catch((err: unknown) => {
        journaliser('error', 'shopify_relance_non_comptee', { tenantId: p.tenantId, erreur: texteDe(err) });
      });
    }
    if (issue === 'limite_contacts') {
      await deps.emails.emettre({
        cle: 'shopify_limite_contacts', tenantId: p.tenantId, a: 'admins',
        occasion: moisDeParis((deps.maintenant ?? Date.now)()), valeurs: { boutique: p.domaine, lien_offre: deps.pageOffre },
      }).catch(() => undefined);
    }
  }
  if (paniers.length === limite) journaliser('info', 'shopify_relance_passage_plein', { reclames: paniers.length });
  return bilan;
}

/**
 * La décision 33 : les parcours des AUTRES paniers de ce contact s'arrêtent avant la relance de celui-ci (le sien n'est
 * pas né). Jamais bloquant : une panne se journalise et la relance part ; sa naissance sera alors refusée (place prise),
 * et le premier message part seul.
 */
async function laisserLaPlace(deps: DepsRelance, tenantId: string, domaine: string, telephone: string): Promise<void> {
  try {
    await deps.parcours.arreterParcours(
      tenantId, { prefixe: prefixeShopify(domaine, 'checkout_abandoned'), waId: telephone.replace(/^\+/, '') }, 'un panier plus récent',
    );
  } catch (err) {
    journaliser('error', 'shopify_arret_parcours_panier_en_echec', { tenantId, erreur: texteDe(err) });
  }
}
