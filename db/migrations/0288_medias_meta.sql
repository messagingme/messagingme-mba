-- 0288_medias_meta.sql : la mémoire des fichiers déposés chez Meta (plan
-- docs/superpowers/plans/2026-11-10-memoire-des-medias-meta.md, demandé par Julien le 2026-11-10).
--
-- Avant d'envoyer une image, une vidéo ou un document, le worker lit le fichier (le bucket de la médiathèque : 1,1 à 7,7 s
-- mesurés) puis le dépose chez Meta, qui rend un `media id`. Cet identifiant n'était gardé que dans la mémoire du
-- processus, perdue à chaque déploiement. Une ligne par fichier déposé, par espace, numéro, fournisseur et usage : un
-- identifiant ne vaut que pour le numéro qui l'a déposé. L'adresse ne se garde pas, seulement son empreinte (sha256) ;
-- `code_mediatheque` sert à l'oublier quand le fichier est supprimé de la médiathèque.
--
-- Aucune donnée personnelle : des identifiants, un nom de document, des dates. La suppression d'un espace l'emporte par
-- la cascade (la purge n'a pas à nommer cette table). Table neuve, aucun code existant ne la lit : AVANT le code
-- (`migration=avant`). ⚠️ La clé étrangère prend un verrou SHARE ROW EXCLUSIVE sur `tenants` le temps de l'instruction
-- (les écritures sur `tenants` attendent) : le `lock_timeout` borne l'attente, et une migration refusée se rejoue. Le
-- code la lit en échouant ouvert : sans elle, il dépose comme avant.
set local lock_timeout = '5s';

create table if not exists medias_meta (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  numero            text not null,
  fournisseur       text not null,
  usage             text not null check (usage in ('visuel', 'fichier')),
  empreinte         text not null,
  code_mediatheque  text,
  media_id          text not null,
  type              text check (type in ('image', 'video', 'document')),
  nom               text,
  televerse_le      timestamptz not null default now(),
  primary key (tenant_id, numero, fournisseur, usage, empreinte)
);

-- L'oubli à la suppression d'un fichier de la médiathèque, par (espace, code).
create index if not exists medias_meta_code_idx
  on medias_meta (tenant_id, code_mediatheque) where code_mediatheque is not null;
