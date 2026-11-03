/**
 * LE CONSENTEMENT, EN DEUX ADAPTATEURS NOMMÉS (lot 3 du plan 2026-09-14).
 *
 * 🔴 POURQUOI ILS EXISTENT. `estDesabonne` était une dépendance OPTIONNELLE dans les quatre interfaces qui
 * la consomment, « pour les câblages de test ». Absente, la garde ne tournait pas : un câblage qui l'oubliait
 * compilait, se déployait, et écrivait au contact qui avait répondu STOP. C'est arrivé deux fois en
 * 48 heures, les 13 et 14 septembre 2026. Elle est requise depuis ; les tests qui s'en moquent passent
 * `jamaisDesabonne`, ce qui DIT leur hypothèse au lieu de la laisser deviner.
 *
 * ⚠️ `jamaisDesabonne` REPRODUIT EXACTEMENT le comportement d'avant pour une fixture qui omettait la
 * dépendance : la garde ne bloquait rien. Le remplacer par lui ne change donc aucun verdict de test, et c'est
 * la raison pour laquelle ce lot ne modifie aucune assertion existante.
 */
export const jamaisDesabonne = async (): Promise<boolean> => false;

/**
 * Le contact a dit STOP. C'est CELUI-CI qui a une valeur de preuve : un test qui ne se sert que de
 * `jamaisDesabonne` vérifie qu'on n'a pas cassé le cas nominal, jamais que la garde REFUSE vraiment.
 */
export const toujoursDesabonne = async (): Promise<boolean> => true;

/** Aucun contact n'est bloqué : le comportement d'une fixture qui ne parle pas de blocage. */
export const jamaisBloque = async (): Promise<boolean> => false;

/**
 * L'écriture du STOP qui ne touche aucune fiche (`InboundOptOut` rend `null`), pour les fixtures qui ne parlent pas
 * de consentement. Elle est requise dans `processInbound` et `WebhookJobDeps` : un STOP reçu avec ce faux est
 * journalisé « sans fiche contact », jamais écrit. Un test qui VÉRIFIE le refus câble sa propre écriture.
 */
export const aucunStop = async (): Promise<string | null> => null;

/**
 * Le numéro de l'espace n'est jamais bloqué (ni délié, ni suspendu, lot 4) : l'hypothèse des suites qui ne portent pas
 * sur lui, DITE plutôt qu'omise (la dépendance est requise).
 */
export const numeroJamaisBloque = async (): Promise<boolean> => false;

/**
 * Aucun message n'est écrit par une machine d'un autre espace (`src/agent/nos-machines.pg.ts`) : l'hypothèse des suites qui
 * ne portent pas sur la boucle entre deux agents, DITE plutôt qu'omise (la dépendance est requise).
 */
export const jamaisNosMachines = async (): Promise<boolean> => false;

/**
 * L'écriture de l'accord d'une automation attestée (`AutomationRunnerDeps.ecrireAccord`, lot 3b du 2026-11-02) qui ne touche
 * aucune fiche, pour les suites dont aucune automation n'atteste : elle n'y est jamais appelée. L'hypothèse est DITE (la
 * dépendance est requise) ; un test qui VÉRIFIE l'accord câble sa propre écriture.
 */
export const aucunAccordEcrit = async (): Promise<'inconnu'> => 'inconnu';

/**
 * LA GARDE MARKETING D'UN PARCOURS D'AUTOMATION (`WorkflowExecutorDeps.aAccordMarketing`, lot 3b du 2026-11-02), en deux
 * adaptateurs nommés, sur le modèle de `jamaisDesabonne` et `toujoursDesabonne`.
 *
 * `toujoursDAccord` REPRODUIT le comportement d'avant la garde : tout modèle partait, Marketing compris. Le passer ne change
 * aucun verdict, et c'est ce qui permet de rendre la dépendance requise sans toucher une assertion.
 */
export const toujoursDAccord = async (): Promise<boolean> => true;

/** La fiche n'a pas l'accord marketing. C'est CELUI-CI qui prouve que la garde refuse. */
export const jamaisDAccord = async (): Promise<boolean> => false;
