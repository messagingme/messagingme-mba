import { signLienNumero } from '../../src/auth/token';
import {
  creerAccompagnementConnexionNumeroMcp,
  type AccompagnementConnexionNumeroMcp,
  type DepsConnexionNumeroMcp,
} from '../../src/mcp/connexion-numero';
import type { EtatConnexion } from '../../src/otp/etat-connexion';

/**
 * Monte le vrai module de connexion avec des bords inertes. Les tests des outils MCP gardent ainsi la même forme de
 * câblage que la production, au lieu de recopier son ancienne liste de dépendances dans des objets littéraux.
 */
export function connexionNumeroPourTest(options: {
  secret: string;
  etat: () => Promise<EtatConnexion>;
  comptesApplication?: DepsConnexionNumeroMcp['comptesApplication'];
  retenirDestination?: DepsConnexionNumeroMcp['retenirDestination'];
  fenetrePartenaire?: DepsConnexionNumeroMcp['fenetrePartenaire'];
}): AccompagnementConnexionNumeroMcp {
  return creerAccompagnementConnexionNumeroMcp({
    signerLien: (lien) => signLienNumero(lien, options.secret),
    etat: () => options.etat(),
    urlConsole: 'https://console.exemple.test',
    attendre: async () => {},
    maintenant: () => 1_000_000,
    comptesApplication: options.comptesApplication ?? {
      preparer: async () => { throw new Error('préparation de compte inattendue dans ce test'); },
    },
    retenirDestination: options.retenirDestination ?? (async () => {}),
    fenetrePartenaire: options.fenetrePartenaire ?? (async () => false),
    creditWhatsapp: {
      option: {
        offre: async () => 'pro',
        optionPrenable: async () => true,
        options: { vivante: async () => null },
        numeroAvecCarte: async () => false,
      },
      vue: {
        lignes: async () => [],
        numeros: async () => [],
      },
    },
  });
}
