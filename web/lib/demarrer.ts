/**
 * LA PAGE FINALE DU TUNNEL DE LA BASE (lot 19) : ce qu'on donne à copier à un espace qui vient de naître pour vivre dans
 * Claude Code. Logique pure, tenue par `web/lib/demarrer.test.ts` ; l'écran est `web/app/demarrer/page.tsx`.
 */

/**
 * L'API publique, celle qui sert `/mcp` : la connexion OAuth ne s'annonce que sur l'hôte de `PUBLIC_API_URL`
 * (`src/http/mcp.ts`), jamais sur le domaine de la console. Le serveur du plugin (`plugin/.mcp.json`) et la vitrine la
 * nomment ; `tests/plugin.test.ts` et `tests/vitrine-developpeurs.test.ts` les tiennent égaux à elle.
 */
export const API_PUBLIQUE = 'https://api.messagingme.app';

/**
 * 🔴 LE PLUGIN CLAUDE CODE BRANCHE L'ESPACE (lot 10, livraison B, décision de Julien du 2026-10-12) : deux commandes,
 * sans clé, à la place de `claude mcp add` ; l'autorisation se valide ensuite par `/mcp` (le serveur s'y nomme
 * `SERVEUR_PLUGIN_MCP`), puis `COMMANDE_DEMARRAGE` lance la mise en service, qui lit d'abord où en est l'espace. Le
 * plugin vit dans `plugin/` et se publie dans `messagingme/messagingme-plugin` ; `tests/plugin.test.ts` tient ces
 * noms égaux à ses manifestes. La page finale du tunnel et la vitrine les montrent ; la doc MCP garde `claude mcp add`
 * pour qui ne veut que le serveur.
 *
 * 🔴 LA MARKETPLACE S'AJOUTE PAR L'ADRESSE HTTPS COMPLÈTE DU DÉPÔT (2026-11-11, mesuré sur un PC neuf) : l'adresse courte
 * `messagingme/messagingme-plugin` fait cloner en SSH (`git@github.com:`), qui échoue sans clé GitHub, c'est-à-dire chez
 * presque tout le monde, et laisse une marketplace enregistrée mais vide : le plugin « ne s'installe pas », sans message
 * clair. Claude Code et Codex acceptent tous deux l'adresse HTTPS (mesuré, Codex 0.151).
 */
export const COMMANDES_PLUGIN = [
  '/plugin marketplace add https://github.com/messagingme/messagingme-plugin.git',
  '/plugin install messagingme@messagingme',
] as const;
export const COMMANDE_DEMARRAGE = '/messagingme:demarrer';
export const SERVEUR_PLUGIN_MCP = 'plugin:messagingme:messagingme';
/**
 * LE MÊME PLUGIN DANS CODEX (mesuré le 2026-11-08, Codex CLI 0.151) : Codex lit notre marketplace telle quelle et montre
 * nos skills ; seule l'autorisation diffère, par la commande du serveur que `.mcp.json` nomme. `tests/plugin.test.ts`
 * tient ces commandes égales aux manifestes, comme celles de Claude Code.
 */
export const COMMANDES_CODEX = [
  'codex plugin marketplace add https://github.com/messagingme/messagingme-plugin.git',
  'codex plugin add messagingme@messagingme',
] as const;
export const AUTORISATION_CODEX = 'codex mcp login messagingme';
/** Le dépôt public où le plugin se publie : la vitrine y renvoie (le centre d'aide, le bout du guide du numéro). */
export const DEPOT_PLUGIN = 'https://github.com/messagingme/messagingme-plugin';

/** La variable d'environnement où ranger la clé d'API de l'application : partagée avec le serveur (`create_api_key`). */
export { VARIABLE_CLE } from './partage/droits-api';

/** La valeur de `?suite=` qui fait de `/connecter-whatsapp` une étape du tunnel, et sa clé dans la mémoire de l'onglet. */
export const SUITE_DEMARRER = 'demarrer';
export const CLE_SUITE = 'mba.suite';
/**
 * La formule choisie sur le premier écran (lot 3b), gardée dans l'onglet sous la forme `<espace>:free` ou `<espace>:pro`
 * (le Pro au retour de Stripe) : la question ne revient pas pour CET espace, et revient pour un autre espace neuf.
 */
export const CLE_FORMULE = 'mba.formule';

/**
 * La page du numéro est-elle une étape du tunnel ? Par son adresse, ou par la mémoire de l'onglet : le retour de
 * paiement d'un numéro fourni arrive sur `/connecter-whatsapp?abonnement=recu` (`src/stripe/abonnement.ts`), sans la
 * suite, et l'espace perdrait la page finale. La mémoire ne sert QU'AUX retours de Stripe : celui d'un numéro fourni, ici,
 * et celui du Pro, sur la page de l'offre (`suiteApresPro`, lot 3b) ; un onglet quitté en route, puis la page rouverte
 * depuis l'Accueil, ne doit pas se croire encore dans le tunnel. La page finale l'efface.
 */
export function enSuiteDeDemarrage(recherche: string, memoire: string | null): boolean {
  const p = new URLSearchParams(recherche);
  return p.get('suite') === SUITE_DEMARRER || (p.has('abonnement') && memoire === SUITE_DEMARRER);
}

/**
 * LE RETOUR DE STRIPE D'UN PRO PRIS DANS LE TUNNEL (lot 3b, décision de Julien du 2026-11-10 : « Stripe direct, puis le
 * numéro »). Stripe revient sur `/offre?pro=recu` ou `?pro=abandon` (`src/stripe/abonnement.ts`) ; un onglet dont la
 * mémoire porte la suite (posée par le premier écran, ou par `/offre?suite=demarrer` à l'arrivée d'un espace venu du
 * Pro) repart vers la connexion de son numéro, qui dit l'essai commencé ou le paiement abandonné. Sinon `null` : la
 * page de l'offre reste la page de l'offre.
 */
export function suiteApresPro(recherche: string, memoire: string | null): string | null {
  const pro = new URLSearchParams(recherche).get('pro');
  if (memoire !== SUITE_DEMARRER || (pro !== 'recu' && pro !== 'abandon')) return null;
  return `/connecter-whatsapp?suite=${SUITE_DEMARRER}&pro=${pro}`;
}
