# Le coût de l'IA, complet, et le coût du MBA (plan du 2026-11-10)

Demande de Julien, 2026-11-10 : dans Performance Lab, « Coût de l'IA » doit sommer les agents IA, les coûts annexes
(essais, connaissance, traduction, transcription) et le coût du MBA ; la carte « Agent de Meta » s'appelle « MBA » et
profite de ce que la doc de Meta a gagné (`docs/MBA-API-REFERENCE.md`, relevé du 2026-11-09).

## Ce qui est vrai aujourd'hui

- **« Coût de l'IA »** (`web/components/CarteCouts.tsx`, ligne 3) lit `consommationIa` (`src/stats/store.pg.ts`) : la
  seule table `agent_sessions`. Les autres débits du crédit n'existent qu'au journal `agent_credit_mouvements` :
  essais du bac à sable (`src/agent/essai.ts`), vectorisation de la connaissance (`src/agent/recherche.ts`),
  transcription d'un vocal (`src/inbox/transcrire.ts`), tous en `raison = 'conso'` sans session et distingués par leur
  seule `note` ; la traduction en `raison = 'traduction'`, une ligne par jour. Les débits d'une Entreprise y sont
  écrits aussi (`illimite`). La ligne exclut le MBA et le dit.
- **La carte « Agent de Meta »** (`web/components/CarteAgentMeta.tsx`) estime le coût : messages écrits par l'agent
  multipliés par `PRIX_MESSAGE_AGENT_USD` (0,04 à 0,05 $, `web/lib/partage/agent-meta.ts`), en dollars, sur 30 jours
  fixes.

## Ce que Meta permet, mesuré le 2026-11-10 sur un espace client

- `GET https://api.facebook.com/{compte}/business_agent_insights` (`X-API-Version: 3.0.0`) rend messages facturés,
  jetons et coût, dans la devise du compte. `{compte}` est l'identifiant du compte de facturation MBA, lu dans le
  Billing Hub (« Comptes », « Comptes Meta Business Agent ») ; aucune route documentée ne le retrouve.
- **Jeton de l'espace** (utilisateur système de l'entreprise du client, créé par l'Embedded Signup) : 401, « This
  resource is restricted to certain users ». Il porte `whatsapp_business_management`, `whatsapp_business_messaging`,
  `whatsapp_business_manage_events`, pas `business_management`.
- **Notre jeton global** (il porte `business_management`) : 403, « The caller is not a system user of the business that
  owns this account ». Il ne lira jamais ce coût.
- Seule voie : accès avancé à `business_management` par la revue d'application de Meta, permission ajoutée à notre
  configuration d'Embedded Signup, puis reconnexion de chaque client (son jeton gagne la permission sans être refait).
- Un agent en audience `ALLOWLISTED_ONLY` tourne sans moyen de paiement ; le compte de facturation MBA existe quand même.

## Lot A : tout le coût de l'IA, et le MBA estimé (sans dépendre de Meta)

1. **Nature d'un débit, sans migration.** Les notes de débit deviennent des constantes d'un seul module
   (`NATURES_CONSO` : agent, essai, connaissance, transcription), passées par chaque appelant de `debiter` ; une fonction
   pure range un mouvement dans sa nature (session présente = agent ; sinon la note ; inconnue = « autre », jamais
   perdue). Un test inventorie les appelants de `debiter` et refuse une note écrite en dur.
2. **`consommationIa` lit le journal**, pas `agent_sessions` : total et ventilation par nature sur la période (débits
   seulement, Entreprise comprise), plus la traduction. Les tours détaillés restent lus dans `agent_sessions`, comme
   aujourd'hui. Le contrat `CoutIa` gagne `parNature` ; le total reste `coutMicroEur`.
3. **Le MBA estimé entre dans la somme**, à part : messages écrits par l'agent sur la PÉRIODE de l'écran (et plus 30
   jours fixes) multipliés par le prix public, convertis par `EUR_PER_USD`, en fourchette. Le total affiché dit
   « dont MBA estimé » ; une valeur estimée ne se mélange jamais sans le dire à une valeur débitée.
4. **L'écran.** « Coût de l'IA » montre le total et ses parts dépliables (agents IA, essais, connaissance, traduction,
   transcription, MBA estimé). La phrase « le Meta Business Agent n'y est pas » disparaît. La carte « Agent de Meta »
   devient « MBA » (sur-titre « Meta Business Agent ») ; son coût suit la même fonction que la ligne.
5. **Contrats et tests attendus** : la fonction de rangement (chaque nature, note inconnue, session présente), le
   total égal à la somme des parts, le MBA estimé hors du total débité, l'inventaire des appelants de `debiter`, un test
   d'intégration sur le journal (Entreprise comprise, recharges exclues), le libellé « MBA » (le vouvoiement et la parité
   des libellés anglais tenus par leurs tests existants).

## Lot B : le vrai coût du MBA (après la permission de Meta)

Prérequis, de Julien : accès avancé à `business_management` accordé, permission ajoutée à l'Embedded Signup, clients
reconnectés.

1. **L'identifiant du compte de facturation MBA par espace** : un champ dans l'onglet « Activation » du MBA, enregistré
   en base (migration, colonne lue par le code neuf : `avant`), vérifié à la saisie par un appel à la route.
2. **Le client** : `usageFacture(compte, debut, fin, granularite)` sur `api.facebook.com`, version 3.0.0, réponse
   validée par Zod (`safeParse`), coût absent = pas de coût (jamais zéro).
3. **Le remplacement** : là où le lot A estime, le coût réel de Meta s'affiche s'il est lisible, converti en euros
   depuis la devise du compte ; sinon l'estimation reste, dite comme telle. Un 401 ou 403 de cette route n'invalide
   jamais le jeton (`MetaAgentApiError`, correctif `64330acc`).
4. **Tests attendus** : lecture et validation de la réponse (coût absent, tableau vide, devise), repli sur l'estimation
   pour chaque refus, aucune invalidation de jeton.

## Ordre de déploiement

Lot A : un seul déploiement, sans migration ; la console et l'API partent ensemble (la route `cout-ia` change de
contrat, la console doit tolérer l'ancien pendant la fenêtre entre le push et le déploiement). Lot B : la migration
d'abord (`avant`), puis l'API, puis la console.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du diff**, pour les deux lots, parce que c'est un chiffre affiché à un
client, que la production emprunte, et que le lot A touche le journal du crédit, qui porte des invariants invisibles
(Entreprise illimitée, ligne de traduction par jour, débits sans session). Une relecture indépendante en fin de lot.
**Essai réel du lot A** : sur l'espace client du 2026-11-09 et l'espace de démo, le total de « Coût de l'IA » d'une période égale la
somme des débits du journal lue en base en lecture seule (commande pour Julien), et la part MBA égale les messages
écrits par l'agent fois le prix public. **Essai réel du lot B** : sur un espace reconnecté, le coût affiché égale celui
du Billing Hub pour le même mois.
