-- 0272_run_accord_marketing_exige.sql : la garde marketing des scenarios lances par une automation (lot 3b du plan
-- mm-hubspot docs/2026-11-02-champs-hubspot-et-accord-plan.md, decision 9 ; cadrage du meme jour, decision A validee
-- par Julien).
--
-- Un parcours ne d une automation (les trois types automatisme_* de src/workflow/lancements.ts) n envoie un modele
-- Marketing qu a une fiche opted_in. La regle se fige a la NAISSANCE du parcours, comme graphe_fige (0151) : l origine
-- n est connue qu au demarrage, et les trois reprises (reveil, reponse du contact, outil d un agent) ainsi que les
-- « Aller a » la relisent ici. Le code la lit « !== false » : un select qui oublierait la colonne fait refuser le
-- Marketing, il ne le laisse pas partir.
--
-- Defaut FAUX, constant : les parcours deja en cours au deploiement n ont jamais ecrit leur origine, ils finissent sans
-- la garde (accepte par Julien ; le releve du 2026-11-02 ne trouve aucun envoi Marketing par scenario sans accord).
-- Aucun index : la colonne se lit par la cle du parcours qu on vient de trouver, jamais dans un where.
--
-- A appliquer AVANT le code : le code neuf l ecrit dans l insert de start et la lit dans les quatre lectures. L ancien
-- code y survit : il ne la nomme pas, et le defaut remplit ses inserts. Ajout avec defaut constant : metadonnee seule
-- (PG 11+), sans reecrire la table. workflow_runs est chaude (chaque message entrant, chaque balayage) : au-dela de 5 s
-- d attente d un verrou, la migration echoue et se rejoue (idempotente).
set local lock_timeout = '5s';

alter table workflow_runs add column if not exists accord_marketing_exige boolean not null default false;
