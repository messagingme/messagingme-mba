# L'Entreprise illimitée et le suivi des crédits : plan

**Spec :** `docs/superpowers/specs/2026-11-02-entreprise-illimitee-design.md` (décisions de Julien du 2026-11-02).

Trois lots, dans l'ordre. Chacun se ferme par une relecture indépendante, la CI lue job par job et un déploiement
approuvé par Julien. Le lot A débloque l'essai réel 207 du Crédit WhatsApp.

## Lot A : le Crédit WhatsApp illimité en Entreprise

**Fichiers :** `src/credit-whatsapp/conditions.pg.ts` (l'open bar se lit sur l'offre seule) ; `src/http/ops-offre.ts`,
`src/offres/offre.pg.ts`, `web/lib/api/compte.ts`, `web/app/ops/page.tsx` (l'interrupteur disparaît ; la reprise des
campagnes en pause du crédit se joue à l'ENTRÉE en Entreprise ; la sortie d'une Entreprise qui a un numéro sur la ligne
lève une alerte dans la réponse : ses envois s'arrêtent sans crédit) ; une migration (colonne `illimite` sur
`credit_whatsapp_provisions`) ; `src/credit-whatsapp/credit.pg.ts` (une provision illimitée ne touche pas le solde, ni à
la prise, ni au retour, ni à la correction) ; `src/account/numero-delie.pg.ts` (la reprise lit l'offre, plus la
colonne) ; `src/credit-whatsapp/achat-permis.ts` (l'onglet s'ouvre à l'Entreprise sur la ligne, l'achat lui reste
refusé) ; `src/http/credit-whatsapp.ts`, `src/mcp/outils-agent.ts`, `src/mcp/mise-en-service.ts` (la vue dit
`illimite`, aucun avertissement de solde pour l'Entreprise) ; `web/components/OngletCreditWhatsapp.tsx` (« Illimité »,
la consommation du mois, aucun bouton d'achat) ; `features.md` et la fiche d'aide.

**Tests attendus**, vus échouer puis passer :
- une Entreprise est en open bar même colonne à faux ; un Pro, un Business ou une Free jamais, colonne à vrai comprise ;
- en open bar, `provisionner` écrit la provision marquée sans bouger le solde ; `rendre`, `rendreParWamid` et
  `corrigerParWamid` d'une provision illimitée ne le bougent pas, ceux d'une provision prépayée si (intégration) ;
- un espace qui quitte l'Entreprise retrouve son solde d'avant, sans dette ;
- `PUT /ops/offre` refuse `openBarWhatsapp` (schéma strict), et la reprise se joue à l'entrée en Entreprise ;
- `get_setup_state` d'une Entreprise sur la ligne, solde nul : aucun `credit_whatsapp_epuise` ;
- l'onglet d'une Entreprise sur la ligne : « Illimité », aucun bouton d'achat (e2e) ; `ops-offre.spec.ts` sans la case.

**Déploiement :** `migration=avant` (la colonne est écrite par le code neuf). Le changement de règle ne touche personne :
aucun numéro n'est sur la ligne en production.

## Lot B : le Crédit IA illimité en Entreprise, avec son plafond de sécurité

**Fichiers :** créer `src/agent/acces-credit.ts`, le point de passage unique de « cet espace peut-il consommer de l'IA ? »
(`'ok' | 'epuise' | 'plafond'`) : prépayé, un solde positif ; Entreprise, la consommation du mois sous son plafond. Il
remplace les six lectures du solde qui décident : `src/agent/run-turn.ts`, `src/agent/essai.ts`,
`src/repondeur/demarrer.ts`, `src/traduction/traduire.ts`, `src/inbox/transcrire.ts`, et la requête de vectorisation de
`src/agent/knowledge.pg.ts`. Une migration : colonne `illimite` sur `agent_credit_mouvements`, plafond par espace sur
`tenants` (nul = le défaut `ENTREPRISE_PLAFOND_IA_EUROS_MOIS`), marques des alertes du mois. `src/agent/credits.pg.ts` :
un débit illimité écrit sa ligne sans toucher au solde, ligne du jour des traductions comprise.
`src/agent/provisionner-cle.ts` et `src/agent/cles-gateway.pg.ts` : une Entreprise ouvre sa clé sans solde, plafonnée à
un mois de plafond ; une minuterie horaire (`src/worker.ts`, rangée dans `TACHES_PAR_ROLE`) remonte le plafond Vercel des
Entreprises à leur consommation plus un mois. L'achat d'IA refusé en Entreprise (`src/http/credit-stripe.ts`,
`buy_credit`). Les alertes Telegram à 80 % et 100 %. `web/components/OngletCreditIA.tsx` (« Illimité », la consommation
du mois, « plafond de sécurité du mois atteint ») ; `get_credit` ; `get_setup_state` (pas de `credit_epuise` pour une
Entreprise sous son plafond) ; le plafond par espace dans `/ops` ; `features.md` et les fiches d'aide.

**Tests attendus :**
- les six chemins passent par `acces-credit` et s'arrêtent au plafond d'une Entreprise, jamais à son solde ; un
  inventaire dérivé du code refuse une nouvelle lecture du solde qui décide ailleurs ;
- un débit illimité ne bouge pas le solde et la ligne du jour des traductions reste unique (intégration) ;
- la cible du plafond Vercel : pour une Entreprise, sa consommation depuis l'ouverture de la clé plus un mois de
  plafond ; pour un prépayé, inchangée ;
- une Entreprise à solde nul ouvre sa clé ; un achat d'IA en Entreprise est refusé ;
- l'alerte à 80 % puis celle à 100 %, une fois chacune par mois et par espace.

**Déploiement :** `migration=avant`. ⚠️ Ce lot touche l'IA de Groupama PJ dès le déploiement : la relire en base juste
après (sa clé, son solde figé, un tour réel par le vrai code).

**Les jaunes de la relecture du lot A, repris par ce lot** (relecture du 2026-11-02, aucun rouge) :
1. `consommationDuMois` (`src/credit-whatsapp/credit.pg.ts`) compte aussi les provisions prépayées d'un espace passé en
   Entreprise en cours de mois : ne garder que `illimite`, et le test d'intégration attend alors 26 040.
2. Le faux de `tests/credit-whatsapp-garde.test.ts` débite encore le solde en open bar (-74 760) : le faire comme la base
   (provision écrite, solde intact, aucun `surDebit`).
3. Le commentaire de `regulariser` : la règle porte sur chaque provision (`illimite`), jamais sur l'offre de l'espace au
   moment de la passe (un espace sorti de l'Entreprise en cours de mois).
4. L'alerte de `/ops` au retrait de l'Entreprise promet un achat impossible si l'espace retombe en Free : dire alors de
   retirer d'abord le numéro de la ligne.
5. `/ops` ne distingue pas l'illimité : `dernieresProvisions` et `OpsLignesCreditWhatsapp` doivent rendre et montrer
   `illimite` (avant le lot C, aucun écran ne donne le montant à facturer d'une Entreprise).
6. Des commentaires disent encore l'onglet fermé ou l'open bar « posé » : `src/offres/vue.ts`, `src/index.ts` (deux),
   `src/mcp/outils-agent.ts`, `web/lib/offre.ts`, `src/http/ops-offre.ts`, `src/credit-whatsapp/credit.ts` (l'invariant,
   `soldeApresMicroEur`), `src/worker.ts`, `src/socle.ts`, `src/stripe/achat-whatsapp.ts`, `src/credit-whatsapp/garde.ts`.
7. La migration `apres` qui retirera `tenants.entreprise_open_bar_whatsapp` réécrit dans le même commit les trois tests
   d'intégration qui l'écrivent encore (`offres.integration.test.ts`, `numero-delie.integration.test.ts`), sinon 42703.

## Lot C : le suivi

**Fichiers :** les séries de 90 jours en jours de Paris (`src/agent/credits.pg.ts`, `src/credit-whatsapp/credit.pg.ts` :
le solde en fin de jour pour le prépayé, la consommation du jour pour l'illimité), servies par les routes des deux
onglets ; un composant de courbe commun, sur le modèle de `web/components/DailyChart.tsx`, au-dessus de l'historique des
deux onglets ; la vue « Crédits » de `/ops` (`src/ops/store.pg.ts`, `web/app/ops/page.tsx`) : un espace par ligne, le
mois en cours et le précédent, le montant à facturer de l'Entreprise, son plafond IA.

**Tests attendus :** la série reconstruit le solde jour par jour depuis le solde courant (achat, débit, retour) ; un jour
sans mouvement garde le solde de la veille ; la série d'une Entreprise est sa consommation ; le montant à facturer est la
consommation IA plus WhatsApp du mois, au prix client ; e2e des deux onglets et de la vue `/ops`.

**Déploiement :** l'API d'abord, la console seulement après (Vercel la publie au push, ses routes neuves rendraient 404).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la production emprunte ces chemins à chaque tour d'agent et
à chaque envoi, Groupama PJ compris, et qu'ils portent des invariants invisibles : le solde égal aux mouvements moins les
provisions, la cible du plafond Vercel recalculée depuis les mouvements, l'index partiel de la ligne du jour des
traductions. Une relecture indépendante par lot.

**Essai réel qui clôt le chantier :** la SANDBOX (Entreprise), son numéro sur la ligne, envoie à solde nul ; son solde
WhatsApp reste à zéro et son solde IA à 58,55 € pendant que ses agents répondent, et sa consommation apparaît dans ses
onglets et dans `/ops`. « Test DIDWA claude code », passé en Business le temps de l'essai, achète 50 € de Crédit WhatsApp
(mode live), un message le débite au prix de la grille et la courbe descend : l'essai 207 se termine sur lui. Groupama PJ
répond encore le lendemain, solde IA figé, et sa consommation est dans `/ops`.
