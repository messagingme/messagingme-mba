import { dayKey } from './day';

/**
 * La loupe et les jours de la liste de l'Inbox (demande de Julien, 2026-11-26). Purs, testés par
 * `tests/web-inbox-recherche.test.ts`.
 */

/** Le minimum lu par ces deux règles : une ligne de la liste. */
export interface LigneRecherchable {
  waId: string;
  profileName: string | null;
  lastPreview: string | null;
  lastMessageAt: string;
  urgente?: boolean;
}

/**
 * La conversation correspond-elle au texte de la loupe ? La MÊME règle que le serveur (`recherche` de
 * `listConversations`, `src/inbox/store.pg.ts`) : nom, numéro ou aperçu du dernier message, sans casse ; un numéro
 * tapé avec espaces ou « + » se compare sur ses chiffres dès qu'il en porte trois.
 *
 * Appliquée AUSSI à l'écran, sur la page reçue : un serveur qui ne connaît pas encore `?q=` rend la liste entière,
 * et la loupe montrerait alors des conversations qui ne correspondent pas. Redondante une fois l'API déployée.
 */
export function correspond(c: LigneRecherchable, texte: string): boolean {
  const q = texte.trim().slice(0, 80).toLowerCase();
  if (q === '') return true;
  const chiffres = q.replace(/\D/g, '');
  const numero = chiffres.length >= 3 ? c.waId.includes(chiffres) : c.waId.toLowerCase().includes(q);
  return numero
    || (c.profileName ?? '').toLowerCase().includes(q)
    || (c.lastPreview ?? '').toLowerCase().includes(q);
}

/** Un groupe de l'accordéon : un jour (`cle` = AAAA-MM-JJ, fuseau Paris), ou les urgentes en tête d'« À traiter ». */
export interface GroupeJour<T> {
  cle: string;
  /** L'instant d'une conversation du groupe, pour le libellé du jour. Absent pour les urgentes. */
  instant: string | null;
  lignes: T[];
}

/** La clé du groupe des urgentes : aucun jour ne s'écrit ainsi. */
export const GROUPE_URGENTES = 'urgentes';

/**
 * Range la liste par jour du DERNIER contact (`lastMessageAt`, qui bouge à la réception comme à l'envoi), dans
 * l'ordre reçu du serveur. 🔴 « À traiter » met les urgentes en tête quel que soit leur jour : avec `urgentesEnTete`,
 * elles forment un premier groupe à part, sinon leurs jours anciens reviendraient plus bas une seconde fois.
 * Les jours suivent l'ordre d'arrivée : un jour déjà ouvert accueille ses lignes même si une autre l'a interrompu.
 */
export function grouperParJour<T extends LigneRecherchable>(lignes: T[], urgentesEnTete: boolean): GroupeJour<T>[] {
  const groupes: GroupeJour<T>[] = [];
  const parCle = new Map<string, GroupeJour<T>>();
  for (const l of lignes) {
    const cle = urgentesEnTete && l.urgente === true ? GROUPE_URGENTES : dayKey(l.lastMessageAt);
    let g = parCle.get(cle);
    if (!g) {
      g = { cle, instant: cle === GROUPE_URGENTES ? null : l.lastMessageAt, lignes: [] };
      parCle.set(cle, g);
      groupes.push(g);
    }
    g.lignes.push(l);
  }
  return groupes;
}
