import { POSITION_ENTETE } from '../documents/entete';
import type { CarouselCard, CreateTemplateInput, TemplateButton, TemplateHeader } from '../meta/templates';
import { countTemplateVariables, parseParamHints } from '../crm/template';
import { isValidTemplateLanguage } from '../../web/lib/partage/langues-modeles';
import { isSendableButtonUrl } from '../../web/lib/partage/button-url';
import { dureeValide, type CategorieModele } from '../../web/lib/partage/duree-validite';
import { nonEmpty } from '../http/scope';
import type { ChampsModele, DepsGestionModeles, IndicesModele } from './gestion';

/**
 * LA LECTURE DU CORPS D'UN MODÈLE, partagée par l'écran Templates (`POST` et `PATCH /templates`) et la création depuis
 * un bloc du constructeur (menu « Scénario », lot 3) : la forme se valide ici, une seule fois, avant de confier les
 * décisions et les effets au module des modèles (`./gestion`).
 */

const CATEGORIES = new Set(['MARKETING', 'UTILITY']);

function validButtons(v: unknown): v is TemplateButton[] | undefined {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  const okEach = v.every((b) => {
    const btn = b as { type?: unknown; text?: unknown; url?: unknown; flowId?: unknown };
    if (btn.type === 'QUICK_REPLY') return nonEmpty(btn.text);
    if (btn.type === 'URL') return nonEmpty(btn.text) && nonEmpty(btn.url) && isSendableButtonUrl(String(btn.url));
    if (btn.type === 'FLOW') return nonEmpty(btn.text) && nonEmpty(btn.flowId);
    return false;
  });
  if (!okEach) return false;
  const hasFlow = v.some((b) => (b as { type?: unknown }).type === 'FLOW');
  return !hasFlow || v.length === 1;
}

const HEADER_MAX = 60;
const FOOTER_MAX = 60;

function parseHeader(hRaw: unknown): { error: string } | { header?: TemplateHeader } {
  if (hRaw === undefined || hRaw === null) return { header: undefined };
  const hh = hRaw as { format?: unknown; text?: unknown; handle?: unknown };
  if (hh.format === 'TEXT') {
    if (!nonEmpty(hh.text)) return { error: 'en-tête texte requis' };
    if (hh.text.length > HEADER_MAX) return { error: `en-tête texte trop long (max ${HEADER_MAX})` };
    if (/\{\{\s*\d+\s*\}\}/.test(hh.text)) return { error: 'variable non supportée dans l\'en-tête (V1) : utilise un texte fixe' };
    return { header: { format: 'TEXT', text: hh.text.trim() } };
  }
  if (hh.format === 'IMAGE' || hh.format === 'VIDEO' || hh.format === 'DOCUMENT') {
    if (!nonEmpty(hh.handle)) return { error: 'en-tête média : handle requis (uploader le fichier d\'abord)' };
    return { header: { format: hh.format, handle: hh.handle } };
  }
  return { error: 'en-tête : format invalide (TEXT|IMAGE|VIDEO|DOCUMENT)' };
}

/** Validation de la forme HTTP, avant de confier les décisions et les effets au module des modèles. */
export function parseTemplateFields(b: Record<string, unknown>): { error: string } | { fields: ChampsModele } {
  if (typeof b.category !== 'string' || !CATEGORIES.has(b.category)) return { error: 'category invalide (MARKETING|UTILITY)' };
  if (!nonEmpty(b.body)) return { error: 'body requis' };
  if (!validButtons(b.buttons)) return { error: 'buttons invalides' };

  let carousel: { cards: CarouselCard[] } | undefined;
  const carRaw = b.carousel;
  if (carRaw !== undefined) {
    const cards = (carRaw as { cards?: unknown }).cards;
    if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) return { error: 'carousel : entre 2 et 10 cartes' };
    const sig = (c: { buttons?: unknown }) => (Array.isArray(c.buttons) ? c.buttons.map((x) => (x as { type?: string }).type).join(',') : '');
    const firstSig = sig(cards[0] as { buttons?: unknown });
    for (const raw of cards) {
      const c = raw as { headerHandle?: unknown; buttons?: unknown };
      if (!nonEmpty(c.headerHandle)) return { error: 'chaque carte doit avoir une image' };
      if (sig(c) !== firstSig) return { error: 'toutes les cartes doivent avoir les mêmes types de boutons, dans le même ordre (le texte et le lien, eux, peuvent différer)' };
      if (Array.isArray(c.buttons)) {
        if (c.buttons.length > 2) return { error: 'une carte ne peut pas avoir plus de 2 boutons' };
        const carte = cards.indexOf(raw) + 1;
        for (const [j, bt] of c.buttons.entries()) {
          const btn = bt as { type?: string; text?: unknown; url?: unknown };
          if (btn.type === 'QUICK_REPLY' && nonEmpty(btn.text)) continue;
          if (btn.type === 'URL' && nonEmpty(btn.text) && nonEmpty(btn.url)) {
            if (!isSendableButtonUrl(String(btn.url))) {
              return { error: `carte ${carte}, bouton ${j + 1} : « ${String(btn.url)} » n'est pas une adresse valide (commence par https://)` };
            }
            continue;
          }
          return { error: `carte ${carte}, bouton ${j + 1} : invalide (réponse rapide ou lien uniquement, texte requis)` };
        }
      }
    }
    carousel = { cards: cards as CarouselCard[] };
  }

  const h = parseHeader(b.header);
  if ('error' in h) return { error: h.error };

  let footer: string | undefined;
  if (b.footer !== undefined && b.footer !== null && b.footer !== '') {
    if (!nonEmpty(b.footer)) return { error: 'pied de page invalide' };
    if (b.footer.length > FOOTER_MAX) return { error: `pied de page trop long (max ${FOOTER_MAX})` };
    footer = b.footer.trim();
  }

  const varCount = countTemplateVariables(b.body as string);
  const example = Array.isArray(b.example) ? b.example.map(String) : [];
  if (varCount > 0 && example.length < varCount) return { error: `exemples manquants : ${varCount} variable(s) dans le corps` };
  if (example.some((e) => e.trim() === '')) return { error: 'chaque exemple de variable doit être non vide (Meta rejette un exemple vide)' };

  const ttlRaw = b.ttlSecondes;
  if (ttlRaw !== undefined && ttlRaw !== null && (typeof ttlRaw !== 'number' || !dureeValide(b.category as CategorieModele, ttlRaw))) {
    return { error: b.category === 'MARKETING'
      ? 'durée de validité invalide : de 12 heures à 30 jours pour un modèle marketing'
      : 'durée de validité invalide : de 30 secondes à 12 heures, ou 30 jours, pour un modèle utilitaire' };
  }

  return {
    fields: {
      category: b.category as 'MARKETING' | 'UTILITY',
      body: b.body as string,
      ...(!carousel && h.header ? { header: h.header } : {}),
      ...(!carousel && footer ? { footer } : {}),
      ...(varCount > 0 ? { example: example.slice(0, varCount) } : {}),
      ...(carousel ? { carousel } : Array.isArray(b.buttons) ? { buttons: b.buttons as TemplateButton[] } : {}),
      ...(typeof ttlRaw === 'number' ? { ttlSecondes: ttlRaw } : {}),
    },
  };
}


