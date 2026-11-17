import type { CarouselCard, CreateTemplateInput, TemplateButton, TemplateSummary } from '../../meta/templates';
import type { FlowScreenDef } from '../../meta/flow-json';
import type { UserFieldDef } from '../../crm/types';
import type { ParamSource } from '../../crm/template';
import { isSystemFieldKey } from '../../crm/fields';
import { codeDuLienTrace } from '../../links/rewrite';
import { analyserChampsUrl } from '../../../web/lib/partage/champs-url';
import { nomLibre } from './nommage';

/**
 * LES TEMPLATES ET LES FLOWS D'UN SCÉNARIO DUPLIQUÉ (lot 3, plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-3.md` ;
 * décisions de Julien du 2026-11-17). Pur : aucune IO.
 *
 * Un template que le scénario envoie est RÉUTILISÉ s'il existe déjà dans la WABA de destination (même nom, même
 * langue), À RECRÉER s'il en est absent et qu'on sait le regénérer à l'identique (une case, décochée par défaut), NON
 * RECRÉABLE sinon (pas de case, sa raison est dite). Décoché ou non recréable, le bloc qui l'envoie arrive DÉBRANCHÉ : un
 * template absent ne bloque plus la duplication. Un Flow que le scénario ouvre (bloc Flow, ou bouton Flow d'un template)
 * a sa case, et un template coché emporte le Flow de son bouton.
 */

/** Un template d'une WABA, réduit à ce que le plan compare (lot 1). */
export interface TemplateDeLaWaba { nom: string; langue: string; statut: string; boutons: Array<{ type: string; texte: string }> }

/** Un Flow de la source que le scénario ouvre, lu dans sa base (`flows`). */
export interface FlowSource {
  id: string;
  nom: string;
  publie: boolean;
  /** `null` : un ancien Flow simple, sans écrans, qui ne se recrée pas (comme sa duplication dans un même espace). */
  ecrans: FlowScreenDef[] | null;
  /** Clé du champ du Flow vers la clé du champ du contact. */
  mapping: Record<string, string>;
  cta: string | null;
}

/** Les indications de variables d'un template de la source (`template_param_hints`), recopiées avec lui. */
export interface IndicesSource { nom: string; langue: string; indices: Array<{ position: number; source: ParamSource }> }

/**
 * Pourquoi un template absent de la destination ne se recrée pas : la source illisible, le template introuvable dans
 * la source, une catégorie, un en-tête ou des boutons que la création ne sait pas soumettre, un média sans adresse, un
 * lien tracé de la source resté dans un bouton, un Flow qui ne se recrée pas.
 */
export type RaisonNonRecreable = 'lecture' | 'introuvable' | 'categorie' | 'boutons' | 'entete' | 'media' | 'liens' | 'flow';

export interface BlocDuGraphe { nodeId: string; nom: string }

export interface ApercuTemplate {
  nom: string;
  langue: string;
  etat: 'reutilise' | 'a_recreer' | 'non_recreable';
  /** Le statut chez Meta : celui de la destination pour un template réutilisé, celui de la source sinon. */
  statut: string | null;
  raison: RaisonNonRecreable | null;
  /** Les Flows (ids de la source) qu'ouvrent ses boutons : ils partent avec le template coché. */
  flows: string[];
  /** Les clés de champ que sa copie fera créer (adresses de boutons, indications de variables). */
  champs: string[];
  /** Les blocs qui l'envoient : débranchés si le template n'est ni réutilisé ni coché. */
  blocs: BlocDuGraphe[];
}

export interface ApercuFlow {
  id: string;
  nom: string;
  nomCopie: string;
  publie: boolean;
  /** Sans écrans, ou inconnu de la base de la source, il ne se recrée pas : pas de case, ses blocs arrivent débranchés. */
  recreable: boolean;
  champs: string[];
  blocs: BlocDuGraphe[];
}

export interface ApercuMeta { templates: ApercuTemplate[]; flows: ApercuFlow[] }

export interface ChoixMeta { templates: Array<{ nom: string; langue: string }>; flows: string[] }

