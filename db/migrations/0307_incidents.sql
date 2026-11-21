-- 0307_incidents.sql : les incidents de sante, chacun avec l instantane pris au moment de l alerte (Julien, 2026-11-21,
-- plan docs/superpowers/plans/2026-11-21-incidents-sante.md, lot 1).
--
-- Une ligne par alerte de sante (veille de l API) ou de charge (veille du worker) :
--   source       'sante' ou 'charge'
--   signal       la brique ('entrants', 'base'...) ou la cle de la veille ('veille:file:push-analysis'...)
--   etat         'orange', 'rouge', ou 'alerte' pour la veille de charge (elle n a pas de niveaux)
--   texte        le message parti sur Telegram, mot pour mot
--   instantane   l etat du systeme pris juste apres l alerte (files, jobs lents, base, pool) ; borne en taille par le
--                code (65 536 caracteres, la limite du declencheur de la tache cloud qui l analyse)
--   clos_le / instantane_fin   au retour au vert (veille de sante seulement)
--   issue, decision, decide_le  rempli par l analyse et la decision de Julien (lots 2 a 4)
-- Aucune donnee personnelle : des noms de files, des durees, des comptes. Aucun texte de requete SQL.
--
-- A appliquer AVANT le code : le code neuf y ecrit a chaque alerte. Une table neuve, vide : aucun verrou sur une table
-- chaude. L ancien code ne la nomme pas.
set local lock_timeout = '5s';

create table if not exists incidents (
  id              bigserial primary key,
  source          text not null check (source in ('sante', 'charge')),
  signal          text not null check (char_length(signal) between 1 and 200),
  etat            text not null check (etat in ('orange', 'rouge', 'alerte')),
  texte           text not null check (char_length(texte) between 1 and 2000),
  ouvert_le       timestamptz not null default now(),
  instantane      jsonb,
  clos_le         timestamptz,
  instantane_fin  jsonb,
  issue           smallint check (issue between 1 and 4),
  decision        text check (decision in ('approuve', 'refuse', 'plus_tard')),
  decide_le       timestamptz
);

-- Le retour au vert clot le dernier incident ouvert de son signal : la requete `where signal = $1 and clos_le is null`.
create index if not exists incidents_ouverts_idx on incidents (signal, ouvert_le desc) where clos_le is null;
