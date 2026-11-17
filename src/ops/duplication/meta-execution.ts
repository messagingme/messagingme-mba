import { randomUUID } from 'node:crypto';
import type { MetaFlowClient } from '../../meta/flows';
import type { TemplateSummary } from '../../meta/templates';
import type { UserFieldDef } from '../../crm/types';
import { creerUnModele, verifierCreationModele, type DepsGestionModeles } from '../../templates/gestion';
import { refusDeMeta, type DepsCreationModele } from '../../api/creer-modele';
import { creerFormulaire, FormulaireDistantNonConfirme, type PersistanceFormulaire } from '../../flow/lifecycle';
import { messageDe } from '../../lib/erreur';
import { avecHandles, versDemandeDeCreation, type CopiesMeta, type FlowSource, type IndicesSource, type MediaARedeposer } from './meta';

/**
 * LA CRÉATION CHEZ META D'UNE DUPLICATION (lot 3, plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-3.md`).
 * « Meta d'abord, tout ou rien » : ceci tourne AVANT la transaction de base, qui ne s'ouvre que si tout est passé.
 *
 * L'ordre, et pourquoi :
 *  1. les champs que nomment les adresses des boutons : la création d'un template les lit (`refusDesChamps`) hors de
 *     toute transaction, donc avant elle ;
 *  2. les Flows, créés (`creerFormulaire`, ligne locale comprise) puis publiés : un bouton Flow n'accepte qu'un Flow
 *     PUBLIÉ de sa WABA ;
 *  3. les templates, par la création même de l'écran Modèles (`creerUnModele`) : liens tracés NEUFS dans la
 *     destination, indications de variables de la source, médias redéposés pour la destination.
 *
 * Au premier refus, on s'arrête : rien n'est supprimé chez Meta (choix de Julien : un nom de template supprimé reste
 * indisponible un mois), et l'issue liste ce qui a déjà été créé. Jamais une exception : un refus inattendu devient un
 * refus lisible, avec ce qui a été créé avant lui.
 */

export interface DepsExecutionMeta {
  /** Les dépendances de l'écran Modèles, le MÊME objet que la console (`src/index.ts`). */
  modeles: DepsGestionModeles;
  /** Le téléchargement gardé et le dépôt d'un en-tête, ceux de la création par l'API et par Claude. */
  medias: Pick<DepsCreationModele, 'telechargerEntete' | 'deposerEntete' | 'placesEntete'>;
  flows: {
    /** Le client de Flows de l'espace, avec son jeton. */
    client(tenantId: string): Promise<Pick<MetaFlowClient, 'create' | 'updateDraft' | 'delete' | 'publish'>>;
    persistance: PersistanceFormulaire;
    marquerPublie(flowId: string, tenantId: string): Promise<boolean>;
  };
  /** La création d'un champ, idempotente : un champ déjà là n'est pas touché. */
  creerChamp(tenantId: string, def: UserFieldDef): Promise<'created' | 'exists'>;
}

export type CreationMeta =
  | { sorte: 'flow'; nom: string; id: string; publie: boolean }
  | { sorte: 'template'; nom: string; langue: string; statut: string; categorie: string };

export interface EntreeMeta {
  copies: CopiesMeta;
  champsAvantMeta: UserFieldDef[];
  modelesSource: readonly TemplateSummary[];
  flowsSource: readonly FlowSource[];
  indicesSource: readonly IndicesSource[];
}

export type IssueMeta =
  | { ok: true; flows: Map<string, { id: string; nom: string }>; crees: CreationMeta[]; champsCrees: string[] }
  | { ok: false; refus: string; crees: CreationMeta[]; champsCrees: string[] };

/** Télécharge un média relu dans la source et le dépose pour la destination, en tenant une place de la copie. */
async function deposer(m: DepsExecutionMeta['medias'], tenant: string, media: MediaARedeposer): Promise<{ handle: string } | { refus: string }> {
  const rendre = m.placesEntete.prendre();
  if (rendre === null) return { refus: 'trop de fichiers en cours de dépôt : réessayez dans un instant' };
  try {
    const fichier = await m.telechargerEntete(media.format, media.url);
    if ('refus' in fichier) return { refus: `son média n’a pas pu être relu (${fichier.refus})` };
    return { handle: await m.deposerEntete(fichier.octets, fichier.mime, tenant) };
  } finally {
    rendre();
  }
}

