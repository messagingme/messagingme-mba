# Lots 3b et 3c de l'aide à la connexion : les offres au premier écran, et Démarrer en Pro

**But :** que la formule se choisisse avant le numéro, partout, avec l'essai Pro bien visible, et que le choix du Pro
sur la vitrine demande par où le piloter. Ordre de Julien (2026-11-10) : 3b et 3c avant l'arbre de 3v, qui attend le
contrat de la session du crédit et la preuve du partenaire.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Ajouts de Julien (2026-11-09) » points 1 et 4, « Décisions de Julien (2026-11-10) » point 4. Décisions du
2026-11-10 pour ce plan : la formule Pro coûte 49 € HT par mois (le 59 € du spec était un lapsus) ; sur le premier
écran, la carte Pro ouvre directement la page de Stripe (mensuel, avec l'essai), puis ramène à la connexion du numéro.

## Méthode de livraison

Implémenteur (cette session) puis une relecture indépendante du diff, parce que le premier écran d'un espace neuf est
le chemin de tout nouveau client, qu'il ouvre un paiement Stripe et que la vitrine et la console doivent dire les
mêmes cartes ; les gardes (parité, arbre, e2e) sont vérifiées dans les deux sens par mutation.

**Essai réel :** sur un espace neuf en Free, le premier écran montre les quatre cartes : Free mène à « Qui paie vos
messages à Meta ? », Pro ouvre Stripe et revient, essai commencé, à la connexion du numéro ; puis sur la vitrine,
Démarrer en Pro : « La console » mène à la création de l'espace, « Claude Code ou Codex » à l'arbre puis aux trois
étapes.

## Ce qui change

1. **Lot 3b, la console** (`/connecter-whatsapp?suite=demarrer`) :
   - un espace en Free, dans le tunnel, sans numéro, voit d'abord « Quelle formule voulez-vous ? » et les quatre cartes
     de la vitrine, aux mêmes mots (`web/lib/questions-numero.ts`, tenu par le test de parité) ;
   - Free : la suite d'aujourd'hui (« Qui paie vos messages à Meta ? », puis le guide), le choix gardé dans l'onglet ;
     Pro : « Essayer 14 jours gratuits » ouvre la page de Stripe (`POST /offre/paiement`, mensuel) ; Business et
     Entreprise : le formulaire de contact de la console (`/support?sujet=business`, `?sujet=entreprise`) ;
   - le retour de Stripe (`/offre?pro=recu` ou `abandon`) ramène au premier écran quand l'onglet est dans le tunnel :
     l'essai commencé se dit, et les cartes ne reviennent pas ; un paiement abandonné les remontre ;
   - l'arrivée d'un espace venu de `?offre=pro` (`/offre?fonction=console`) entre aussi dans le tunnel, pour revenir
     au numéro après Stripe. Aucune route neuve : la console seule change.
2. **La carte Pro de la vitrine dit l'essai aussi visiblement** : la première ligne de la carte, et le bouton.
3. **Lot 3c, la vitrine** (`scripts/vitrine/tunnel-textes.ts`, `tunnel.ts`) :
   - Pro mène à « Console ou Claude Code ? ». « La console » : une issue qui finit sur « Créer mon espace »
     (`/signup?offre=pro`) et le pas-à-pas de la console ; « Claude Code ou Codex » : la suite de l'arbre, et au bout
     les trois étapes en images de la Free, la demande Pro collée à l'étape 3 ;
   - les deux jaunes de `76a0e2b4` : le détour par e-mail a ses captures légendées ; la ligne de Codex dit que
     « non vérifié » est normal.
4. **Les copies** : `features.md`, les fiches qui décrivent l'arrivée et le choix de la formule, le spec (49 €).

## Tests attendus

- **Parité** (`tests/questions-numero-vitrine.test.ts`) : la question de l'offre et ses quatre cartes, au mot près, FR
  et EN.
- **L'arbre** (`tests/vitrine-tunnel.test.ts`) : Pro mène à la question du pilotage ; « La console » à son issue, qui
  finit sur la création de l'espace en Pro ; chaque issue de l'arbre finit, en Pro, sur les trois étapes avec la
  demande Pro ; la profondeur et le chapeau ; la carte Pro et son essai ; les images du détour ; la ligne de Codex.
- **La console** : le retour de Stripe vers le tunnel (unitaire) ; l'e2e du premier écran (Free, Pro vers Stripe,
  Business et Entreprise vers le Support, le retour de Stripe, un espace hors tunnel ou déjà Pro sans les cartes) ;
  les e2e existants qui passent par ce premier écran.

## Ordre de déploiement

Un commit. Vercel publie la console et la vitrine ; aucune route neuve, donc aucun déploiement de l'API. Une fiche
qui change n'entre dans le bot d'aide qu'avec `aide:charger`, par Julien, sur l'image du prochain déploiement de
l'API (`docs/aide` comparé à l'origin avant).
