# La vidéo du numéro fourni, sa page d'aide, et Claude qui la donne

**But.** La vidéo 2 du lot 6 (un numéro fourni par Messaging Me, relié par la fenêtre de Meta, lancé depuis Claude
Code), validée par Julien le 2026-11-13, a sa page d'aide publique en français et en anglais. On la trouve là où l'on
se perd : le guide du numéro, la page de dépannage, la page de connexion de la console, et Claude la donne avec le lien
de connexion d'un numéro fourni. C'est le mode op D de la spec `2026-11-08-aide-connexion-numero-design.md` (lot 4c
pour la page, lot 6 pour la vidéo).

**Hors du lot.** Les modes op B, C et E (vidéo 3 et suivantes) ; la version verticale du film ; le parcours Claude
Desktop.

## Décisions de Julien (2026-11-13)

1. La vidéo vit sur sa page d'aide, en tête, puis chaque étape écrite avec une capture tirée de la vidéo.
2. La page est reliée depuis le guide du numéro (« je n'ai pas de numéro »), la page de dépannage et la page de
   connexion de la console (« Voir la vidéo (3 min) »).
3. Dans le plugin, Claude donne la page avec le lien de connexion d'un numéro fourni ; la FAQ la cite.

## Tâches

1. **Le film** : `site/films/aide-numero-fourni-par-messaging-me.mp4` et `-en.mp4`, leurs affiches `.webp`, une ligne
   dans `FILMS_AIDE` (`scripts/vitrine/aide-films.ts`, durées lues dans les MP4, sans piste son).
2. **La fiche publique** `docs/aide/fiches/numero-fourni-par-messaging-me.md` et sa jumelle `en/`, `video: oui`, les
   étapes de la vidéo avec leurs captures ; la page générée par `npm run vitrine:aide`, le sitemap à jour.
3. **L'adresse partagée** `AIDE_NUMERO_FOURNI` dans `web/lib/partage/aide-connexion.ts`, rendue dans `aide` par
   `get_setup_state` (`src/mcp/mise-en-service.ts`), vérifiée sur le site par `tests/aide-connexion-adresses.test.ts`.
4. **Les liens** : guide du numéro, dépannage, page de connexion de la console (numéro fourni).
5. **Claude** : la consigne de `start_whatsapp_connection` en mode `fourni` dit de donner cette page avant le lien ;
   la skill et la FAQ du plugin la nomment ; plugin 0.3.40.
6. **Le journal** : ce lot et le correctif d'attente `a314d247`.

## Méthode de livraison

**Implémenteur par lot, puis une relecture indépendante et la revue du diff par moi**, parce que le lot touche un
chemin que la production emprunte (la consigne rendue à Claude par l'API) et de nombreux invariants invisibles de la
vitrine : pages générées et tenues par des tests, version anglaise générée, sitemap, empreintes des fiches, adresses
d'aide vérifiées sur le site. Ce n'est pas un feature-loop : le résultat se juge à l'œil (captures, page).

**Ordre** : un seul push. La page et la console sont en ligne au push (Vercel), avant que l'API qui cite la page ne
soit déployée : aucun lien mort. Puis le déploiement de l'API (sans migration), `aide:charger` par Julien, et la
publication du plugin par Julien.

**Essai réel qui clôt le lot** : la page ouverte en production en français et en anglais, la vidéo jouée ; puis, au
tournage de la vidéo 3 ou à la prochaine connexion d'un numéro fourni, Claude écrit l'adresse de la page avec le lien
de connexion.
