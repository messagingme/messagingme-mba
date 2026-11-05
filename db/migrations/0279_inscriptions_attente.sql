-- 0279 : les demandes d'inscription par e-mail, en attente du clic sur le lien (lot identite B, 2026-11-05).
--
-- Une adresse inconnue qui s'inscrit ne cree plus rien : la demande attend ici, et l'identite, l'espace et la session
-- naissent au clic, l'adresse prouvee. La table ne garde que ce que la personne qui a recu le lien ne choisit pas
-- elle-meme : l'adresse, la langue de l'e-mail, le choix du Pro, si la demande vient d'une application (connexion de
-- Claude Code), et les identifiants publicitaires du formulaire (servis seulement si l'accord est donne au clic).
-- AUCUN secret ni texte libre : ni mot de passe, ni nom d'espace, ni nom, ni accord, qu'un tiers aurait pu saisir.
--
-- jeton_hash : le sha256 du jeton envoye, jamais le jeton. Plusieurs demandes vivantes par adresse (index simple) : la
-- premiere confirmee efface toutes celles de l'adresse, dans la transaction qui cree l'espace. Une demande echue ne
-- confirme plus rien ; la retention generale du worker l'efface.
--
-- Partie AVANT le code qui l'ecrit et la purge qui la nomme (migration=avant, poussee seule) : une table neuve, que
-- l'ancien code ignore, sans cle etrangere vers une table du chemin chaud.

create table if not exists inscriptions_attente (
  id           uuid primary key default gen_random_uuid(),
  jeton_hash   text not null unique check (char_length(jeton_hash) = 64),
  email        text not null check (char_length(email) between 3 and 254),
  langue       text not null default 'fr' check (langue in ('fr', 'en')),
  offre_pro    boolean not null default false,
  application  boolean not null default false,
  pub_fbc      text check (pub_fbc is null or char_length(pub_fbc) between 1 and 500),
  pub_fbp      text check (pub_fbp is null or char_length(pub_fbp) between 1 and 500),
  cree_le      timestamptz not null default now(),
  expire_le    timestamptz not null,
  check (expire_le > cree_le)
);

create index if not exists inscriptions_attente_email_idx on inscriptions_attente (lower(email));
create index if not exists inscriptions_attente_expire_idx on inscriptions_attente (expire_le);