export function indicesDe(b: Record<string, unknown>): IndicesModele | null | undefined {
  if (b.paramHints === undefined) return undefined;
  return parseParamHints(b.paramHints);
}

/**
 * LA SOURCE DE L'EN-TÊTE DOCUMENT (plan du 2026-11-12, lot B2) : `enteteDepuisChamp` est la clé du champ de la fiche qui
 * porte le document (le PDF recopié de HubSpot), `null` pour revenir au fichier du modèle, absent pour ne rien changer.
 * Seulement sur un en-tête DOCUMENT : sur une image, une vidéo ou sans en-tête, c'est refusé (400).
 */
export function enteteDe(b: Record<string, unknown>, header: TemplateHeader | undefined): string | null | undefined | 'invalide' {
  const v = b.enteteDepuisChamp;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(v)) return 'invalide';
  return header?.format === 'DOCUMENT' ? v : 'invalide';
}

/**
 * Les sources à enregistrer : les variables (reçues, ou celles déjà posées) et la position 0 de l'en-tête. 🔴 Le store
 * REMPLACE toutes les sources d'un modèle : un enregistrement des seules variables garde la source d'en-tête déjà posée,
 * et un modèle qui n'a plus d'en-tête DOCUMENT la perd. `undefined` quand rien ne change (aucune écriture).
 */
export async function sourcesAEnregistrer(
  deps: DepsGestionModeles, tenant: string, name: string, language: string,
  indices: IndicesModele | undefined, entete: string | null | undefined, header: TemplateHeader | undefined,
): Promise<IndicesModele | undefined> {
  const existantes = await deps.indices.get(tenant, name, language);
  const zeroExistant = existantes.find((h) => h.position === POSITION_ENTETE);
  const zero = header?.format !== 'DOCUMENT' ? undefined
    : entete === undefined ? zeroExistant
      : entete === null ? undefined : { position: POSITION_ENTETE, source: { type: 'field' as const, key: entete } };
  if (indices === undefined && JSON.stringify(zero) === JSON.stringify(zeroExistant)) return undefined;
  const variables = indices ?? existantes.filter((h) => h.position !== POSITION_ENTETE);
  return [...variables, ...(zero ? [zero] : [])];
}

/**
 * Le corps d'une CRÉATION, lu et validé : le nom vient de l'appelant (saisi dans l'écran Templates, généré côté serveur
 * pour un bloc), tout le reste se lit ici, dans l'ordre de `POST /templates`.
 */
export async function lireCreationDeModele(
  deps: DepsGestionModeles, tenant: string, b: Record<string, unknown>, name: string,
): Promise<{ error: string } | { entree: CreateTemplateInput; sources: IndicesModele | undefined }> {
  if (!nonEmpty(b.language)) return { error: 'language requis' };
  if (!isValidTemplateLanguage(b.language)) return { error: 'language non supportée (hors liste WhatsApp)' };
  const parsed = parseTemplateFields(b);
  if ('error' in parsed) return { error: parsed.error };
  const indices = indicesDe(b);
  if (indices === null) return { error: 'paramHints invalides' };
  const entete = enteteDe(b, parsed.fields.header);
  if (entete === 'invalide') return { error: 'enteteDepuisChamp : la clé d’un champ, sur un modèle à en-tête Document seulement' };
  const sources = await sourcesAEnregistrer(deps, tenant, name, b.language, indices, entete, parsed.fields.header);
  return { entree: { name, language: b.language, ...parsed.fields }, sources };
}
