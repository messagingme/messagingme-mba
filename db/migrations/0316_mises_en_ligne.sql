-- 0316_mises_en_ligne.sql : le oui de mise en ligne (lot 1 du CSM virtuel, B2, plan
-- docs/superpowers/plans/2026-11-24-csm-lot1-c-clic-et-versions.md). Le CSM (Claude, par le MCP) prepare une mise en
-- ligne et la montre ; un admin connecte de l espace clique sur un bouton qui en nomme l effet, et ce clic vaut accord.
--
-- Une ligne par mise en ligne :
--   proposee_par, autorisation_id : la personne du jeton OAuth qui l a preparee, et cet acces. Revoque, ou la personne
--     retiree, avant l execution : l execution est bloquee.
--   libelle, recapitulatif : ce que la page montre, ecrits par le serveur a partir des actions (le CSM ne choisit ni le
--     libelle du bouton ni le recapitulatif).
--   actions : la liste ORDONNEE des actions, avec ce qui a ete montre (le graphe d un brouillon, par exemple) : c est lui
--     qui part, pas un brouillon modifie depuis.
--   empreinte : l empreinte de l etat relu en base a la preparation. Le clic la recalcule et refuse si elle a change.
--   etat : proposee, acceptee (le clic a eu lieu, l execution est due), faite, echouee. Une proposition non cliquee
--     expire a expire_le (24 heures) : l etat ne bouge pas, la lecture le dit.
--   acceptee_par, acceptee_le : l admin qui a clique, et quand.
--   execution_jeton, execution_bail : le bail de l execution. Deux executions ne courent jamais ensemble ; une execution
--     coupee se reprend a l echeance du bail, apres le dernier resultat ecrit.
--   resultat : le resultat action par action, ecrit au fur et a mesure.
-- Aucune donnee de contact : des identifiants de scenario et des graphes. Les identifiants de personne n ont pas de cle
--   etrangere, comme workflows.programmed_by : le journal d audit garde l acteur.
-- Lue seulement par le code neuf : migration=avant.
set local lock_timeout = '5s';

create table if not exists mises_en_ligne (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  proposee_par uuid not null,
  autorisation_id uuid,
  libelle text not null constraint mises_en_ligne_libelle_check check (char_length(libelle) between 1 and 80),
  recapitulatif jsonb not null constraint mises_en_ligne_recapitulatif_check check (jsonb_typeof(recapitulatif) = 'array'),
  actions jsonb not null constraint mises_en_ligne_actions_check
    check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 10),
  empreinte text not null,
  etat text not null default 'proposee' constraint mises_en_ligne_etat_check
    check (etat in ('proposee', 'acceptee', 'faite', 'echouee')),
  expire_le timestamptz not null,
  acceptee_par uuid,
  acceptee_le timestamptz,
  execution_jeton uuid,
  execution_bail timestamptz,
  resultat jsonb not null default '[]'::jsonb constraint mises_en_ligne_resultat_check check (jsonb_typeof(resultat) = 'array'),
  terminee_le timestamptz,
  cree_le timestamptz not null default now(),
  constraint mises_en_ligne_clic_check check (etat = 'proposee' or (acceptee_par is not null and acceptee_le is not null))
);

-- L index sert la suppression d un espace (la cascade cherche ses lignes) ; toute autre lecture passe par la cle primaire.
create index if not exists mises_en_ligne_tenant_idx on mises_en_ligne (tenant_id);
