import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LE CÂBLAGE DE L'OPTION DU CRÉDIT WHATSAPP DANS `src/index.ts` (relecture du lot C5, jaune 8). Les tests du webhook et de
 * la fin de droit montent de faux câblages : si `formulePayee` était câblé à la place de `repriseOuverte`, toute la suite
 * passerait, et l'e-mail de l'arrêt partirait à un Pro dont la fin programmée est passée. Ce test lit le câblage RÉEL.
 */
const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
/** Sans les commentaires : sinon une explication qui CITE le bon code ferait passer un câblage fautif. */
const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Le bloc qui suit `debut`, jusqu'à `fin` compris. */
function bloc(debut: string, fin: string): string {
  const i = sansCommentaires.indexOf(debut);
  const j = sansCommentaires.indexOf(fin, i);
  expect(i, `introuvable : ${debut}`).toBeGreaterThanOrEqual(0);
  expect(j, `introuvable après ${debut} : ${fin}`).toBeGreaterThan(i);
  return sansCommentaires.slice(i, j + fin.length);
}

describe('le câblage de l’option du Crédit WhatsApp', () => {
  it('🔴 la prise et sa reprise lisent la formule par les MÊMES lectures (`formuleDe`), sans cache', () => {
    const formule = bloc('const formuleDe = async (tenant: string) => ({', '});');
    expect(formule).toMatch(/offre: \(await offresSansCache\.offreDe\(tenant\)\)\.offre,/);
    expect(formule).toMatch(/pro: await abonnementsOffre\.resume\(tenant\),/);
    expect(formule).toMatch(/businessEssaiFinLe: \(await offresSansCache\.lireEntreprise\(tenant\)\)\?\.businessEssaiFinLe \?\? null,/);
    const option = bloc('const optionDeLaConsole: DepsOptionCredit = {', '};');
    expect(option).toMatch(/formulePayee: async \(tenant\) => formulePayee\(await formuleDe\(tenant\), Date\.now\(\)\),/);
    // Un Pro en retard lit la vraie raison du refus (jaune 7).
    expect(option).toMatch(/formuleEnRetard: async \(tenant\) => formuleEnRetard\(await formuleDe\(tenant\)\),/);
  });

  it('🔴 la fin de droit reçoit le verrou partagé entre les copies', () => {
    expect(bloc('const finDeDroitDeLOption: DepsFinDeDroitOption = {', '};')).toMatch(/verrous: verrousCourts,/);
  });

  it('🔴 l’e-mail de l’arrêt lit l’état des lignes, la REPRISE (pas la seule formule payée) et la vente', () => {
    const webhook = bloc('finDeDroit: brancherFinDeDroit(finDeDroitDeLOption),', 'prevenirArret: optionArretee,');
    expect(webhook).toMatch(/lignes: \(tenant\) => lignesCreditWhatsapp\.lignesDeLEspace\(tenant\),/);
    expect(webhook).toMatch(/repriseOuverte: async \(tenant\) => repriseOuverte\(await formuleDe\(tenant\), Date\.now\(\)\),/);
    expect(webhook).toMatch(/enVente: \(\) => optionEnVente\(optionDeLaConsole\),/);
    expect(webhook, 'la seule formule payée laisserait partir l’e-mail à un Pro dont la fin est passée').not.toMatch(/formulePayee\(/);
  });
});

describe('le câblage de la fenêtre du partenaire (lot E)', () => {
  it('🔴 la carte et la connexion lisent la MÊME règle, sur l’offre sans cache, l’option et la configuration', () => {
    const fenetre = bloc('const fenetreDuPartenaire: DepsFenetrePartenaire = {', '};');
    expect(fenetre).toMatch(/solutionId: config\.META_SOLUTION_ID,/);
    expect(fenetre).toMatch(/offre: async \(tenant\) => \(await offresSansCache\.offreDe\(tenant\)\)\.offre,/);
    expect(fenetre).toMatch(/option: \(tenant\) => optionsCreditWhatsapp\.vivante\(tenant\),/);
    // Une place libre se compte contre les numéros que les lignes de l'option couvrent ; un numéro délié n'est plus vivant.
    expect(fenetre).toMatch(/numerosCouverts: async \(tenant\) => \(await lignesCreditWhatsapp\.numerosCouvertsParOption\(tenant\)\)\.length,/);
    expect(fenetre).toMatch(/numerosVivants: async \(tenant\) => \(await lignesCreditWhatsapp\.numerosDeLEspace\(tenant\)\)\.filter\(\(n\) => !n\.delie\)\.length,/);
    expect(bloc('const creditWhatsappDeLaConsole: CreditWhatsappRouteDeps = {', 'vue: {'))
      .toMatch(/fenetrePartenaire: async \(tenant\) => \(await solutionDuPartenaire\(fenetreDuPartenaire, tenant\)\) !== null,/);
    const connexion = bloc('embeddedSignup: (() => {', 'meta: esClient,');
    expect(connexion).toMatch(/solutionDuPartenaire: \(tenant: string\) => solutionDuPartenaire\(fenetreDuPartenaire, tenant\),/);
    expect(connexion).toMatch(/connexionParLaLigne\(fenetreDuPartenaire, tenant, n\)/);
  });
});
