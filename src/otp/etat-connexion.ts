import { createHash } from 'node:crypto';
import type { DestinationNumeroFourni, PgNumerosFournisStore } from './store.pg';
import type { PgAbonnementsNumeroStore, StatutAbonnement } from '../stripe/abonnements.pg';
import type { ComptesApplication, StatutCompte } from '../application/comptes';
import type { PhoneNumberRecord } from '../account/types';

/**
 * OÙ EN EST LA CONNEXION DU NUMÉRO D'UN ESPACE (lot 3c, livraison A). Une seule lecture, pour la page `/brancher`
 * (`GET /tenants/:tenantId/connexion-numero`) et pour l'outil d'attente de Claude Code (`watch_whatsapp_connection`) :
 * l'écran et le terminal ne peuvent pas dire deux choses différentes.
 */
export interface EtatConnexion {
  /** Le numéro de la réserve attribué à l'espace, au format que le client tape dans la fenêtre de Meta (`+44...`). */
  fourni: string | null;
  /** Le dernier code capté pour ce numéro depuis son attribution, dans la fenêtre de `codeDeLEspace` (15 minutes). */
  code: { code: string; recuLe: string } | null;
  /**
   * Un code a été capté pour le numéro fourni depuis son attribution ET depuis que sa destination a été retenue, SANS
   * autre borne de temps (`codeCapteDepuisLAttribution`) : le numéro a été vérifié sur la voie choisie. Dit seulement
   * quand c'est vrai.
   */
  codeDejaCapte?: true;
  /**
   * Où va le numéro fourni (migration 0280) : la fenêtre de Meta (`api`) ou l'application WhatsApp Business
   * (`application`), retenue par `start_whatsapp_connection`. Absente : inconnue.
   */
  destination?: DestinationNumeroFourni;
  /**
   * Le numéro WhatsApp relié à l'espace, en chiffres (`''` si son affichage est inconnu). `aActiver` : relié, mais Meta
   * ne l'a pas encore activé (`status` lu et différent de `CONNECTED`, la règle de l'Accueil) ; il n'est pas « connecté ».
   * `paiementBloque` : Meta bloque le compte pour son moyen de paiement (migration 0231, relevé du balayage des statuts).
   * `coexistence` : relié en coexistence, le numéro restant dans l'application WhatsApp Business (migration 0253).
   */
  connecte: { chiffres: string; aActiver: boolean; paiementBloque?: boolean; coexistence?: true } | null;
  /** L'abonnement du numéro fourni (livraison B) : son statut et la fin de la période payée, `null` sans abonnement. */
  abonnement: { statut: StatutAbonnement; periodeFin: string | null } | null;
  /**
   * L'offre de l'espace inclut le numéro fourni (la grille : le Pro, le Business, l'Entreprise) : la page l'obtient sans
   * payer. Le nom reste celui du lot 6 (B2b), que la console et Claude lisent déjà.
   */
  inclusDansLePro: boolean;
  /**
   * Le compte de l'application WhatsApp Business de l'espace (filière application, 2026-10-22) ; absent sans compte, et
   * l'état est alors celui de la filière API. Relié, il vaut « connecté », sous son numéro.
   */
  application?: { statut: StatutCompte; numero: string };
}

export interface DepsEtatConnexion {
  numeros: Pick<PgNumerosFournisStore, 'numeroDeLEspace' | 'codeDeLEspace' | 'codeCapteDepuisLAttribution' | 'destinationDeLEspace'>;
  /** Le numéro de Meta de l'espace (`numeroConnecteDe`). */
  numeroConnecte(tenantId: string): Promise<{ chiffres: string; aActiver: boolean; paiementBloque?: boolean; coexistence?: true } | null>;
  abonnements: Pick<PgAbonnementsNumeroStore, 'deLEspace'>;
  /** L'offre de l'espace inclut-elle le numéro fourni (`limites.numeroInclus`, spec du 2026-10-27) ? */
  offre: { numeroInclus(tenantId: string): Promise<boolean> };
  /** Le compte de la filière application. Requis : sans lui, un compte relié ne serait jamais dit connecté. */
  application: { comptes: Pick<ComptesApplication, 'parEspace'> };
}

/**
 * Le numéro de Meta d'un espace tel que la page du lien, sa garde (qui meurt à la connexion) et Claude le lisent, depuis
 * sa ligne (`PgPhoneStatusStore.getPhoneNumber`) : ses chiffres, « à activer » (un statut lu et différent de
 * `CONNECTED`, la règle de l'Accueil), sa carte bloquée chez Meta (migration 0231) et la coexistence (migration 0253),
 * dite seulement quand elle est vraie. 🔴 Un numéro en coexistence n'est jamais « à activer » : rien ne doit pousser vers
 * un `/register`, que les gestes d'activation refusent d'ailleurs (`NUMERO_EN_COEXISTENCE`). `null` sans numéro.
 */
