/**
 * 🔴 « UN PARCOURS TIENT LE FIL » : LA RÈGLE UNIQUE (2026-11-19).
 *
 * Un fil `app_workflow` appartient à un scénario EN COURS, et aucune porte AUTOMATIQUE ne doit le lui retirer : le
 * parcours serait gelé à la réponse suivante du contact ou au réveil de son Attente (`mayAct` faux), sans une ligne au
 * journal des échecs. La règle a d'abord existé en trois copies divergentes (le signal de passation de Meta, le
 * balayage, la remise à l'arrivée d'un message), chacune née d'un défaut mesuré chez MUTAC ou sur la SANDBOX les 18 et
 * 19 novembre, avec ses bornes à elle. Elle vit désormais ici, et `tests/parcours-tient-le-fil-inventaire.test.ts`
 * refuse une porte automatique qui s'en passerait.
 *
 * Un scénario tient le fil d'un contact quand :
 *  - un de ses parcours, dans CET espace, attend ou dort (`waiting`, `sleeping` : le prédicat de l'index partiel
 *    `workflow_runs_actif_idx`, migration 0115, écrit tel quel) et a écrit son état dans le délai
 *    (`DELAI_PARCOURS_TIENT_LE_FIL_MS`, la soupape : un parcours abandonné rend le fil) ;
 *  - OU le scénario ou une campagne lui a écrit il y a moins de `MARGE_DEMARRAGE_PARCOURS`, et le contact n'a pas
 *    répondu depuis. C'est la fenêtre du démarrage : `runFrom` envoie le premier message AVANT d'écrire le parcours
 *    (une ligne pour un envoi que Meta refuserait serait pire), et le message part enregistré dans la conversation avant
 *    que le parcours n'existe. La marge ne compte que les envois du SCÉNARIO et des CAMPAGNES
 *    (`conversation_messages.origin`) : l'écho de l'agent de Meta (« un membre de l'équipe va vous répondre ») est
 *    sortant lui aussi, et le compter avalerait une vraie escalade. 🔴 Et elle se FERME à la première réponse du contact
 *    (relecture du 2026-11-19, démontrée) : un contact qui répond en moins de 2 minutes à une campagne de template SEUL
 *    était ignoré de toutes les portes déclenchées par son message (ni répondeur, ni équipe, ni « devenir Inbox »). Un
 *    parcours qui attend cette réponse est couvert par la première branche ; sans parcours, la réponse doit être
 *    traitée. La réponse est enregistrée (`recordInbound`, heure de la base) avant l'avance et avant la remise.
 *
 * Un message du contact pendant une Attente (parcours `sleeping`) : le scénario garde le fil et repart à son réveil, et
 * personne ne répond d'ici là, ni l'agent de Meta ni l'équipe (décision de Julien du 2026-11-19, préférée à « l'agent
 * répond et le scénario s'arrête »). Une Attente longue doit donc être pensée comme un silence.
 * 🔴 SAUF un parcours d'ÉVÉNEMENT (décision 35, le même jour) : l'exécuteur sert ce message avant la remise
 * (`pendantUneAttente`, `src/workflow/executor.ts`) ; un répondeur qui coexiste répond, sinon le parcours s'arrête et
 * l'agent de Meta ou l'équipe prend le client. Et la réponse de l'application ne lit que les parcours ORDINAIRES
 * (`ordinaires`) : elle coexiste avec un parcours d'événement (décisions 34 et 35).
 *
 * Ce que la règle ne garde PAS, délibérément : les gestes d'un humain (un opérateur qui prend ou rend la main, HubSpot
 * qui ferme le fil), ceux du scénario lui-même (« Assigner à un agent », « Envoyer au MBA », sa fin), et le `standby`
 * de Meta, qui dit une réalité (son agent tient le fil chez lui) au lieu d'en décider une.
 */

/**
 * La soupape : un parcours qui n'a rien écrit depuis ce délai ne tient plus le fil. Fixe, jamais réglable par client
 * (un garde-fou technique). 24 h et pas 2 h : un scénario attend légitimement longtemps (une relance le lendemain).
 * `CONTROL_WORKFLOW_TIMEOUT_MS` (`src/config.ts`), le délai du balayage, EST cette valeur.
 */
export const DELAI_PARCOURS_TIENT_LE_FIL_MS = 24 * 60 * 60 * 1000;

/** La fenêtre du démarrage (voir l'en-tête). Mesurée : de quelques ms à 3 s entre l'envoi et l'écriture du parcours. */
export const MARGE_DEMARRAGE_PARCOURS = '2 minutes';

/** Les origines d'un envoi qui peut précéder l'écriture de son parcours (migration 0099). */
export const ORIGINES_DU_PARCOURS = ['scenario', 'campagne'] as const;

/**
 * Le prédicat SQL (une expression booléenne). `tenant` et `waId` sont des expressions SQL (une colonne de la requête
 * appelante ou un paramètre) ; `delaiMs` aussi, en millisecondes, strictement positif (le balayage passe le sien,
 * qu'il désactive à 0 avant d'arriver ici). Les alias internes (`pr`, `pc`, `pm`) ne heurtent pas ceux de l'appelant.
 * `ordinaires` : les parcours d'événement ne comptent pas (la réponse de l'application, décisions 34 et 35) ; la marge
 * du démarrage, qui ne sait pas quel parcours naît, compte toujours.
 */
export function parcoursTientLeFilSql(o: { tenant: string; waId: string; delaiMs: string; ordinaires?: true }): string {
  const origines = ORIGINES_DU_PARCOURS.map((x) => `'${x}'`).join(', ');
  return `(exists (
             select 1 from workflow_runs pr
              where pr.tenant_id = ${o.tenant} and pr.wa_id = ${o.waId}
                and pr.status in ('waiting', 'sleeping')${o.ordinaires ? ' and pr.evenement is null' : ''}
                and pr.updated_at > now() - make_interval(secs => (${o.delaiMs})::bigint / 1000.0)
           )
           or exists (
             select 1 from conversations pc
               join conversation_messages pm on pm.conversation_id = pc.id
              where pc.tenant_id = ${o.tenant} and pc.wa_id = ${o.waId}
                and pm.direction = 'out' and pm.origin in (${origines})
                and pm.created_at > now() - interval '${MARGE_DEMARRAGE_PARCOURS}'
                and not exists (
                  select 1 from conversation_messages pi
                   where pi.conversation_id = pc.id and pi.direction = 'in' and pi.created_at >= pm.created_at
                )
           ))`;
}