export interface CopiesMeta {
  /** Les Flows à recréer, à créer AVANT les templates dont un bouton les ouvre. */
  flows: Array<{ id: string; nomCopie: string; publier: boolean; champsAAssurer: UserFieldDef[] }>;
  templates: Array<{ nom: string; langue: string; flows: string[] }>;
}

export interface EtatMeta {
  /** Les templates que le graphe envoie, une fois chacun, avec les blocs qui les envoient. */
  templates: Array<{ nom: string; langue: string; blocs: BlocDuGraphe[] }>;
  /** Les blocs Flow du graphe, avec l'id (dans la source) du Flow qu'ils ouvrent et le nom qu'ils en gardent. */
  blocsFlow: Array<BlocDuGraphe & { flowId: string; flowNom: string }>;
  /** Ceux de la WABA de destination ; `null` = l'espace n'a pas de WABA (la duplication est alors bloquée, ailleurs). */
  destination: TemplateDeLaWaba[] | null;
  /** Ceux de la WABA source, lus en entier ; `null` = illisibles. */
  source: TemplateSummary[] | null;
  flowsSource: FlowSource[];
  indicesSource: IndicesSource[];
  nomsFlowsPris: string[];
  champsSource: UserFieldDef[];
  champsDestination: UserFieldDef[];
}

export interface PlanMeta {
  apercu: ApercuMeta;
  copies: CopiesMeta;
  /** Les cases qui ne désignent rien de recréable (un template réutilisé, un Flow d'ailleurs) : la route refuse (400). */
  choixInvalides: string[];
  /** Les blocs template qui arrivent débranchés : leur template n'est ni réutilisé ni coché. */
  templatesADebrancher: string[];
  /** Les clés de champ que nomment les copies cochées. */
  clesDeChamp: string[];
  /** Les champs à créer AVANT la soumission : la création d'un template lit hors de toute transaction ceux de ses adresses. */
  champsAvantMeta: UserFieldDef[];
  /** Plus de `PLAFOND_META` objets cochés à recréer. */
  depasse: boolean;
}

/** Au plus 10 objets recréés chez Meta par duplication : chacun coûte quelques secondes, et Cloudflare coupe à 100 s. */
export const PLAFOND_META = 10;

const AUCUNE_COPIE: CopiesMeta = { flows: [], templates: [] };
const cle = (nom: string, langue: string): string => `${nom}\u0000${langue}`;
const CATEGORIES = new Set(['MARKETING', 'UTILITY']);
const ENTETES_MEDIA = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

/** Les Flows qu'ouvrent les boutons de premier niveau d'un template. */
export function flowsDesBoutons(t: TemplateSummary): string[] {
  return (t.buttons ?? []).flatMap((b) => (b.type === 'FLOW' && b.flowId ? [b.flowId] : []));
}

/** Les adresses des boutons « Lien » d'un template, cartes de carrousel comprises. */
const adresses = (t: TemplateSummary): string[] => [
  ...(t.buttons ?? []).flatMap((b) => (b.type === 'URL' ? [b.url ?? ''] : [])),
  ...(t.carousel?.cards ?? []).flatMap((c) => (c.buttons ?? []).flatMap((b) => (b.type === 'URL' ? [b.url ?? ''] : []))),
];

/** Les clés de champ que portent les adresses de ses boutons (`{numero_commande}`). */
export function champsDesAdresses(t: TemplateSummary): string[] {
  return adresses(t).flatMap((u) => {
    const a = analyserChampsUrl(u);
    return a.ok ? a.cles : [];
  });
}

/**
 * Pourquoi un template absent de la destination ne se recrée pas à l'identique, ou `null` : ce que la création de
 * l'écran Modèles (`creerUnModele`) ne sait pas soumettre, ou ce que la lecture chez Meta ne rend pas tel quel.
 * 🔴 Un bouton qui porte encore NOTRE lien de redirection (la lecture des liens tracés de la source a échoué, et
 * `listerModeles` l'a laissé) ne se recopie jamais : ses clics seraient comptés chez la source.
 */
