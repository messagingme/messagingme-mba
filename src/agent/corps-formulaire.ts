import { FormData } from 'undici';
import type { CorpsFormulaire } from './requete-http';

/**
 * Un corps « formulaire » (`multipart/form-data`) rendu prêt à partir (plan 2026-11-25).
 *
 * Une ligne `fichier` désigne une pièce : sa valeur (le lien `/f/` fabriqué pour ce seul appel, dans un scénario) est
 * remise à `lireFichier`, qui rend le fichier ou `null`. 🔴 `lireFichier` absent = l'appelant n'a pas le droit de lire
 * une pièce (agent IA, poussée d'opt-out, relais du MBA) : refus, jamais un envoi du texte à la place du fichier, qui
 * ferait analyser une chaîne par le système du client et répondre « document illisible » sans que rien ne le dise.
 *
 * 🔴 `FormData` vient du paquet `undici`, comme le `fetch` protégé (`src/lib/connexion-publique.ts`) : ce `fetch` ne
 * reconnaît un formulaire que s'il est de SA classe (`webidl.is.FormData`, un `instanceof`). Le `FormData` global de
 * Node est celui de l'undici embarqué, une autre classe : il partirait en texte `[object FormData]`, sans erreur
 * (relecture du lot, `tests/workflow-piece-en-fichier.test.ts` le vérifie par le vrai `fetch` d'undici).
 */

export interface FichierAEnvoyer {
  octets: Uint8Array;
  mime: string;
  nom: string;
}

export type LecteurFichier = (valeur: string) => Promise<FichierAEnvoyer | { refus: string }>;

export async function materialiserFormulaire(
  corps: CorpsFormulaire,
  lireFichier: LecteurFichier | null,
): Promise<{ ok: true; formulaire: FormData } | { ok: false; raison: string }> {
  const formulaire = new FormData();
  for (const c of corps.champs) {
    if (!c.fichier) { formulaire.append(c.cle, c.valeur); continue; }
    if (lireFichier === null) {
      return { ok: false, raison: 'cet appel envoie une pièce : seul un bloc Appel API de scénario peut le jouer' };
    }
    if (c.valeur === '') return { ok: false, raison: `aucune pièce dans « ${c.cle} »` };
    const f = await lireFichier(c.valeur);
    if ('refus' in f) return { ok: false, raison: f.refus };
    formulaire.append(c.cle, new Blob([new Uint8Array(f.octets)], { type: f.mime }), f.nom);
  }
  return { ok: true, formulaire };
}

/**
 * L'essai d'une requête (bouton « Essayer » de la console) n'a pas de pièce : une ligne `fichier` y part comme un petit
 * fichier texte qui porte la valeur d'essai. Le système du client répond alors sur un document qu'il ne reconnaît pas,
 * ce qui suffit à voir la forme de sa réponse et à choisir les champs à lire.
 */
export const lecteurDEssai: LecteurFichier = async (valeur) => ({
  octets: new TextEncoder().encode(valeur), mime: 'text/plain', nom: 'essai.txt',
});
