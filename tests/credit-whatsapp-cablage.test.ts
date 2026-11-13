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
    // L'onglet lit la formule payée et la prise en UNE lecture de la MÊME formule (relecture de V1, jaune 5).
    expect(option).toMatch(/formuleEtPrise: async \(tenant\) => formuleEtPrise\(await formuleDe\(tenant\), Date\.now\(\)\),/);
    // La règle de la prise (V1 du plan du 2026-11-10) lit la MÊME formule, sans cache : un Pro en essai prend l'option.
    expect(option).toMatch(/optionPrenable: async \(tenant\) => optionPrenable\(await formuleDe\(tenant\), Date\.now\(\)\),/);
    // Un Pro en retard lit la vraie raison du refus (jaune 7).
    expect(option).toMatch(/formuleEnRetard: async \(tenant\) => formuleEnRetard\(await formuleDe\(tenant\)\),/);
  });

  it('🔴 la prise, l’onglet, les cartes et la conversion lisent le numéro connecté avec sa carte par la MÊME règle, sur les vraies lectures de la fenêtre (décision de Julien du 2026-11-13)', () => {
    // Les tests de la prise et des routes montent un faux `numeroAvecCarte` : un câblage qui rendrait toujours `false`
    // revendrait l'option à un numéro que Meta ne laissera jamais passer sur la ligne, suite verte.
    const regle = /numeroAvecCarte: \(tenant\) => numeroAvecCarte\(fenetreDuPartenaire, tenant\),/;
    expect(bloc('const optionDeLaConsole: DepsOptionCredit = {', '};')).toMatch(regle);
    expect(bloc('const conversionDeLaConsole: DepsConversion = {', '\n  };')).toMatch(regle);
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

  it('🔴 la conversion dite par le webhook passe par la garde du moment, sur la fin de l’essai ; le démarrage et /ops la disent en direct (relecture du lot V2, jaune 1)', () => {
    // Depuis V1, un espace Pro en essai lit `a_prendre` : seule la date le tient à l'écart. Le test unitaire de la garde monte
    // un faux `proPayeDepuis` ; s'il rendait la souscription, ou si le webhook appelait la conversion directe, l'e-mail
    // partirait pendant l'essai, suite verte.
    expect(bloc('const conversionDeLaConsole: DepsConversion = {', '\n  };')).toMatch(/return r === null \? null : \(r\.essaiFinLe \?\? r\.creeLe\);/);
    expect(sansCommentaires).toMatch(/signalerConversion: \(tenantId: string\) => signalerConversionDuPro\(conversionDeLaConsole, tenantId\),/);
    // Le démarrage de la formule Pro et la confirmation d'un Business dans /ops SONT la conversion : l'appel direct, ces deux-là seulement.
    expect(sansCommentaires.match(/signalerConversion: \(tenant\) => signalerConversion\(conversionDeLaConsole, tenant\),/g)).toHaveLength(2);
    expect(sansCommentaires.match(/signalerConversion\(conversionDeLaConsole/g)).toHaveLength(2);
  });
});

describe('le câblage de la fenêtre du partenaire (lot E)', () => {
  it('🔴 la carte et la connexion lisent la MÊME règle, sur l’offre sans cache, l’option et la configuration', () => {
    const fenetre = bloc('const fenetreDuPartenaire: DepsFenetrePartenaire = {', '};');
    // L'inscription éteinte ferme aussi la fenêtre : la carte ne se dit pas ouverte sur un bouton grisé (relecture du lot E, jaune 10).
    expect(fenetre).toMatch(/solutionId: config\.META_ES_CONFIG_ID !== '' && config\.META_APP_ID !== '' \? config\.META_SOLUTION_ID : '',/);
    expect(fenetre).toMatch(/offre: async \(tenant\) => \(await offresSansCache\.offreDe\(tenant\)\)\.offre,/);
    expect(fenetre).toMatch(/option: \(tenant\) => optionsCreditWhatsapp\.vivante\(tenant\),/);
    // Une place libre se compte contre les numéros que les lignes de l'option couvrent (la liste : la fin écarte le numéro
    // qui vient d'arriver, jaune 9) ; un numéro délié reste rattaché, comme pour `hasNumber` et `linkTenant` (jaune 5).
    expect(fenetre).toMatch(/numerosCouverts: \(tenant\) => lignesCreditWhatsapp\.numerosCouvertsParOption\(tenant\),/);
    // Leur compte, leur coexistence et leur attente : une connexion interrompue y retrouve le numéro que la fenêtre n'a pas
    // annoncé, et l'alerte dit ce qu'en sait la liste (relecture du lot E7, jaune 4 ; du lot V5, jaunes 1, 4 et 7).
    expect(fenetre).toMatch(/numerosRattaches: \(tenant\) => lignesCreditWhatsapp\.numerosDeLEspace\(tenant\),/);
    expect(fenetre).not.toMatch(/delie/);
    // La marque du numéro arrivé par la fenêtre, appelée sur son magasin ; l'alerte rend l'issue de Telegram, pour qu'une
    // alerte perdue se journalise (relecture du lot E, jaune 3) et qu'une alerte incertaine garde sa retenue (lot E7, jaune 7).
    // La marque rend ce qu'elle a écrit : un numéro qui n'est plus dans l'espace ne se dit pas marqué (relecture du lot V6, jaune 4).
    expect(fenetre).toMatch(/marquer: \(tenant, phoneNumberId\) => lignesCreditWhatsapp\.marquerParLaLigne\(tenant, phoneNumberId\),/);
    expect(fenetre).toMatch(/alerter: \(texte\) => envoyerTelegram\(`\[mba-\$\{NOM_API\}\] \$\{texte\}`\),/);
    // « Déjà couvert » se lit comme la pose de `/ops` le lit, toute origine (relecture du lot E5, jaune 5), appelé sur son
    // magasin ; la retenue d'une alerte de refus est partagée par les copies (jaune 2), jamais un verrou par processus.
    expect(fenetre).toMatch(/ligneDuNumero: \(phoneNumberId\) => lignesCreditWhatsapp\.ligneDuNumero\(phoneNumberId\),/);
    expect(fenetre).toMatch(/verrous: verrousCourts,/);
    // L'autre espace se nomme par la lecture de `/ops`, appelée sur son magasin (relecture du lot E6, jaune 4).
    expect(fenetre).toMatch(/nomDeLEspace: \(tenant\) => opsStore\.getTenantName\(tenant\),/);
    expect(bloc('const creditWhatsappDeLaConsole: CreditWhatsappRouteDeps = {', 'vue: {'))
      .toMatch(/fenetrePartenaire: async \(tenant\) => \(await solutionDuPartenaire\(fenetreDuPartenaire, tenant\)\) !== null,/);
    // L'état des cartes lit « attend sa ligne » sur la VRAIE liste des numéros (relecture du lot E5, jaune 4) : une source
    // qui ne le rendrait pas éteindrait l'attente en silence, `attendLigne` étant facultatif dans le type.
    expect(bloc('const creditWhatsappDeLaConsole: CreditWhatsappRouteDeps = {', '\n    },'))
      .toMatch(/numeros: \(t\) => lignesCreditWhatsapp\.numerosDeLEspace\(t\),/);
    const connexion = bloc('embeddedSignup: (() => {', 'meta: esClient,');
    expect(connexion).toMatch(/solutionDuPartenaire: \(tenant: string\) => solutionDuPartenaire\(fenetreDuPartenaire, tenant\),/);
    expect(connexion).toMatch(/connexionParLaLigne\(fenetreDuPartenaire, tenant, n\)/);
    // La coexistence voyage avec le numéro, typée : un littéral reconstruit sans elle ne compilerait pas (relecture du lot V5, jaune 6).
    expect(connexion).toMatch(/connexionParLaLigne: \(tenant: string, n: \{ wabaId: string; phoneNumberId: string \| null; numero: string \| null; coexistence: boolean \}\) =>/);
    // « Ne pas poser » nomme l'espace dont la ligne bloque, par la lecture de `/ops` (relecture du lot V5, jaune 2).
    expect(sansCommentaires).toMatch(/reglages: reglagesCreditWhatsapp, lignes: lignesCreditWhatsapp,[\s\S]{0,800}?nomDeLEspace: \(tenant\) => opsStore\.getTenantName\(tenant\),\s*attache: depsPoseDeLaLigne\.attache,\s*alerter: depsPoseDeLaLigne\.alerter,\s*\},/);
    expect(connexion).toMatch(/fenetreRefuseeParLaLigne\(fenetreDuPartenaire, tenant, i\)/);
    // La route tire `enabled` des MÊMES variables que la fenêtre (relecture du lot E4, jaune 4) : l'une déplacée seule,
    // la carte se dirait ouverte sur un bouton grisé.
    expect(connexion).toMatch(/configId: config\.META_ES_CONFIG_ID,/);
    expect(connexion).toMatch(/appId: config\.META_APP_ID,/);
  });

  it('🔴 V3 : la pose de la connexion est CELLE de /ops (un seul objet de dépendances), jamais forcée, et son levier d’urgence la coupe', () => {
    const fenetre = bloc('const fenetreDuPartenaire: DepsFenetrePartenaire = {', '};');
    // Jamais forcée : une pose forcée passerait outre les places, et un Pro sans place payée aurait sa ligne.
    expect(fenetre).toMatch(/poserLaLigne: \(tenant, phoneNumberId\) => poserLaLigne\(depsPoseDeLaLigne, tenant, phoneNumberId, \{\s*forcer: false,/);
    // Le levier d'urgence : seule la valeur 'false' la coupe ; et sans l'API du partenaire, elle est éteinte (plan du
    // 2026-11-12) : jamais notre ligne sur un compte sans la sienne.
    expect(fenetre).toMatch(/poseAutomatique: config\.CREDIT_WA_POSE_AUTOMATIQUE !== 'false' && attacheLigne !== null,/);
    expect(fenetre).toMatch(/attacheParApi: attacheLigne !== null,/);
    // Les deux poses lisent le MÊME objet : magasins entiers, places et campagnes sur leur magasin.
    const deps = bloc('const depsPoseDeLaLigne: DepsPose = {', '  };');
    expect(deps).toMatch(/lignes: lignesCreditWhatsapp,/);
    expect(deps).toMatch(/grilleEnVigueur: \(\) => reglagesCreditWhatsapp\.grilleEnVigueur\(\),/);
    expect(deps).toMatch(/entreprise: async \(tenant\) => \(await conditionsCreditWhatsapp\.conditions\(tenant\)\)\.openBar,/);
    expect(deps).toMatch(/placesPayees: \(tenant\) => optionsCreditWhatsapp\.placesPayees\(tenant\),/);
    expect(deps).toMatch(/reprendreCampagnes: \(tenant\) => numeroDelieStore\.leverPausesLigneCredit\(tenant\),/);
    expect(sansCommentaires).toMatch(/lignes: lignesCreditWhatsapp, audit: auditSink, credit: creditWhatsapp,\s*option: depsPoseDeLaLigne\.option,/);
  });

  it('🔴 l’attache par l’API du partenaire : une seule instance, lue de ses trois variables, pour la pose, /ops, la fin et la reprise de l’option (plan du 2026-11-12)', () => {
    // L'instance n'existe que si l'adresse est posée (les trois vont ensemble, `src/config.ts`), signée de leur secret.
    expect(sansCommentaires).toMatch(/const attacheLigne = config\.LIGNE_PARTENAIRE_URL !== ''\s*\? creerAttacheLigne\(\{ url: config\.LIGNE_PARTENAIRE_URL, emetteur: config\.LIGNE_PARTENAIRE_EMETTEUR, secret: config\.LIGNE_PARTENAIRE_SECRET \}\)\s*: null;/);
    const deps = bloc('const depsPoseDeLaLigne: DepsPose = {', '  };');
    expect(deps).toMatch(/attache: attacheLigne,/);
    expect(deps).toMatch(/alerter: alerterDeLAttache,/);
    // Le cycle : le magasin passé ENTIER (ses méthodes lisent `this.pool`), la même instance.
    expect(sansCommentaires).toMatch(/const cycleDeLAttache: DepsCycleAttache = \{ lignes: lignesCreditWhatsapp, attache: attacheLigne, alerter: alerterDeLAttache \};/);
    // La fin de droit ET le webhook de Stripe arrêtent par le cycle : plus aucun arrêt des lignes de l'option sans lui.
    expect(sansCommentaires.match(/arreterLesLignes: \(tenant\) => arreterLesLignesEtLeursAttaches\(cycleDeLAttache, tenant\),/g)).toHaveLength(2);
    expect(sansCommentaires).not.toMatch(/arreterLesLignes: \(tenant\) => lignesCreditWhatsapp\.arreterLesLignesDeLOption/);
    expect(sansCommentaires).toMatch(/relancerLesLignes: \(tenant\) => relancerLesLignesEtLeursAttaches\(cycleDeLAttache, tenant\),/);
    expect(sansCommentaires).not.toMatch(/relancerLesLignes: \(tenant\) => lignesCreditWhatsapp\.relancerLesLignesDeLOption/);
  });
});