export function pourquoiNonRecreable(t: TemplateSummary | undefined, flows: ReadonlyMap<string, FlowSource>): RaisonNonRecreable | null {
  if (!t) return 'introuvable';
  if (!CATEGORIES.has(t.category.toUpperCase())) return 'categorie';
  if (t.boutonsNonRelus) return 'boutons';
  if (t.headerFormat !== null && t.headerFormat !== 'TEXT' && !ENTETES_MEDIA.has(t.headerFormat)) return 'entete';
  if (t.headerFormat !== null && ENTETES_MEDIA.has(t.headerFormat) && !t.headerMediaUrl) return 'media';
  if (t.isCarousel) {
    const cartes = t.carousel?.cards ?? [];
    if (cartes.length === 0 || cartes.some((c) => !c.mediaUrl || !c.mediaFormat)) return 'media';
    if (cartes.some((c) => (c.buttons ?? []).some((b) => b.type === 'FLOW'))) return 'boutons';
  }
  if (adresses(t).some((u) => codeDuLienTrace(u) !== null)) return 'liens';
  for (const b of t.buttons ?? []) {
    if (b.type !== 'FLOW') continue;
    const f = flows.get(b.flowId ?? '');
    if (!f || f.ecrans === null) return 'flow';
  }
  return null;
}

/** Un média à redéposer pour la destination : l'en-tête, ou l'image de la carte `place` d'un carrousel. */
export interface MediaARedeposer { place: 'entete' | number; url: string; format: 'IMAGE' | 'VIDEO' | 'DOCUMENT' }

/**
 * La demande de création, pour la destination, d'un template lu dans la source. `flowCopie` donne l'id dans la
 * destination du Flow qu'ouvre un bouton. Les médias restent à redéposer : leurs places portent un handle vide, que
 * `avecHandles` remplit. Lu par `listerModeles` (`templates/gestion.ts`), un bouton « Lien » porte l'adresse d'origine :
 * `creerUnModele` lui allouera un lien tracé neuf, DANS la destination. Un en-tête texte à variable reprend l'exemple
 * générique de `buildComponents`, la lecture ne rendant pas celui de la source.
 */
export function versDemandeDeCreation(
  t: TemplateSummary,
  flowCopie: (idSource: string) => string | null,
): { input: CreateTemplateInput; medias: MediaARedeposer[] } {
  const medias: MediaARedeposer[] = [];
  const bouton = (b: { type: string; text?: string; url?: string; flowId?: string }): TemplateButton => {
    if (b.type === 'URL') return { type: 'URL', text: b.text ?? '', url: b.url ?? '' };
    if (b.type === 'FLOW') return { type: 'FLOW', text: b.text ?? '', flowId: flowCopie(b.flowId ?? '') ?? '' };
    return { type: 'QUICK_REPLY', text: b.text ?? '' };
  };
  let header: CreateTemplateInput['header'];
  if (t.headerFormat === 'TEXT') header = { format: 'TEXT', text: t.headerText ?? '' };
  else if (t.headerFormat === 'IMAGE' || t.headerFormat === 'VIDEO' || t.headerFormat === 'DOCUMENT') {
    header = { format: t.headerFormat, handle: '' };
    medias.push({ place: 'entete', url: t.headerMediaUrl ?? '', format: t.headerFormat });
  }
  const carousel = t.isCarousel && t.carousel
    ? {
      cards: t.carousel.cards.map((c, i): CarouselCard => {
        medias.push({ place: i, url: c.mediaUrl ?? '', format: c.mediaFormat ?? 'IMAGE' });
        return { headerHandle: '', ...(c.body ? { body: c.body } : {}), ...(c.buttons?.length ? { buttons: c.buttons.map(bouton) } : {}) };
      }),
    }
    : undefined;
  const input: CreateTemplateInput = {
    name: t.name,
    category: t.category.toUpperCase() as CreateTemplateInput['category'],
    language: t.language,
    body: t.body,
    ...(header ? { header } : {}),
    ...(t.example?.length ? { example: t.example } : {}),
    ...(t.footer ? { footer: t.footer } : {}),
    ...(!carousel && t.buttons?.length ? { buttons: t.buttons.map(bouton) } : {}),
    ...(carousel ? { carousel } : {}),
    ...(t.ttlSecondes !== undefined ? { ttlSecondes: t.ttlSecondes } : {}),
  };
  return { input, medias };
}

