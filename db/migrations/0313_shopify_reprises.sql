-- 0313_shopify_reprises.sql : les reprises de l historique Shopify (segments Shopify enrichis, lot 5, plan
-- docs/superpowers/plans/2026-11-23-segments-shopify-lot-5-rattrapage.md). Une ligne par rattrapage lance : il relit les
-- commandes payees des 60 derniers jours et les rattache aux fiches deja la, lignes de produits comprises.
--
-- shopify_reprises : l espace, le genre (commandes ; fiches_acheteurs viendra avec le lot 7), la boutique lue (son
--   domaine : une reprise ne continue jamais sur une autre boutique), le statut, le debut de la fenetre lue, le
--   curseur de la page suivante (la reprise reprend la ou elle s est arretee), les comptes du bilan, l erreur, qui l a
--   lancee, et le bail du worker qui la tient (bail_jusqua, jeton de garde). AUCUNE donnee de personne : ni telephone,
--   ni nom, ni commande ; des comptes seulement.
-- L index unique partiel tient « une reprise vivante par espace et par genre » : un second lancement echoue sur lui
--   tant que la premiere vit. Une reprise dont le bail est mort depuis longtemps est close au lancement suivant.
--
-- NON BLOQUANTE : une table neuve, que seul le code neuf lit ; la purge d une fiche ne la nomme pas. Appliquee avant le
-- code (migration=avant), l ancien code l ignore.
set local lock_timeout = '5s';

create table if not exists shopify_reprises (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  genre text not null constraint shopify_reprises_genre_check check (genre in ('commandes', 'fiches_acheteurs')),
  domaine text not null constraint shopify_reprises_domaine_check check (char_length(domaine) between 1 and 255),
  statut text not null default 'en_attente'
    constraint shopify_reprises_statut_check check (statut in ('en_attente', 'en_cours', 'termine', 'refuse', 'erreur')),
  fenetre_debut timestamptz not null,
  curseur text constraint shopify_reprises_curseur_check check (char_length(curseur) between 1 and 1000),
  lues integer not null default 0 constraint shopify_reprises_lues_check check (lues >= 0),
  rattachees integer not null default 0 constraint shopify_reprises_rattachees_check check (rattachees >= 0),
  deja integer not null default 0 constraint shopify_reprises_deja_check check (deja >= 0),
  sans_fiche integer not null default 0 constraint shopify_reprises_sans_fiche_check check (sans_fiche >= 0),
  sans_numero integer not null default 0 constraint shopify_reprises_sans_numero_check check (sans_numero >= 0),
  erreur text constraint shopify_reprises_erreur_check check (char_length(erreur) between 1 and 500),
  par text constraint shopify_reprises_par_check check (char_length(par) between 1 and 200),
  commence_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  fini_le timestamptz,
  bail_jusqua timestamptz,
  jeton uuid
);

create unique index if not exists shopify_reprises_vivante
  on shopify_reprises (tenant_id, genre) where statut in ('en_attente', 'en_cours');

create index if not exists shopify_reprises_derniere
  on shopify_reprises (tenant_id, genre, commence_le desc);
