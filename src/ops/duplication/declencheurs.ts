import { keywordsOf, normalizeText, type AutomationRow } from '../../automation/match';
import type { AutomationInput } from '../../automation/store.pg';
import { normaliserEtiquette } from '../../crm/poser-etiquette';
import { isSystemFieldKey } from '../../crm/fields';
import { clesDesClauses } from './graphe';

/**
 * LES DÉCLENCHEURS D'UN SCÉNARIO DUPLIQUÉ VERS UN AUTRE ESPACE (duplication depuis /ops, lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`, « Le scénario et ses déclencheurs »).
 * Pur : aucune IO.
 *
 * Tout ce qui suit arrive ÉTEINT (la copie est inactive) et SANS attestation d'accord marketing : elle engage une
 * personne de l'espace source, la destination la redonnera en rallumant. Ne suivent pas :
 *  - un déclencheur lié à un objet de la source : webhook entrant, étape HubSpot, publicité CTWA, action d'agent, et
 *    toute automation possédée (lien de chaîne, publicité, widget : `possedePar`). Dans la destination, il viserait un
 *    objet qui n'existe pas ;
 *  - un « nouveau contact » quand la destination en a déjà un, allumé ou non : rallumés, les deux partiraient ;
 *  - un mot-clé dont TOUS les mots sont déjà pris dans la destination. Un mot pris est retiré, les autres restent ; la
 *    comparaison est celle du déclencheur (`normalizeText` : sans casse, sans accents), quel que soit le mode.
 */

export type RaisonRetrait = 'mot_cle_pris' | 'nouveau_contact_existe' | 'lie_a_la_source';

/** Ce que `PgAutomationStore.create` reçoit, moins le scénario, connu seulement à l'écriture. */
export type DeclencheurCopie = Omit<AutomationInput, 'workflowId'>;

export interface DeclencheursCopies {
  copies: DeclencheurCopie[];
  /** Déclencheurs qui ne suivent pas, par nom. */
  retires: Array<{ nom: string; raison: RaisonRetrait }>;
  /** Mots-clés retirés d'un déclencheur qui, lui, suit. */
  motsRetires: Array<{ nom: string; mots: string[] }>;
  clesDeChamp: string[];
  tags: string[];
}

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function copierDeclencheurs(duScenario: readonly AutomationRow[], deLaDestination: readonly AutomationRow[]): DeclencheursCopies {
  const pris = new Set(deLaDestination.filter((a) => a.triggerKind === 'keyword').flatMap((a) => keywordsOf(a.triggerConfig)));
  const nouveauContactExiste = deLaDestination.some((a) => a.triggerKind === 'new_contact');
  const out: DeclencheursCopies = { copies: [], retires: [], motsRetires: [], clesDeChamp: [], tags: [] };
  const cles = new Set<string>();
  const tags = new Set<string>();

  for (const a of duScenario) {
    const retirer = (raison: RaisonRetrait) => { out.retires.push({ nom: a.name, raison }); };
    let config = a.triggerConfig;
    if (a.possedePar !== null) { retirer('lie_a_la_source'); continue; }
    switch (a.triggerKind) {
      case 'webhook':
      case 'hubspot_deal_stage':
      case 'ctwa_ad':
      case 'agent_action':
        retirer('lie_a_la_source');
        continue;
      case 'new_contact':
        if (nouveauContactExiste) { retirer('nouveau_contact_existe'); continue; }
        break;
      case 'keyword': {
        const brut: unknown[] = Array.isArray(config.keywords) ? config.keywords : [];
        const gardes = brut.filter((k) => !pris.has(normalizeText(String(k ?? ''))));
        const retires = brut.filter((k) => !gardes.includes(k)).map((k) => String(k));
        if (retires.length > 0) {
          if (keywordsOf({ keywords: gardes }).length === 0) { retirer('mot_cle_pris'); continue; }
          out.motsRetires.push({ nom: a.name, mots: retires });
          config = { ...config, keywords: gardes };
        }
        break;
      }
      case 'tag_added': {
        const tag = normaliserEtiquette(texte(config.tag));
        if (tag !== '') tags.add(tag);
        break;
      }
      case 'avant_date':
        cles.add(texte(config.fieldKey));
        break;
      // Leurs filtres portent sur les colonnes fixes de l'analyse (`CLES_FILTRABLES`), jamais sur un champ de l'espace.
      case 'conversation_analyzed':
      case 'analyse_devient':
      case 'risque_eleve':
        break;
      default: {
        const jamais: never = a.triggerKind;
        throw new Error(`déclencheur sans règle de copie : ${String(jamais)}`);
      }
    }
    for (const c of clesDesClauses(a.conditionGroup?.clauses ?? [])) cles.add(c);
    out.copies.push({
      name: a.name, triggerKind: a.triggerKind, triggerConfig: config, conditionGroup: a.conditionGroup,
      startNodeId: a.startNodeId, cooldownSeconds: a.cooldownSeconds, maxFiresPerHour: a.maxFiresPerHour,
      enabled: false, possedePar: null, accordMarketing: null,
      // Le rayon de l'automation copiée : celui de l'original (son scénario est copié dans le même rayon).
      rayon: a.rayon,
    });
  }
  out.clesDeChamp = [...cles].filter((c) => c !== '' && !isSystemFieldKey(c));
  out.tags = [...tags];
  return out;
}
