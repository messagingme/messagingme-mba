import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import { DROITS_CLE_APPLICATION, VARIABLE_CLE, type ApiScope } from '../../web/lib/partage/droits-api';
import type { OutilMcp } from './outils';
import { RefusOutil, texteObligatoire, valeurOuRefus } from './saisie';
import { LOURDE, ecriture, personneRequise, plafondCouteux, signataire } from './outils-agent';
import { creerCleApi } from '../auth/creer-cle';
import { PRIX_PRO_HT_CENTIMES } from '../offres/offres';
import type { PeriodicitePro, RetourPro } from '../stripe/pro';
import { PLACES_OPTION_MAX, PRIX_OPTION_WA_HT_CENTIMES } from '../stripe/option-credit-whatsapp';
import type { StatutOption } from '../credit-whatsapp/options.pg';
import type { Issue } from '../lib/issue';

/**
 * CE QU'UNE FREE FAIT DEPUIS CLAUDE CODE PLUTÔT QUE DANS LA CONSOLE (spec offres v2, livraison 4) : créer la clé de son
 * application, et payer le Pro. Les MÊMES fonctions que la console (`creerCleApi`, `ouvrirPro`) : l'outil n'y ajoute que
 * la personne (un consentement OAuth, que seul un administrateur donne) et le plafond des opérations lourdes.
 */
export interface DepsOffreMcp {
  /** Le paiement du Pro, la MÊME ouverture que `POST /offre/paiement` (`ouvrirPro`, `src/stripe/pro.ts`). */
  ouvrir(tenantId: string, periodicite: PeriodicitePro, payeur: string, retour: RetourPro): Promise<Issue<{ url: string; portail: boolean; essaiJours?: number }>>;
}

/**
 * Les droits qu'une clé créée par Claude peut porter : une clé à droits LIMITÉS (spec offres v2). Ni le MCP, ni les
 * webhooks, ni la suppression de contacts : ces clés-là se créent dans la console. La lecture des fils et des contacts
 * en fait partie depuis le lot 13 : l'application d'un vibe codeur lit le fil pour répondre.
 * 🔴 Une clé créée ici reste rattachée à l'autorisation de l'application qui l'a demandée (lot D de l'audit, 0282) :
 * un admin qui révoque cette application dans la console révoque la clé avec elle. Les autres fins de l'autorisation
 * (déconnexion par le client, jeton rejoué, fin de vie) la laissent vivre, décision de Julien du 2026-11-06.
 */
const DROITS_PAR_CLAUDE = ['contacts:read', 'contacts:write', 'sends:create', 'conversations:read', 'templates:write'] as const satisfies readonly ApiScope[];

/**
 * La prise de l'option ligne de crédit depuis Claude (`take_credit_line`, plan 2026-11-13) : la MÊME ouverture que l'onglet
 * de la console (`ouvrirOption`, câblée avec l'origine `claude`, retour sur la page publique « paiement reçu »), et l'option
 * vivante de l'espace, pour que Claude sache si elle est payée sans ouvrir un second paiement.
 */
export interface DepsOptionMcp {
  ouvrir(tenantId: string, places: number, payeur: string): Promise<Issue<{ url: string }>>;
  etat(tenantId: string): Promise<{ statut: StatutOption; places: number } | null>;
}

const PERIODICITES: readonly PeriodicitePro[] = ['mois', 'an'];