export function numeroConnecteDe(
  pn: Pick<PhoneNumberRecord, 'displayPhoneNumber' | 'status' | 'wabaPaiementBloque' | 'coexistence'> | null,
): { chiffres: string; aActiver: boolean; paiementBloque: boolean; coexistence?: true } | null {
  if (!pn) return null;
  return {
    chiffres: (pn.displayPhoneNumber ?? '').replace(/[^0-9]/g, ''),
    aActiver: pn.coexistence !== true && pn.status != null && pn.status !== 'CONNECTED',
    paiementBloque: pn.wabaPaiementBloque === true,
    ...(pn.coexistence === true ? { coexistence: true as const } : {}),
  };
}

export async function lireEtatConnexion(deps: DepsEtatConnexion, tenantId: string): Promise<EtatConnexion> {
  const [n, connecteMeta, a, inclus, compte, retenue] = await Promise.all([
    deps.numeros.numeroDeLEspace(tenantId), deps.numeroConnecte(tenantId), deps.abonnements.deLEspace(tenantId),
    deps.offre.numeroInclus(tenantId), deps.application.comptes.parEspace(tenantId), deps.numeros.destinationDeLEspace(tenantId),
  ]);
  const connecte = connecteMeta ?? (compte?.statut === 'relie' ? { chiffres: compte.numero, aActiver: false } : null);
  // Un numéro de Meta relié prime sur un vieux compte de l'application (`filiereDe`) : l'état est alors celui de l'API.
  const application = connecteMeta === null && compte ? { statut: compte.statut, numero: compte.numero } : null;
  // Les codes ne se lisent que pour un numéro attribué : les deux lectures les bornent à l'attribution. 🔴 Le code « déjà
  // capté » l'est AUSSI à la destination retenue (relecture du lot) : un code reçu par la fenêtre de Meta avant que la
  // personne ne choisisse l'application ne prouve aucun compte dans l'application.
  const [c, deja] = n
    ? await Promise.all([
      deps.numeros.codeDeLEspace(tenantId),
      deps.numeros.codeCapteDepuisLAttribution(tenantId, retenue?.depuis ?? null),
    ])
    : [null, false];
  return {
    fourni: n ? `+${n.numero}` : null,
    code: c ? { code: c.code, recuLe: c.recuLe.toISOString() } : null,
    ...(deja ? { codeDejaCapte: true as const } : {}),
    ...(retenue ? { destination: retenue.destination } : {}),
    connecte,
    abonnement: a ? { statut: a.statut, periodeFin: a.periodeFin ? a.periodeFin.toISOString() : null } : null,
    inclusDansLePro: inclus,
    ...(application ? { application } : {}),
  };
}

/** Le mode d'un lien neuf de `start_whatsapp_connection` pour reprendre un numéro fourni pas encore relié. */
export type ModeDeReprise = 'fourni' | 'fourni_application' | 'coexistence';

/**
 * COMMENT REPRENDRE UN NUMÉRO FOURNI (plan 2026-11-06, vécu par Johan) : la seule étape qui reste, calculée ici pour que ni
 * Claude ni le client n'aient à la deviner. Mis dans l'application et déjà vérifié (un code capté depuis l'attribution) :
 * son compte de l'application existe, il reste à le GARDER par la fenêtre de Meta (`coexistence`). Mis dans
 * l'application sans code : créer ce compte (`fourni_application`). Par la fenêtre de Meta : `fourni`. `null` : rien à
 * reprendre (pas de numéro fourni, ou un numéro déjà relié), ou une destination inconnue.
 */
export function modeDeReprise(e: Pick<EtatConnexion, 'fourni' | 'connecte' | 'codeDejaCapte' | 'destination'>): ModeDeReprise | null {
  if (e.fourni === null || e.connecte !== null) return null;
  if (e.destination === 'application') return e.codeDejaCapte ? 'coexistence' : 'fourni_application';
  if (e.destination === 'api') return 'fourni';
  return null;
}

/**
 * L'empreinte d'un état : elle change à chaque étape (numéro attribué, code reçu, un second code, numéro connecté), et
 * reste la même pour le même état. Claude la rend à l'appel suivant pour attendre le prochain changement. Opaque : elle
 * ne laisse pas lire le code.
 */
export function empreinteEtat(e: EtatConnexion): string {
  const forme = JSON.stringify([
    e.fourni, e.code?.recuLe ?? null, e.code?.code ?? null, e.connecte?.chiffres ?? null, e.connecte?.aActiver ?? null,
    e.abonnement?.statut ?? null, e.application?.statut ?? null,
    // La coexistence (migration 0253), ajoutée seulement quand elle est vraie : l'empreinte de tout autre état ne bouge pas.
    ...(e.connecte?.coexistence === true ? ['coexistence'] : []),
  ]);
  return createHash('sha256').update(forme).digest('hex').slice(0, 16);
}
