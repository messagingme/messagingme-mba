# Lot 4b de l'aide à la connexion : Claude renvoie vers les pages

**But :** quand une personne hésite ou bloque pendant la connexion de son numéro depuis Claude Code ou Codex, Claude lui
donne la bonne page du centre d'aide (le guide, le dépannage, « Payer Meta », le compte Meta Business, le mode op de son
parcours), dans sa langue, et chaque adresse vient d'une seule source.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Lot 4b : Claude renvoie vers les pages », et le backlog du lot 4a-2 (« Pourquoi un moyen de paiement ? » mène encore à la
fenêtre de 24 heures).

## Méthode de livraison

En direct, une relecture indépendante du diff : peu de fichiers et réversible, mais la consigne de
`start_whatsapp_connection` et `get_setup_state` sont lus à chaque mise en service par Claude, en production, d'où la
relecture. Les critères sont mécaniques : chaque adresse citée est une page de `site/` et figure au plan du site, aucune
n'est tapée à la main dans le plugin ni dans `src/mcp/`, et le lien de la console mène à « Payer Meta ».

**Essai réel :** dans Claude Code, sur un espace de test, au moment de connecter le numéro : « je ne sais pas quoi
répondre » donne le guide, « le code n'arrive pas » donne le dépannage, « pourquoi une carte ? » donne « Payer Meta »,
chacun dans la langue de la personne ; dans la console, « Pourquoi un moyen de paiement ? » ouvre « Payer Meta ».

## Ce qui change

1. **Les adresses, une source** : `web/lib/partage/aide-connexion.ts` reçoit le guide (`AIDE_GUIDE`) et le dépannage
   (`AIDE_DEPANNAGE`) ; `AIDE_POURQUOI_PAIEMENT` mène désormais à « Payer Meta ». `tests/aide-connexion-adresses.test.ts`
   les vérifie toutes (une page de `site/`, au plan du site) et refuse une adresse du centre d'aide tapée à la main dans
   le plugin ou dans `src/mcp/`.
2. **`get_setup_state`** rend `aide` aux deux étapes du numéro (`connecter_numero`, `activer_numero`) : le guide, le
   dépannage, « Payer Meta » et le compte Meta Business, en français et en anglais. Sa description dit quand donner
   chacune.
3. **La consigne de `start_whatsapp_connection`** finit, dans les quatre modes de la fenêtre de Meta, par la page de
   dépannage, à donner si la personne bloque. Le mode op du parcours : A (garder l'application) est déjà cité en
   `coexistence` et `fourni_application` ; C, D et E n'existent pas encore (4c, à réception des rushes), la consigne les
   citera avec leurs pages.
4. **La skill `mise-en-service`** ne tape plus aucune adresse : elle renvoie aux champs `aide` de `get_setup_state` (le
   guide quand la personne hésite, le dépannage quand elle bloque, « Payer Meta » et le compte Meta Business à la
   question 2). Le plugin passe en 0.3.35.
5. **« Pourquoi un moyen de paiement ? »** mène à « Payer Meta » dans la console, `/demarrer/`, le guide et les pages
   Solutions : les deux liens de la carte, dans `tunnel-textes.ts`, lisent la constante partagée. L'e2e `qui-regle-meta`
   suit.

## Ordre de déploiement

1. Le push : la console et la vitrine partent par Vercel (« Payer Meta » est en ligne depuis 4a-2).
2. L'API : `get_setup_state` et la consigne.
3. Le plugin 0.3.35, par Julien, après l'API : la skill lit `aide`, que seule l'API neuve rend.
