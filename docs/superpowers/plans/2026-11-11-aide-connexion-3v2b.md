# Lot 3v-2b de l'aide à la connexion : le lien de Claude ouvre la fenêtre du partenaire

**But :** un espace qui a payé l'option Crédit WhatsApp et n'a pas encore de numéro le connecte aussi depuis Claude Code
sans carte chez Meta : `/brancher` ouvre la fenêtre du partenaire, et `start_whatsapp_connection` le dit à Claude, avec
les conditions sans carte (`PREREQUIS_LIGNE`). Avant ce lot, le lien ouvrait la fenêtre de Meta : le numéro s'y
connectait sur la carte, hors de la ligne que l'option a payée. Une fois connecté, Claude ne demande plus la carte chez
Meta à un numéro que le crédit paie.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md)
(lot 3v-2) ; décisions de Julien du 2026-11-10 (le numéro fourni passe aussi par la fenêtre du partenaire, jamais
`fourni_application`) et du 2026-11-11 (un numéro neuf passe en coexistence sans problème).

## Méthode de livraison

Implémenteur par lot et une relecture indépendante du diff, parce que la production emprunte ce chemin (la connexion
d'un numéro payé par l'option) et que le serveur le tient déjà (`solutionDuPartenaire`, rendu au lien par la route de
configuration) : le lot ne change que ce que la page et Claude en font.

**Essai réel :** un espace de test qui a payé l'option, sans numéro ; Claude Code donne le lien en `apporte`, `/brancher`
ouvre la fenêtre du partenaire avec ses conditions sans carte, la ligne se pose à la connexion (V3 de la session du
crédit), et Claude ne demande pas de carte chez Meta.

## Ce qui change

1. **`/brancher` et `ParcoursNumero`** : `parLaLigne="si-ouverte"` ; la configuration du lien rend `solutionId` (l'option
   payée, aucun numéro), et la page ouvre la fenêtre du partenaire en `apporte` (avec le téléphone du numéro,
   `NUMERO_LIGNE_MIEN`) et en `fourni`. En gardant l'application, la fenêtre de Meta, comme avant.
2. **`start_whatsapp_connection`** : lit `fenetrePartenaire` (`solutionDuPartenaire`, câblé dans `src/index.ts`, annoncé
   à la session du crédit) ; la consigne dit la connexion sans carte, ses conditions et le crédit à recharger ; en
   gardant l'application, que le crédit ne paiera pas ce numéro. Le numéro neuf : plus de refus de Meta annoncé.
3. **`watch_whatsapp_connection`** : connecté, la carte chez Meta seulement si elle paie ; sinon le crédit à recharger,
   ou la reconnexion sans carte depuis l'onglet (le numéro de l'essai, l'option prise).
4. **`PREREQUIS_LIGNE` et `NUMERO_LIGNE_MIEN`** passent dans `web/lib/partage/etapes-meta.ts` (ré-exportés), pour que
   le MCP les lise à la même source que la page.
5. **La skill `mise-en-service`** (jaunes 1 et 2 de 3v-2a) : qui prend l'option, l'Entreprise, la raison de l'onglet, la
   Free qui continue ; l'étape 4 suit la `suite` sur qui paie. Plugin 0.3.37.
6. **Les textes** (jaunes 3, 4, 5 et 9 de 3v-2a, 11 de 3v-2c) : l'option se paie dès sa prise, même pendant l'essai ;
   la fiche nomme « Connecter sans carte chez Meta » et la carte « Crédit WhatsApp », et dit la suite ; la doc API de la
   console dit le débit du Crédit WhatsApp.

## Ordre de déploiement

1. Le push : la console (`/brancher`) et la vitrine par Vercel ; la page ouvre la bonne fenêtre dès ce moment.
2. L'API (la consigne, la suite et leur dépendance), sans migration, après la fin du déploiement de la session du crédit.
3. Julien : `aide:charger` avec l'image déployée (les fiches de 3v-2a, 3v-2c et 3v-2b), puis la publication du plugin.