/** Pose les handles des médias redéposés à leurs places. Pur : la demande d'origine n'est pas modifiée. */
export function avecHandles(input: CreateTemplateInput, handles: ReadonlyArray<{ place: 'entete' | number; handle: string }>): CreateTemplateInput {
  let sortie = input;
  for (const { place, handle } of handles) {
    if (place === 'entete' && sortie.header && sortie.header.format !== 'TEXT') sortie = { ...sortie, header: { ...sortie.header, handle } };
    else if (typeof place === 'number' && sortie.carousel) {
      sortie = { ...sortie, carousel: { cards: sortie.carousel.cards.map((c, i) => (i === place ? { ...c, headerHandle: handle } : c)) } };
    }
  }
  return sortie;
}

/**
 * Ce qui, d'un template de la source, entre dans l'empreinte : son contenu, jamais l'adresse de ses médias, que Meta
 * signe à chaque lecture (l'empreinte changerait d'un appel à l'autre, et chaque duplication finirait en 409).
 */
export function signatureModele(t: TemplateSummary): unknown {
  return {
    nom: t.name, langue: t.language, statut: t.status, categorie: t.category, corps: t.body,
    entete: t.headerFormat, texteEntete: t.headerText ?? null, media: Boolean(t.headerMediaUrl),
    pied: t.footer ?? null, boutons: t.buttons ?? [], nonRelus: t.boutonsNonRelus ?? false, exemples: t.example ?? [],
    cartes: (t.carousel?.cards ?? []).map((c) => ({ corps: c.body ?? null, format: c.mediaFormat ?? null, media: Boolean(c.mediaUrl), boutons: c.buttons ?? [] })),
    duree: t.ttlSecondes ?? null,
  };
}

