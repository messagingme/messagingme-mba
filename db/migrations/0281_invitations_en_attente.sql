-- 0281 : une invitation ne s'ouvre que par son lien (lot identité C, 2026-11-06).
--
-- invitation_en_attente : vrai pour un compte créé par une invitation (PgUserStore.createPending) tant qu'elle n'est pas
-- acceptée sur sa page. Aucune entrée ne l'ouvre (Google, mot de passe, sélecteur d'espaces, autorisation OAuth) et
-- aucune lecture par identité ne le compte. Tout autre compte (inscription, Google, seed, ancien) garde le défaut, faux :
-- un compte ne devient jamais une invitation parce que sa marque de connexion manque.
-- Reprise : les comptes qui ont reçu un jeton d'invitation (auth_tokens, que rien ne purge hors la cascade d'un compte
-- supprimé), sans connexion ET sans mot de passe sur le compte. La trace de l'invitation est POSITIVE : ni le compte que
-- sème db/seed.ts (son mot de passe est sur l'identité), ni un compte Google dont la marque de connexion a échoué ne
-- sont pris pour une invitation.
--
-- invite_par : le compte qui a invité, que la page d'invitation affiche. Vide pour les invitations d'avant ce lot, et
-- remis à vide si ce compte est supprimé.
--
-- Partie AVANT le code qui les écrit et les lit (migration=avant) : deux colonnes que l'ancien code ignore. Le défaut
-- constant rend l'ajout instantané (métadonnées seules) ; la clé étrangère se vérifie sur une colonne vide d'une petite
-- table. users est lue à chaque requête : au-delà de 5 s d'attente du verrou, la migration échoue et se rejoue
-- (idempotente : if not exists, et la reprise ne touche que les comptes encore à faux).
set local lock_timeout = '5s';

alter table users add column if not exists invitation_en_attente boolean not null default false;
alter table users add column if not exists invite_par uuid references users (id) on delete set null;

update users set invitation_en_attente = true
 where last_login_at is null and password_hash is null and not invitation_en_attente
   and exists (select 1 from auth_tokens a where a.user_id = users.id and a.purpose = 'invite');