export const OUTILS_OFFRE: OutilMcp[] = [
  {
    ...ficheOutilMcp('create_api_key'),
    fonction: null,
    description:
      'Creates an API key for the workspace\'s application, the one its code uses to call the API. The key is shown ONCE, '
      + 'in this result, and it passes through this conversation with the assistant: put it at once in the application\'s '
      + `.env file as ${VARIABLE_CLE} (a file git does not track), never in the code, and revoke it in the console (API keys) `
      + `if it leaks. Without scopes, the application key's: ${DROITS_CLE_APPLICATION.join(', ')}. Only limited scopes; a key `
      + 'with MCP, webhook or contact deletion scopes is created in the console. The plan caps active keys '
      + '(the refusal plan_limit_reached says so; revoking one frees a place). The key stays tied to this connection of '
      + 'the assistant: an administrator who revokes this connection in the console (Authorized applications) revokes '
      + 'the key with it, and the application that uses it stops. ' + LOURDE,
    // Une clé de plus à chaque appel ; rien ne sort chez un tiers.
    annotations: ecriture('Create an API key', false, false),
    entree: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100, description: 'A name to recognise the key, e.g. "My application".' },
        scopes: {
          type: 'array', items: { type: 'string', enum: [...DROITS_PAR_CLAUDE] }, minItems: 1,
          description: 'The scopes of the key; omit for the application key\'s.',
        },
      },
      required: ['name'],
    },
    async executer(deps, tenantId, args, personne) {
      const p = personneRequise(personne);
      const nom = texteObligatoire(args, 'name', 100);
      const permis: readonly string[] = DROITS_PAR_CLAUDE;
      if (args.scopes !== undefined && (!Array.isArray(args.scopes) || !args.scopes.every((s) => typeof s === 'string' && permis.includes(s)))) {
        throw new RefusOutil('scopes : une liste de droits, parmi ' + DROITS_PAR_CLAUDE.join(', ')
          + ' ; une clé aux droits plus larges (MCP, webhooks, suppression de contacts) se crée dans la console');
      }
      const scopes = (args.scopes as string[] | undefined) ?? [...DROITS_CLE_APPLICATION];
      await plafondCouteux(deps, tenantId);
      const cle = valeurOuRefus(await creerCleApi(
        deps.cles, tenantId, nom, scopes, { userId: p.userId, email: null }, { via: 'mcp', autorisationId: p.autorisationId },
      ));
      return { ...cle, variable: VARIABLE_CLE, montree_une_fois: true };
    },
  },
  {
    ...ficheOutilMcp('subscribe_pro'),
    fonction: null,
    description:
      'Opens the payment of the Pro plan and returns the URL of the Stripe checkout page; the payment itself is made by the '
      + `person on that page (monthly: €${PRIX_PRO_HT_CENTIMES.mois / 100}, yearly: €${PRIX_PRO_HT_CENTIMES.an / 100}, `
      + 'EXCLUDING TAX, the tax calculated by Stripe from the country and VAT number entered there). The plan switches '
      + 'once Stripe has confirmed it (get_plan). A workspace that never had Pro starts with a 14-day free trial '
      + '(essai_jours): the card is entered on that page, nothing is charged before the trial ends, and the plan switches at '
      + 'once; get_plan then tells when the trial ends. A Business or Entreprise workspace is refused: its plan is set by '
      + 'Messaging Me, not paid online. A workspace already on Pro gets its Stripe portal instead (portail: true); '
      + 'an Entreprise workspace is refused. ' + LOURDE,
    // Monde ouvert : elle crée une session chez Stripe. Non idempotente : une session de plus à chaque appel.
    annotations: ecriture('Open the Pro plan payment', false, true),
    entree: {
      type: 'object',
      properties: { periodicite: { type: 'string', enum: [...PERIODICITES], description: 'mois (monthly) or an (yearly).' } },
      required: ['periodicite'],
    },
    async executer(deps, tenantId, args, personne) {
      const payeur = signataire(personne);
      const periodicite = args.periodicite;
      if (periodicite !== 'mois' && periodicite !== 'an') throw new RefusOutil('periodicite : mois ou an');
      await plafondCouteux(deps, tenantId);
      // Retour sur la page publique « paiement reçu » : la personne de Claude Code n'a pas de session de console.
      const p = valeurOuRefus(await deps.offre.pro.ouvrir(tenantId, periodicite, payeur, 'claude'));
      // Le portail d'un espace déjà Pro n'est pas un paiement : aucun montant que Claude annoncerait « à payer ».
      if (p.portail) return { url: p.url, portail: true };
      return {
        url: p.url,
        periodicite,
        portail: false,
        montant_ht_eur: PRIX_PRO_HT_CENTIMES[periodicite] / 100,
        taxe: 'calculée par Stripe sur la page de paiement, selon le pays et le numéro de TVA saisis',
        // L'essai (spec offres v2) : rien n'est prélevé avant sa fin, la carte est demandée sur la page.
        ...(p.essaiJours ? { essai_jours: p.essaiJours } : {}),
      };
    },
  },
  {
    ...ficheOutilMcp('take_credit_line'),
    fonction: null,
    description:
      'Opens the payment of the Credit line option and returns the URL of the Stripe checkout page; the payment itself is '
      + 'made by the person on that page. With the option, the WhatsApp messages of the workspace numbers are paid by '
      + 'the Messaging Me credit line, prepaid by the person (buy_credit, credit "whatsapp"), with no card at Meta: '
      + `€${PRIX_OPTION_WA_HT_CENTIMES / 100} EXCLUDING TAX per number per month, paid when taken, even during the trial `
      + 'of the Pro plan. It is taken on a Pro workspace (or a confirmed Business): first subscribe_pro, then wait until '
      + 'get_plan shows Pro, then this tool, ALWAYS before start_whatsapp_connection: a number connected with its card at '
      + 'Meta can no longer move onto the credit line (refusal numero_avec_carte; the person writes to Support). Once '
      + 'Stripe has confirmed it, the connection link opens without a card at Meta. A credit line does not pay a number '
      + 'that keeps the WhatsApp Business app. Called again while the option exists, it opens nothing and returns '
      + 'deja_prise with its statut (actif: paid; en_retard: a payment is due) and its places. Refusals keep their code: '
      + 'option_avec_le_pro (not on Pro), option_inutile (Entreprise, already included), option_apres_essai (a Business '
      + 'not confirmed yet), formule_en_retard, option_en_cours (another payment is opening: retry in a few seconds). '
      + LOURDE,
    // Monde ouvert : elle crée une session chez Stripe. Non idempotente : une session de plus à chaque appel.
    annotations: ecriture('Take the credit line option', false, true),
    entree: {
      type: 'object',
      properties: {
        places: {
          type: 'integer', minimum: 1, maximum: PLACES_OPTION_MAX,
          description: `How many numbers the option covers (1 by default; beyond ${PLACES_OPTION_MAX}, contact us).`,
        },
      },
    },
    async executer(deps, tenantId, args, personne) {
      const payeur = signataire(personne);
      const places = args.places ?? 1;
      if (typeof places !== 'number' || !Number.isInteger(places) || places < 1 || places > PLACES_OPTION_MAX) {
        throw new RefusOutil(`places : un entier de 1 à ${PLACES_OPTION_MAX}`);
      }
      await plafondCouteux(deps, tenantId);
      // Déjà prise : son état, jamais un second paiement (la prise le refuserait, sans dire si elle est payée).
      const vivante = await deps.offre.option.etat(tenantId);
      if (vivante !== null) return { deja_prise: true, statut: vivante.statut, places: vivante.places };
      const o = valeurOuRefus(await deps.offre.option.ouvrir(tenantId, places, payeur));
      return {
        url: o.url,
        places,
        montant_ht_eur_par_mois: places * PRIX_OPTION_WA_HT_CENTIMES / 100,
        taxe: 'calculée par Stripe sur la page de paiement, selon le pays et le numéro de TVA saisis',
      };
    },
  },
];

