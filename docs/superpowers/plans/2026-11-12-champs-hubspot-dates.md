# Plan : les propriétés HubSpot de type date arrivent en « date et heure » sur la fiche

Date : 2026-11-12. Besoin : MUTAC veut relancer un prospect X heures avant le rendez-vous qu'il a pris par un lien de
réservation HubSpot. Le déclencheur « avant ou après une date » existe (`src/automation/avant-date.ts`), mais il exige un
champ « date et heure » (`src/http/automations.ts`), et toute propriété HubSpot importée est déclarée en texte
(`typeChampHubspot`, `src/hubspot-workflow/champs.ts`). Le type de la propriété est pourtant déjà connu de mba : le
connecteur le rend dans `POST /service/champs` (`proprieteDuPortail.type`, `src/crm/hubspot-service.ts`). Le lot tient
dans ce dépôt, le connecteur `~/mm-hubspot` ne change pas.

## Décisions de Julien (2026-11-12)

1. On passe par le connecteur HubSpot (action de workflow qui apporte les champs choisis), pas par le webhook entrant.
2. Un champ `hs_*` déjà déclaré en texte dont la propriété HubSpot est une date passe en date au prochain
   enregistrement de la liste.
3. Une valeur de date illisible VIDE le champ de la fiche et part au journal : un champ date ne porte qu'une date, et
   aucun rappel ne part sur une date fausse.

## Méthode de livraison

En direct, puis une relecture indépendante du diff : quatre fichiers et leurs tests, réversible par un retour d'image,
critères vérifiables par des tests unitaires ; mais le chemin est emprunté par la production (l'action de workflow et
les événements HubSpot écrivent les fiches), d'où la relecture avant le déploiement. L'essai réel qui clôt le lot :
un vrai rendez-vous pris sur le portail de MUTAC déclenche la relance à l'heure dite (section « Essai réel »).

## Tâches

1. **Le type du champ** (`src/hubspot-workflow/champs.ts`) : `typeChampHubspot(objet, propriete, typeHubspot?)` rend
   `datetime` pour une propriété HubSpot `datetime`, `date` pour `date`, sinon comme aujourd'hui. `ChampLibelle` porte
   le type HubSpot (facultatif : les calculés n'en ont pas).
2. **La déclaration** (`declarerChampsHubspot`) : déclare avec ce type ; un champ `hs_contact_*` ou `hs_deal_*` existant
   en `text` dont le type voulu est `date` ou `datetime` est réécrit avec le nouveau type, libellé gardé (décision 2).
   Jamais l'inverse : un champ que le client a typé lui-même n'est pas touché. À lire avant : ce que fait
   `UserFieldStore.upsert` sur une clé existante.
3. **La route** (`src/http/hubspot-champs.ts`, PUT) : passe le type relu chez le connecteur (`portail.proprietes`) à
   `declarer`, jamais un type pris dans le corps.
4. **L'écriture des valeurs** (`champsDeFiche`) : reçoit les champs déclarés AVEC leur type. Une valeur de date passe par
   `normaliserDate` : lisible, elle est posée en ISO ; illisible, elle est retirée et journalisée (clé et raison, jamais
   la valeur). Les dépendances `champsDeclares` de `hubspot-workflow.ts` et `hubspot-events.ts` rendent `{ key, type }`
   (câblage `src/index.ts`, deux endroits, et `tests/hubspot-workflow-cablage.test.ts`). Celle de
   `src/templates/gestion.ts` ne change pas.

## Rayon de souffle

- `champsDeclares` a trois câblages dans `src/index.ts` : deux changent de forme, celui des modèles non.
- Un champ qui passe de texte à date : ses conditions de scénario et ses filtres CRM changent d'opérateurs. Chercher
  les automations et scénarios qui visent une clé `hs_*` avant de conclure qu'aucun ne compare du texte.
- La remontée (`src/hubspot-workflow/remontee.ts`) écrit dans HubSpot ce qu'un parcours pose sur un `hs_contact_*` : une
  date désormais en ISO, que HubSpot accepte pour une propriété `datetime`. À vérifier dans son test.

## Tests

- `typeChampHubspot` : `datetime`, `date`, `string`, `enumeration`, calculés, type absent.
- `declarerChampsHubspot` : champ neuf typé ; champ `text` existant passé en `datetime` ; champ déjà `datetime` intact ;
  champ `text` d'une propriété `string` intact.
- `champsDeFiche` : ISO avec `Z`, ISO avec millisecondes, horodatage en millisecondes, valeur vide (retirée), valeur
  illisible (retirée et journalisée), propriété `date` reçue en ISO complet.
- La route PUT : le type vient du connecteur, un type dans le corps est refusé par le schéma strict.
- Chaque test de non-régression vérifié dans les deux sens.

## Déploiement

API seule (`deploy-scaleway.yml`, `migration=aucune`) : aucune migration, rien dans `web/`, le connecteur inchangé.
`documentation.md` et `features.md` (section HubSpot, fiche d'aide et empreinte si la section est citée) dans le lot.

## Essai réel

Sur le portail HubSpot de MUTAC, avec le numéro d'essai de Julien :
1. réserver un créneau par le lien de réservation d'un conseiller, puis lire dans HubSpot la propriété du contact
   `engagements_last_meeting_booked` : on vérifie qu'elle porte l'heure du RENDEZ-VOUS, pas celle de la réservation
   (sinon, on cherche la bonne propriété avant d'aller plus loin) ;
2. choisir cette propriété dans Intégrations > HubSpot : le champ de fiche apparaît en « date et heure » ;
3. un workflow HubSpot « réunion réservée » lance l'action « Lancer un scénario » (confirmation) : la fiche porte la date
   en ISO ;
4. une automation « 1 heure avant » sur ce champ, rendez-vous pris à H+2 : le scénario de relance part à H+1 ;
5. déplacer le rendez-vous : le rappel suit la nouvelle date.