/** Le plan des templates et des Flows : l'aperçu, et, avec `choix`, ce qui se recrée chez Meta. */
export function planifierMeta(e: EtatMeta, choix?: ChoixMeta): PlanMeta {
  const flowsParId = new Map(e.flowsSource.map((f) => [f.id, f]));
  const sources = new Map((e.source ?? []).map((t) => [cle(t.name, t.language), t]));
  const champsSource = new Map(e.champsSource.map((c) => [c.key, c]));
  const champsDestination = new Set(e.champsDestination.map((c) => c.key));
  const utiles = (cles: string[]): string[] => [...new Set(cles.filter((c) => c !== '' && !isSystemFieldKey(c)))];
  /** Les définitions, prises dans la source, des clés absentes de la destination. */
  const absents = (cles: string[]): UserFieldDef[] => utiles(cles).flatMap((k) => {
    const s = champsSource.get(k);
    return s && !champsDestination.has(k) ? [{ key: s.key, label: s.label, type: s.type }] : [];
  });
  const champsDuTemplate = (t: TemplateSummary): string[] => utiles([
    ...champsDesAdresses(t),
    ...(e.indicesSource.find((i) => i.nom === t.name && i.langue === t.language)?.indices ?? [])
      .flatMap((h) => (h.source.type === 'field' ? [h.source.key] : [])),
  ]);

  const templates: ApercuTemplate[] = e.templates.map((r) => {
    const base = { nom: r.nom, langue: r.langue, blocs: r.blocs };
    const d = e.destination?.find((w) => w.nom === r.nom && w.langue === r.langue);
    if (d) return { ...base, etat: 'reutilise', statut: d.statut, raison: null, flows: [], champs: [] };
    if (e.source === null) return { ...base, etat: 'non_recreable', statut: null, raison: 'lecture', flows: [], champs: [] };
    const s = sources.get(cle(r.nom, r.langue));
    const raison = pourquoiNonRecreable(s, flowsParId);
    if (raison !== null || !s) return { ...base, etat: 'non_recreable', statut: s?.status ?? null, raison: raison ?? 'introuvable', flows: [], champs: [] };
    return { ...base, etat: 'a_recreer', statut: s.status, raison: null, flows: flowsDesBoutons(s), champs: champsDuTemplate(s) };
  });

  // Les Flows : ceux des blocs, puis ceux des boutons des templates à recréer, dans cet ordre, une fois chacun.
  const pris = [...e.nomsFlowsPris];
  const ordre = [...new Set([...e.blocsFlow.map((b) => b.flowId), ...templates.flatMap((t) => t.flows)])];
  const flows: ApercuFlow[] = ordre.map((id) => {
    const f = flowsParId.get(id);
    const blocs = e.blocsFlow.filter((b) => b.flowId === id).map(({ nodeId, nom }) => ({ nodeId, nom }));
    if (!f || f.ecrans === null) {
      const nom = f?.nom ?? e.blocsFlow.find((b) => b.flowId === id)?.flowNom ?? id;
      return { id, nom, nomCopie: '', publie: f?.publie ?? false, recreable: false, champs: [], blocs };
    }
    const nomCopie = nomLibre(f.nom, pris, 'insensible');
    pris.push(nomCopie);
    return { id, nom: f.nom, nomCopie, publie: f.publie, recreable: true, champs: utiles(Object.values(f.mapping)), blocs };
  });

  const apercu: ApercuMeta = { templates, flows };
  const nonReutilises = (coches: ReadonlySet<string>): string[] => templates
    .filter((t) => t.etat !== 'reutilise' && !coches.has(cle(t.nom, t.langue)))
    .flatMap((t) => t.blocs.map((b) => b.nodeId));
  const vide: PlanMeta = {
    apercu, copies: AUCUNE_COPIE, choixInvalides: [], templatesADebrancher: nonReutilises(new Set()), clesDeChamp: [], champsAvantMeta: [], depasse: false,
  };
  if (!choix) return vide;

  const aRecreer = new Map(templates.filter((t) => t.etat === 'a_recreer').map((t) => [cle(t.nom, t.langue), t]));
  const recreables = new Set(flows.filter((f) => f.recreable).map((f) => f.id));
  const choixInvalides = [
    ...choix.templates.filter((c) => !aRecreer.has(cle(c.nom, c.langue))).map((c) => `${c.nom} (${c.langue})`),
    ...choix.flows.filter((id) => !recreables.has(id)),
  ];
  if (choixInvalides.length > 0) return { ...vide, choixInvalides };

  const coches = new Set(choix.templates.map((c) => cle(c.nom, c.langue)));
  const templatesCoches = [...aRecreer.values()].filter((t) => coches.has(cle(t.nom, t.langue)));
  // Un template coché emporte le Flow de ses boutons.
  const flowsCoches = new Set([...choix.flows, ...templatesCoches.flatMap((t) => t.flows)]);
  // Publié comme à la source ; et toujours quand un bouton de template coché l'ouvre : Meta n'accepte qu'un Flow publié
  // derrière un bouton, et le statut lu dans la base de la source peut retarder sur Meta.
  const ouvertParUnBouton = new Set(templatesCoches.flatMap((t) => t.flows));
  const copies: CopiesMeta = {
    flows: flows.filter((f) => flowsCoches.has(f.id)).map((f) => ({
      id: f.id, nomCopie: f.nomCopie, publier: f.publie || ouvertParUnBouton.has(f.id), champsAAssurer: absents(f.champs),
    })),
    templates: templatesCoches.map((t) => ({ nom: t.nom, langue: t.langue, flows: t.flows })),
  };
  const clesTemplates = templatesCoches.flatMap((t) => t.champs);
  const avantMeta = templatesCoches.flatMap((t) => {
    const s = sources.get(cle(t.nom, t.langue));
    return s ? champsDesAdresses(s) : [];
  });
  return {
    apercu,
    copies,
    choixInvalides: [],
    templatesADebrancher: nonReutilises(coches),
    clesDeChamp: utiles([...clesTemplates, ...copies.flows.flatMap((f) => flows.find((x) => x.id === f.id)?.champs ?? [])]),
    champsAvantMeta: absents(avantMeta),
    depasse: copies.flows.length + copies.templates.length > PLAFOND_META,
  };
}
