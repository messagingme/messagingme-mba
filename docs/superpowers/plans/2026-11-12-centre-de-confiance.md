# Le Centre de confiance de la vitrine : plan

Cadrage : `docs/superpowers/specs/2026-11-12-centre-de-confiance-design.md`. Maquette validée par Julien le
2026-11-12.

## Tâches

1. `site/confiance/index.html` : la page principale, sur le gabarit des pages de la vitrine (en-tête et pied par
   `npm run vitrine:entete`, `site.css`, sprite d'icônes, JSON-LD avec fil d'Ariane), schéma SVG animé à cinq étapes,
   styles propres à la page dans `site.css` sous un préfixe `confiance-`.
2. `site/confiance/rgpd/`, `site/confiance/ia/`, `site/confiance/sous-traitants/` : les trois sous-pages.
3. L'entrée « Centre de confiance » dans le menu Ressources (`scripts/vitrine/entete.fr.html` et `.en.html`, bureau et
   téléphone) et le lien du pied (`pied.fr.html`, `pied.en.html`), puis `npm run vitrine:entete`.
4. Les jumelles anglaises : `JUMELLES` (`scripts/vitrine/anglais.ts`), un dictionnaire `anglais/confiance.json`, puis
   `npm run vitrine:anglais`.
5. `site/sitemap.xml` et `site/llms.txt` : les huit pages.
6. Tests : la suite racine entière (les tests de la vitrine lisent `site/`), puis le rendu dans un navigateur, au
   bureau et au téléphone.

## Méthode de livraison

**En direct, par un implémenteur, avec revue humaine du rendu**, parce que la vitrine est isolée et réversible (un
déploiement Vercel par push), sans chemin que la production des clients emprunte, et que le juge est un œil : le
schéma, la mise en page et le ton. Julien voit les pages avant le push (nouveauté publique). Essai réel qui clôt la
feature : les huit pages ouvertes sur app.messagingme.fr après le déploiement, le menu Ressources et le pied qui y
mènent, le schéma qui défile au bureau et au téléphone.

## Déploiement

Push sur `main` : Vercel publie la vitrine (Ignored Build Step sur `site/`). La CI racine tourne (`site/**` n'est pas
ignoré). Aucune API ni migration.
