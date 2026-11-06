# La garde marketing des campagnes à scénario (2026-11-06)

Le trou noté dans `todo.md` (§ « La case d'accord et la garde marketing des automations », lot 3b du 2026-11-02) : une
campagne lancée sur un scénario ne trie ses destinataires que sur la catégorie cochée pour la campagne (`optInAllows` à la
construction). Un modèle Marketing placé plus loin dans le scénario part donc sans l'accord du contact.

## Décision (Julien, 2026-11-05)

La règle la MOINS stricte. L'audience de la campagne ne bouge pas : le tri à la construction reste sur l'ouverture. Seul
un modèle Marketing placé en cours de parcours est vérifié au moment de partir, avec la garde des automations (lot 3b) :
fiche `opted_in`, il part ; sinon il est sauté avec les envois qui le suivent, étiquettes et champs posés.

## Ce que la lecture du code a tranché

1. **Le modèle d'ouverture est EXEMPTÉ, pas seulement « déjà filtré ».** Passer `campagne_scenario` à `accord_fiche` tel
   quel vérifierait aussi l'ouverture. La catégorie d'une campagne est un choix de consentement coché à la main
   (`src/campaign/engine.ts`, « Marketing » par défaut dans l'assistant) : une campagne cochée « Service » qui ouvre sur
   un modèle Marketing chez Meta verrait ses destinataires sans accord refusés au démarrage, marqués `failed`, comptés par
   la porte de qualité (`qualityGate`), qui peut mettre la campagne en pause. C'est réduire l'audience, que Julien refuse.
   D'où une troisième valeur, `accord_fiche_sauf_ouverture` : figée à vrai dans le parcours, mais le PREMIER modèle de la
   liste d'effets du démarrage (un démarrage depuis l'entrée ne contient, sans l'agent de Meta répondeur, qu'un modèle :
   c'est celui que la catégorie de la campagne décrit) part sans la garde. Tout modèle suivant, dans la même liste quand
   l'agent de Meta répond, ou dans une reprise, est vérifié.
2. **Une campagne Marketing ouvrant sur un Marketing** : son ouverture est exemptée, donc la garde n'y change rien au
   démarrage (la liste a été construite sur `opted_in`). Elle ne joue que plus loin dans le parcours, où elle relit la
   fiche en direct : un contact passé hors accord depuis la construction n'y reçoit plus le Marketing suivant. Voulu.
3. **Un parcours de campagne refusé en cours de route se clôt sans passer à l'équipe** (comportement du lot 3b, réveil et
   réponse du contact, `executor.ts`). Gardé : une campagne est un chemin de masse, et des milliers de destinataires
   rempliraient « À traiter » pour un refus qui est une règle, pas une panne. Le message texte du contact part au
   répondeur ; un clic de bouton reste sans suite si l'agent de Meta ne répond pas. Écrit dans la fiche d'aide.
4. **La règle figée voyage déjà** : `runs.start` l'écrit (`workflow_runs.accord_marketing_exige`), le réveil, la réponse,
   le bloc d'un agent et les « Aller à » la relisent (`exigeAccordMarketing` du parcours, départ `saut`). Rien à câbler,
   des tests à poser.
5. **Hors périmètre, noté au todo** : « Message et scénario » (la campagne envoie son modèle, puis démarre le scénario) a
   le même type de lancement, donc le premier modèle du scénario y est exempté alors qu'il n'est pas l'ouverture ; une
   campagne simple (un modèle, sans scénario) cochée Service sur un modèle Marketing part toujours sans accord ;
   `campagne_bloc` (`/v1/sends`) reste `libre`.

## Tâches

1. `src/workflow/lancements.ts` : `marketing: 'libre' | 'accord_fiche' | 'accord_fiche_sauf_ouverture'`,
   `campagne_scenario` sur la troisième ; `accordMarketingExige` rend vrai ; une fonction `ouvertureExemptee(politique,
   depart)` (vraie seulement depuis l'entrée).
2. `src/workflow/executor.ts` : `apply` reçoit la garde en `boolean | 'sauf_ouverture'` ; `demarrer` et `runFrom` la
   passent ; les reprises restent sur le booléen figé.
3. Tests :
   - `tests/workflow-lancements.test.ts` : la table attendue (`campagne_scenario` → `accord_fiche_sauf_ouverture`), le
     modèle d'ouverture part sans accord, la règle figée vraie.
   - `tests/workflow-garde-marketing.test.ts` : campagne « Service, attente, Marketing » au réveil et « Service à bouton,
     Marketing » à la réponse : refusé sans accord, parcours clos `done` sans escalade ; parti avec l'accord ; l'ouverture
     Marketing d'une campagne cochée Service part ; avec l'agent de Meta répondeur, un second modèle Marketing dans la
     liste du démarrage est vérifié.
   - Dans les deux sens : `campagne_scenario` remis à `libre`, les tests de reprise doivent échouer ; l'exemption retirée,
     le test de l'ouverture doit échouer.
4. Doc : `documentation.md` (la garde marketing), `features.md` et sa fiche d'aide des campagnes (empreinte), `todo.md`
   (le point fermé, les restes ci-dessus), le journal.

## Méthode de livraison

Implémenteur (moi, en direct) puis relecture humaine du DIFF par Julien, avec une relecture indépendante par un agent en
fin de lot : c'est un chemin que la production emprunte (chaque campagne à scénario), et le code touché porte un
invariant invisible (la règle figée à la naissance, relue par quatre reprises). L'essai réel qui clôt est décrit plus bas.

## Déploiement

Aucune migration (la colonne existe depuis 0272). Code seul : CI verte lue job par job, puis
`gh workflow run deploy-scaleway.yml --ref main -f migration=aucune` avec l'accord de Julien. Les parcours de campagne
déjà en cours au déploiement ont `accord_marketing_exige = false` et finissent sans la garde (comme pour 0272).

## Essai réel qui clôt

Sur l'espace de test, une campagne à scénario « Service à bouton, puis Marketing » vers deux fiches, l'une `opted_in`,
l'autre sans accord : les deux reçoivent le Service ; au clic, seule la première reçoit le Marketing, et le parcours de la
seconde est clos `done`, sans conversation dans « À traiter ».
