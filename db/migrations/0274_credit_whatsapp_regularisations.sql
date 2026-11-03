-- 0274 : la regularisation du Credit WhatsApp sur les volumes de Meta (plan
-- docs/superpowers/plans/2026-11-03-credit-whatsapp-fiabilite.md, lot E ; spec du 2026-10-30, etage 3).
--
-- Une ligne par espace et par jour de Paris : ce que Meta a facture au compte sur les demi-heures couvertes par une ligne
-- (ses volumes chiffres a la grille du jour et a la commission de l'espace), ce que nos provisions ont compte sur ces
-- memes demi-heures, et leur ecart (Meta moins nous). Pour un prepaye, l'ecart est aussi le mouvement `regularisation` du
-- meme jour (le solde suit, dans la meme transaction) ; pour une Entreprise, il va au montant a facturer et aux messages
-- du mois, sans toucher au solde. Recalculee et REMPLACEE tant que le jour est recent, jamais cumulee.
--
-- Le jour d'un mouvement `regularisation` (credit_whatsapp_mouvements.jour) est desormais lui aussi un jour de PARIS,
-- comme l'historique du client : aucune regularisation n'a encore ete ecrite en production (2026-11-03).
--
-- A appliquer AVANT le code : le code neuf ecrit la table. L'ancien code l'ignore (table neuve).
set local lock_timeout = '5s';

create table if not exists credit_whatsapp_regularisations (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  jour             date not null,
  meta_micro_eur   bigint not null check (meta_micro_eur >= 0),
  nous_micro_eur   bigint not null check (nous_micro_eur >= 0),
  ecart_micro_eur  bigint not null,
  -- Une Entreprise : l'ecart va au montant a facturer, le solde ne bouge pas.
  illimite         boolean not null,
  -- Le detail de Meta (numero, pays, categorie, type, palier, volume, montant), les messages des deux cotes, le nombre
  -- de demi-heures comparees.
  detail           jsonb not null default '{}'::jsonb,
  -- L'alerte « envois hors Messaging Me » de ce jour est partie : une fois par espace et par jour.
  alerte_le        timestamptz,
  calcule_le       timestamptz not null default now(),
  primary key (tenant_id, jour)
);