export async function executerChezMeta(deps: DepsExecutionMeta, destination: string, e: EntreeMeta): Promise<IssueMeta> {
  const crees: CreationMeta[] = [];
  const champsCrees: string[] = [];
  const flows = new Map<string, { id: string; nom: string }>();
  const arret = (refus: string): IssueMeta => ({ ok: false, refus, crees, champsCrees });
  let flowEnCours: string | null = null;
  try {
    for (const def of e.champsAvantMeta) {
      if ((await deps.creerChamp(destination, def)) === 'created') champsCrees.push(def.key);
    }

    if (e.copies.flows.length > 0) {
      const waba = await deps.modeles.repo.getTenantWabaId(destination);
      if (!waba) return arret('l’espace de destination n’a pas de WABA');
      const client = await deps.flows.client(destination);
      for (const c of e.copies.flows) {
        const f = e.flowsSource.find((x) => x.id === c.id);
        if (!f || f.ecrans === null) return arret(`le Flow ${c.nomCopie} ne se lit plus dans la source : relancez l’aperçu`);
        const ref = randomUUID();
        const cta = f.cta ?? undefined;
        flowEnCours = c.nomCopie;
        const { id } = await creerFormulaire(
          { meta: client, local: deps.flows.persistance },
          waba,
          { tenantId: destination, name: c.nomCopie, screens: f.ecrans, ref, mapping: f.mapping, ...(cta ? { cta } : {}), champsAAssurer: c.champsAAssurer },
          { name: c.nomCopie, screens: f.ecrans, ref, ...(cta ? { cta } : {}) },
        );
        flowEnCours = null;
        const cree: CreationMeta = { sorte: 'flow', nom: c.nomCopie, id, publie: false };
        crees.push(cree);
        champsCrees.push(...c.champsAAssurer.map((d) => d.key));
        flows.set(c.id, { id, nom: c.nomCopie });
        if (c.publier) {
          await client.publish(id);
          await deps.flows.marquerPublie(id, destination);
          cree.publie = true;
        }
      }
    }

    for (const c of e.copies.templates) {
      const quoi = `le template ${c.nom} (${c.langue})`;
      const t = e.modelesSource.find((x) => x.name === c.nom && x.language === c.langue);
      if (!t) return arret(`${quoi} ne se lit plus dans la source : relancez l’aperçu`);
      const { input, medias } = versDemandeDeCreation(t, (idSource) => flows.get(idSource)?.id ?? null);
      // Les gardes de la création, avant de télécharger quoi que ce soit (compte, champs des adresses, Flow publié).
      const avant = await verifierCreationModele(deps.modeles, destination, input);
      if (avant) return arret(`${quoi} : ${avant.error}`);
      const handles: Array<{ place: MediaARedeposer['place']; handle: string }> = [];
      for (const m of medias) {
        const depot = await deposer(deps.medias, destination, m);
        if ('refus' in depot) return arret(`${quoi} : ${depot.refus}`);
        handles.push({ place: m.place, handle: depot.handle });
      }
      const indices = e.indicesSource.find((i) => i.nom === c.nom && i.langue === c.langue)?.indices;
      const issue = await creerUnModele(deps.modeles, destination, avecHandles(input, handles), indices);
      if (!('res' in issue)) return arret(`${quoi} : ${issue.error}`);
      crees.push({ sorte: 'template', nom: c.nom, langue: c.langue, statut: issue.res.status, categorie: issue.res.category });
    }
    return { ok: true, flows, crees, champsCrees };
  } catch (err) {
    // Un Flow créé chez Meta dont la ligne locale n'a pas pu s'écrire ni le brouillon s'effacer : il existe chez Meta.
    if (err instanceof FormulaireDistantNonConfirme) crees.push({ sorte: 'flow', nom: flowEnCours ?? '', id: err.flowId, publie: false });
    const refus = refusDeMeta(err);
    return arret(refus ? refus.message : `Meta n’a pas pu aller au bout : ${String(messageDe(err)).slice(0, 300)}`);
  }
}
