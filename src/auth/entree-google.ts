import type { GoogleIdentity } from './google';
import { marquerConnexion, type CompteParAdresse, type ComptesAuthDep } from './comptes';
import { nomEspace } from '../user/nom-espace';
import type { OrigineEspace } from '../user/store.pg';

type ComptesGoogle = Required<Pick<ComptesAuthDep, 'getByEmail'>> & Pick<ComptesAuthDep, 'createTenantWithAdmin' | 'touchLastLogin'>;

export interface EntreeGoogleDeps {
  verifyGoogle(idToken: string): Promise<GoogleIdentity | null>;
  comptes: ComptesGoogle;
}

export type ResultatEntreeGoogle =
  | { statut: 'invalide' }
  | { statut: 'inconnue'; identite: GoogleIdentity }
  | { statut: 'revoquee'; identite: GoogleIdentity }
  | { statut: 'ouverte'; identite: GoogleIdentity; comptes: CompteParAdresse[]; nouveau: boolean };

/** Le nom de l'espace qu'une adresse inconnue crée par Google, dans la langue de l'écran où elle s'est connectée. */
function nomDuNouvelEspace(identite: Pick<GoogleIdentity, 'name'>, langue: 'fr' | 'en'): string {
  const nomGoogle = (identite.name ?? '').slice(0, 60).trim();
  const propose = nomGoogle === '' ? '' : langue === 'en' ? `${nomGoogle}’s workspace` : `Espace de ${nomGoogle}`;
  const construit = nomEspace.safeParse(propose);
  if (construit.success) return construit.data;
  return langue === 'en' ? 'My workspace' : 'Mon espace';
}

/**
 * Vérifie l'identité Google, résout ses comptes actifs et, si une origine est fournie, crée l'espace d'une
 * adresse inconnue. Les adaptateurs HTTP gardent leurs réponses, leurs sessions et leurs preuves OAuth.
 * Sans `origine`, une adresse inconnue est seulement signalée : l'entrée Ops peut ainsi interdire toute création.
 * `langue` (lot 2b de l'aide à la connexion) : celle de l'écran, qui nomme l'espace créé et devient celle des e-mails
 * de l'identité qui naît ; sans effet sur une adresse connue.
 */
export async function entrerParGoogle(
  deps: EntreeGoogleDeps,
  idToken: string,
  origine?: OrigineEspace,
  langue: 'fr' | 'en' = 'fr',
): Promise<ResultatEntreeGoogle> {
  const identite = await deps.verifyGoogle(idToken);
  if (!identite?.emailVerified) return { statut: 'invalide' };

  const tous = await deps.comptes.getByEmail(identite.email);
  if (tous.length > 0) {
    const actifs = tous.filter((compte) => !compte.disabled);
    return actifs.length === 0
      ? { statut: 'revoquee', identite }
      : { statut: 'ouverte', identite, comptes: actifs, nouveau: false };
  }

  if (origine === undefined) return { statut: 'inconnue', identite };
  if (!deps.comptes.createTenantWithAdmin) throw new Error('entrerParGoogle : création d’espace non câblée');
  const tenantName = nomDuNouvelEspace(identite, langue);
  // Appel de méthode, jamais détaché : le store est une classe et y perdrait son `this`.
  const { tenantId, userId } = await deps.comptes.createTenantWithAdmin(
    tenantName,
    { email: identite.email, name: identite.name, passwordHash: null, langue },
    origine,
  );
  marquerConnexion(deps.comptes, userId);
  return {
    statut: 'ouverte',
    identite,
    nouveau: true,
    comptes: [{ id: userId, tenantId, tenantName, role: 'admin', disabled: false }],
  };
}
