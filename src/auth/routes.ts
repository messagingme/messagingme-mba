import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassword, hashPassword, hashPasswordSync } from './password';
import { signSession, signChoice, verifyChoice, signMfa, signEnrolement, signSessionOps, type EtapeConnexion } from './token';
import { refuserTropDeRequetes } from './rate-limit';
import { PlafondPartage } from './plafond-partage';
import type { CompteurDebit } from '../db/debit';
import { registerMfa } from './mfa-routes';
import type { MfaDeps, OptionsSuite } from './mfa';
import type { UserAuthStore } from './store';
import { estAdresseOps, type UserStateLoader, type Guard } from './middleware';
import type { GoogleIdentity } from './google';
import { DuplicateEmailError } from '../user/store.pg';
import { nomEspace, MESSAGE_NOM_ESPACE_INVALIDE } from '../user/nom-espace';
import { journaliser } from '../lib/journal';
import { marquerConnexion, type ComptesAuthDep } from './comptes';
import { entrerParGoogle } from './entree-google';
import { empreinteTentative, verifierTentative } from './tentatives';
import { MIN_MOT_DE_PASSE } from '../../web/lib/partage/mot-de-passe';
import { DUREE_LIEN_INSCRIPTION_MS, REFUS_INSCRIPTION } from '../../web/lib/partage/inscription';
import { apresEntree, lireChampPub, type DepsPubInscription } from '../pub/inscription';
import { ipIndicative, reseauDuClient } from '../ops/tentatives';
import { emailInscription, lienInscription } from './email-inscription';
import { compterDemande, lireDemande, PLAFOND_INSCRIPTIONS_PAR_HEURE, SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE } from './inscription-lien';
import type { VerificateurTurnstile } from './turnstile';

export interface AuthRouteDeps extends MfaDeps {
  /**
   * Journal d'audit des connexions échouées ; absent : aucune trace. Écrit seulement pour un compte qui existe :
   * `audit_log.tenant_id` est NOT NULL, une tentative sur une adresse inconnue n'a nulle part où s'écrire, et
   * l'écran doit le dire. Sûr sur ce chemin non authentifié grâce au frein placé avant (dix tentatives par
   * minute et par clé, 429 avant la vérification du mot de passe). L'acteur est le compte visé ; le `detail`
   * ne porte ni l'adresse ni l'IP (table jamais purgée, l'IP est une donnée personnelle), seulement la cause.
   */
  auditConnexion?: (tenantId: string, userId: string, cause: 'mot_de_passe' | 'compte_desactive') => Promise<void>;
  users: UserAuthStore;
  secret: string;
  /** Rate-limit du login (clé : l’empreinte de `ip::adresse`). Défaut : 10 tentatives par minute. */
  loginRateLimit?: { max: number; windowMs: number };
  /** Relecture par requête de l'état du compte (révoqué, supprimé, rôle frais). Absent en test (JWT seul).
   *  Voir makeRequireAuth. */
  getUserState?: UserStateLoader;
  comptes?: ComptesAuthDep;
  /** Client OAuth Google (public) : exposé via GET /auth/config, sert au front pour le bouton. */
  googleClientId?: string;
  /** Vérifie un jeton ID Google -> identité (email vérifié), ou null si invalide. */
  verifyGoogle?(idToken: string): Promise<GoogleIdentity | null>;
  /** Tokens à usage unique (reset / invite). */
  tokens?: {
    create(purpose: 'reset' | 'invite', userId: string, ttlMs: number): Promise<string>;
    consume(purpose: 'reset' | 'invite', raw: string): Promise<string | null>;
  };
  /**
   * Envoi d'e-mail (Resend) pour les liens. Absent : forgot-password répond 200 sans rien envoyer, et la demande du lien
   * d'inscription rend 503. `tags` : l'étiquette Resend que le webhook lit (lien d'inscription).
   */
  sendEmail?(input: { to: string; subject: string; text: string; html?: string; tags?: Array<{ name: string; value: string }> }): Promise<void>;
  /**
   * Le défi Cloudflare Turnstile de la demande d'inscription (lot identité B). Absent (clé secrète non posée) : pas de
   * défi, les plafonds seuls.
   */
  turnstile?: VerificateurTurnstile;
  /** Une alerte à l'exploitant (Telegram) : le total horaire des demandes de lien qui atteint son seuil. Absente : rien. */
  alerter?(message: string): Promise<void>;
  /** Le total horaire des demandes de lien au-delà duquel tout est refusé (`INSCRIPTION_PLAFOND_HEURE`) ; 0 : aucun refus. */
  inscriptionPlafondHeure?: number;
  /** Base URL du front pour les liens d'email. */
  appUrl?: string;
  /** Durée de validité d'un lien de reset (ms). */
  resetTtlMs?: number;
  /**
   * L'accord publicitaire coché à l'inscription, et l'inscription envoyée à Meta (pixel, lot 2, `src/pub/`). Absent :
   * rien ne s'enregistre et rien ne part, ce qui est le sens sûr (aucun envoi sans accord).
   */
  pub?: DepsPubInscription;
}

/**
 * La suite d'une connexion réussie, une fois le second facteur passé ou non dû : une session si l'identité
 * n'a qu'un espace, un jeton de choix sinon. Une seule fonction pour `/auth/login`, `/auth/mfa/verifier` et
 * `/auth/mfa/activer` : une copie qui divergerait ouvrirait un espace sans passer par le choix. `marquerConnexion`
 * n'est appelé qu'ici, à l'ouverture effective d'une session.
 *
 * 🔴 Une étape d'exploitation (`etape.ops`) ne rend jamais une session d'espace, seulement une session
 * d'exploitation, et seulement avec le moyen qui a prouvé le second facteur (`options.facteur`) : seules les
 * routes du code et de l'activation le passent, après vérification. Appelée sans lui, elle lève (500) plutôt que
 * d'ouvrir `/ops` sur le seul mot de passe. Pas de `marquerConnexion` : aucun compte d'espace ne s'ouvre.
 */
async function suiteDeConnexion(deps: AuthRouteDeps, etape: EtapeConnexion, options: OptionsSuite = {}): Promise<Record<string, unknown>> {
  if (etape.ops) {
    if (!options.facteur) throw new Error('session d’exploitation sans second facteur vérifié');
    const sessionOps = await signSessionOps({ identityId: etape.identityId, email: etape.email, facteur: options.facteur }, deps.secret);
    journaliser('warn', 'ops_connexion', { par: etape.email, facteur: options.facteur, at: new Date().toISOString() });
    return { sessionOps, email: etape.email };
  }
  const { ttlChoix } = options;
  const [premier, ...autres] = etape.comptes;
  // Impossible par construction : lever plutôt que d'ouvrir quoi que ce soit sur une étape sans compte.
  if (!premier) throw new Error('suite de connexion sans compte');
  // Un seul espace : on y va, sans écran de plus.
  if (autres.length === 0) {
    const token = await signSession({ userId: premier.userId, tenantId: premier.tenantId, role: premier.role }, deps.secret);
    marquerConnexion(deps.comptes, premier.userId);
    return { token, user: { email: etape.email, role: premier.role, tenantId: premier.tenantId } };
  }
  // Plusieurs espaces : on demande, choisir au hasard ferait entrer chez le mauvais client. 🔴 Aucun jeton de
  // session ici : un jeton de choix, court, qui ne vaut que pour `/auth/choose-workspace`.
  const choix = await signChoice(
    { email: etape.email, comptes: etape.comptes.map((c) => ({ userId: c.userId, tenantId: c.tenantId, role: c.role })) },
    deps.secret,
    ttlChoix,
  );
  // Les noms d'espaces se relisent ici, après le second facteur : le jeton d'étape ne les porte pas.
  const identite = await deps.users.findIdentity(etape.email);
  const noms = new Map((identite?.comptes ?? []).map((c) => [c.tenantId, c.tenantName]));
  return {
    choiceToken: choix,
    workspaces: etape.comptes.map((c) => ({ tenantId: c.tenantId, tenantName: noms.get(c.tenantId) ?? '', role: c.role })),
  };
}

/**
 * Le second facteur, après le mot de passe et avant tout accès : connexion, inscription et invitation
 * acceptée passent par ici.
 *  - facteur actif : `{ mfaToken }`, quel que soit le rôle ou le réglage de l'espace ;
 *  - admin d'un espace qui EXIGE le second facteur, sans facteur (`facteurExigeSql`, décision de Julien du
 *    2026-10-13) : `{ enrolToken }`, il doit en poser un avant d'entrer ;
 *  - sinon : la suite de connexion. Un admin d'un espace qui ne l'exige pas entre avec son seul mot de passe.
 *
 * 🔴 Aucune session ni liste d'espaces avant le code : le jeton d'étape porte la suite prévue, signée. Aucun
 * interrupteur pour sauter cette étape, jamais : ce serait une porte en production (les tests passent par le
 * vrai parcours, `tests/mfa.ts`). `/auth/google` ne passe par ici que pour une connexion d'exploitation : pour
 * un espace, une connexion Google suffit.
 * Une étape d'exploitation rend toujours un code ou un enrôlement, quel que soit `obligatoire`.
 */
async function apresLeMotDePasse(
  deps: AuthRouteDeps,
  etape: EtapeConnexion,
  facteur: { actif: boolean; obligatoire: boolean },
): Promise<Record<string, unknown>> {
  if (facteur.actif) return { mfaToken: await signMfa(etape, deps.secret) };
  if (facteur.obligatoire || etape.ops) return { enrolToken: await signEnrolement(etape, deps.secret) };
  return suiteDeConnexion(deps, etape);
}

/**
 * L'entrée dans l'exploitation, après une identité prouvée (mot de passe ou Google) : l'adresse doit être dans
 * `OPS_EMAILS`, puis la porte du second facteur, la même que pour un admin. Un paramètre de la connexion plutôt
 * qu'une route à part : le frein, le hash leurre et le journal des échecs restent ceux de la connexion, et il n'y
 * a pas de troisième porte à tenir alignée. 403 hors liste, dit seulement à qui vient de prouver son identité.
 */
async function entreeOps(deps: AuthRouteDeps, etape: EtapeConnexion, actif: boolean): Promise<{ code: number; corps: Record<string, unknown> }> {
  if (!estAdresseOps(deps.opsEmails, etape.email)) return { code: 403, corps: { error: 'adresse non autorisée pour l’exploitation' } };
  return { code: 200, corps: await apresLeMotDePasse(deps, { ...etape, ops: true }, { actif, obligatoire: true }) };
}

// Hash leurre (scrypt valide) : `verifyPassword` tourne toujours, même pour une adresse inconnue, pour
// qu'aucun écart de temps ne révèle l'existence d'un compte.
const DUMMY_HASH = hashPasswordSync(randomBytes(24).toString('hex')); // une seule fois au chargement -> sync OK
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// La longueur minimale d'un mot de passe choisi (`MIN_MOT_DE_PASSE`, partagée avec la console) ne mord que sur les
// chemins qui en choisissent un (inscription, invitation acceptée, réinitialisation, changement) : `/auth/login`
// compare un hash, un compte existant plus court continue de se connecter.
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** La borne d'une adresse, celle de la table des demandes (migration 0279) et de la norme (RFC 5321). */
const LONGUEUR_MAX_EMAIL = 254;
/** Un jeton de lien fait 43 caractères (32 octets en base64url) : au-delà, ce n'en est pas un. */
const LONGUEUR_MAX_JETON = 128;
/** La borne du nom d'un membre, celle de l'invitation (`MAX_NOM`, `src/http/users.ts`). */
const LONGUEUR_MAX_NOM = 60;
const ADRESSE_DEJA_CONNUE = { error: 'un compte existe déjà avec cet email', code: REFUS_INSCRIPTION.adresseConnue } as const;
const LIEN_MORT = {
  error: 'Ce lien ne vaut plus : il a expiré, ou il a déjà servi. Refaites une demande d’inscription.',
  code: REFUS_INSCRIPTION.lienInvalide,
} as const;

/** Adapte la décision de débit indépendante du transport à la réponse Fastify de ces routes. */
async function freine(plafond: PlafondPartage, cle: string, reply: FastifyReply): Promise<boolean> {
  const decision = await verifierTentative(plafond, cle);
  if (decision.acceptee) return false;
  await refuserTropDeRequetes(reply, decision.attenteMs, decision.message);
  return true;
}

export function registerAuth(app: FastifyInstance, deps: AuthRouteDeps, garde: Guard, compteur: CompteurDebit): void {
  /**
   * Les sept plafonds, dans le compteur partagé, tous fermés sur panne. Plus de plafond de clés vivantes : il bornait
   * la MÉMOIRE d'un processus contre un robot qui invente des adresses ; en base, ces lignes vivent le temps de leur
   * fenêtre et la tâche `compteurs-debit` du worker les efface toutes les cinq minutes.
   */
  const plafond = (nom: string, max: number, dureeMs = 60_000): PlafondPartage =>
    new PlafondPartage(compteur, { nom: `connexion.${nom}`, max, dureeMs, siLaBaseEchoue: 'refuser' });
  const cfg = deps.loginRateLimit ?? { max: 10, windowMs: 60_000 };
  const limiter = plafond('login', cfg.max, cfg.windowMs);
  const signupLimiter = plafond('signup', 10);
  const forgotLimiter = plafond('forgot', 5);
  const resetLimiter = plafond('reset', 10);
  const acceptLimiter = plafond('accept', 10);
  const googleLimiter = plafond('google', 20);
  // Le clic sur le lien d'inscription, par réseau du client : un jeton inventé ne coûte qu'une requête indexée, et ce
  // plafond borne leur nombre. Les plafonds de la DEMANDE du lien sont à part (`compterDemande`, trois fenêtres en un appel).
  const confirmLimiter = plafond('confirm', 20);

  app.post('/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: unknown; password?: unknown; ops?: unknown };
    if (typeof b.email !== 'string' || typeof b.password !== 'string' || b.email === '' || b.password === '') {
      return reply.code(400).send({ error: 'email et password requis' });
    }
    const email = b.email.trim().toLowerCase();
    // Rate-limit après le parse (la clé porte l'adresse) et avant le scrypt (protège le coût CPU du brute-force).
    if (await freine(limiter, empreinteTentative(req, email), reply)) return reply;

    const identite = await deps.users.findIdentity(email);
    // Toujours vérifier un hash (leurre si l'adresse est inconnue) : même temps CPU, pas de fuite d'existence.
    const ok = await verifyPassword(b.password, identite?.passwordHash ?? DUMMY_HASH);
    if (!identite || !ok) {
      /**
       * 🔴 On n'attend pas cette écriture : une adresse connue produit une ligne, une inconnue aucune, et attendre
       * ferait durer la réponse plus longtemps dans le premier cas, un écart mesurable qui révélerait le compte.
       * Le `.catch` évite qu'une promesse flottante rejetée tue le process.
       */
      const cible = identite?.comptes[0];
      if (cible && deps.auditConnexion) {
        void deps.auditConnexion(cible.tenantId, cible.id, 'mot_de_passe').catch(() => {});
      }
      return reply.code(401).send({ error: 'identifiants invalides' });
    }

    // Une adresse peut ouvrir plusieurs espaces : le mot de passe vaut pour l'adresse ; restent le second
    // facteur, puis le choix de l'espace.
    if (identite.comptes.length === 0) return reply.code(401).send({ error: 'identifiants invalides' });
    const etape: EtapeConnexion = {
      identityId: identite.identityId,
      email,
      comptes: identite.comptes.map((c) => ({ userId: c.id, tenantId: c.tenantId, role: c.role })),
    };
    // `=== true` strict : l'exploitation ne se demande pas par une valeur approximative.
    if (b.ops === true) {
      const ops = await entreeOps(deps, etape, identite.mfaActif);
      return reply.code(ops.code).send(ops.corps);
    }
    // Calculé en base sur les comptes actifs (`facteurExigeSql`) : un admin révoqué n'oblige plus à rien, et un admin
    // d'un espace qui n'exige pas le second facteur non plus.
    return reply.code(200).send(await apresLeMotDePasse(deps, etape, {
      actif: identite.mfaActif,
      obligatoire: identite.facteurExige,
    }));
  });

  /**
   * Deuxième temps d'une connexion à plusieurs espaces : le jeton de choix et l'espace retenu. 🔴 L'espace
   * demandé doit figurer dans la liste signée du jeton, sinon n'importe quel espace s'ouvrirait.
   */
  app.post('/auth/choose-workspace', async (req, reply) => {
    const b = (req.body ?? {}) as { choiceToken?: unknown; tenantId?: unknown };
    if (typeof b.choiceToken !== 'string' || typeof b.tenantId !== 'string' || b.choiceToken === '' || b.tenantId === '') {
      return reply.code(400).send({ error: 'choiceToken et tenantId requis' });
    }
    if (await freine(limiter, empreinteTentative(req, b.choiceToken), reply)) return reply;
    const choix = await verifyChoice(b.choiceToken, deps.secret);
    if (!choix) return reply.code(401).send({ error: 'choix expiré, reconnecte-toi' });
    const compte = choix.comptes.find((c) => c.tenantId === b.tenantId);
    if (!compte) return reply.code(403).send({ error: 'espace non autorisé pour cette adresse' });

    const token = await signSession({ userId: compte.userId, tenantId: compte.tenantId, role: compte.role }, deps.secret);
    marquerConnexion(deps.comptes, compte.userId);
    return reply.code(200).send({ token, user: { email: choix.email, role: compte.role, tenantId: compte.tenantId } });
  });

  // Config publique : le front en a besoin pour afficher (ou non) le bouton Google.
  app.get('/auth/config', async (_req, reply) => {
    return reply.code(200).send({ googleClientId: deps.googleClientId ?? '', googleEnabled: !!deps.googleClientId });
  });

  // Se connecter avec Google : vérifie le jeton ID, connecte un compte existant ou crée un espace (inconnu).
  app.post('/auth/google', async (req, reply) => {
    if (!deps.verifyGoogle || !deps.comptes?.getByEmail || !deps.comptes.createTenantWithAdmin) return reply.code(503).send({ error: 'connexion Google indisponible' });
    const corps = (req.body ?? {}) as { idToken?: unknown; ops?: unknown };
    const idToken = str(corps.idToken);
    if (idToken === '') return reply.code(400).send({ error: 'idToken requis' });
    // Clé sur l'idToken Google : borne les tentatives par jeton, plus de blocage transverse.
    if (await freine(googleLimiter, empreinteTentative(req, idToken), reply)) return reply;
    const entree = await entrerParGoogle(
      {
        verifyGoogle: deps.verifyGoogle,
        // Liées : le store est une classe (`PgUserStore`), une méthode détachée perd son `this` (500 du 2026-10-22).
        comptes: {
          getByEmail: deps.comptes.getByEmail.bind(deps.comptes),
          createTenantWithAdmin: deps.comptes.createTenantWithAdmin.bind(deps.comptes),
          touchLastLogin: deps.comptes.touchLastLogin?.bind(deps.comptes),
        },
      },
      idToken,
      corps.ops === true ? undefined : 'console',
    );
    if (entree.statut === 'invalide') return reply.code(401).send({ error: 'jeton Google invalide' });
    /**
     * L'exploitation par Google : Google prouve l'adresse, jamais le second facteur, qui reste exigé. Avant la
     * branche d'inscription : une adresse inconnue n'entre pas, et ne crée surtout pas d'espace.
     */
    if (corps.ops === true) {
      if (!deps.mfa) return reply.code(503).send({ error: 'double authentification indisponible' });
      if (entree.statut !== 'ouverte') return reply.code(403).send({ error: 'adresse non autorisée pour l’exploitation' });
      const actifs = entree.comptes;
      const facteur = actifs[0] ? await deps.mfa.lireParCompte(actifs[0].id) : null;
      if (!facteur) return reply.code(403).send({ error: 'adresse non autorisée pour l’exploitation' });
      const etape: EtapeConnexion = {
        identityId: facteur.identityId,
        email: entree.identite.email,
        comptes: actifs.map((c) => ({ userId: c.id, tenantId: c.tenantId, role: c.role })),
      };
      const ops = await entreeOps(deps, etape, facteur.secret !== null);
      return reply.code(ops.code).send(ops.corps);
    }
    if (entree.statut === 'revoquee') return reply.code(403).send({ error: 'compte révoqué' });
    if (entree.statut !== 'ouverte') throw new Error('entrée Google sans création malgré une origine');
    // Google a prouvé l'adresse ; la case cochée (`pub`) donne l'accord, et une identité neuve fait une inscription.
    if (deps.pub) {
      await apresEntree(deps.pub, { adresse: entree.identite.email, corps: req.body, nouvelle: entree.nouveau, prouvee: true, requete: req });
    }
    if (!entree.nouveau) {
      const actifs = entree.comptes;
      const [existing, ...autres] = actifs;
      if (!existing) throw new Error('entrée Google ouverte sans compte');
      if (autres.length > 0) {
        // Plusieurs espaces : on demande, comme `/auth/login` ; Google ne prouve que l'adresse, pas l'espace voulu.
        const choix = await signChoice(
          { email: entree.identite.email, comptes: actifs.map((c) => ({ userId: c.id, tenantId: c.tenantId, role: c.role })) },
          deps.secret,
        );
        return reply.code(200).send({
          choiceToken: choix,
          workspaces: actifs.map((c) => ({ tenantId: c.tenantId, tenantName: c.tenantName, role: c.role })),
        });
      }
      const jwt = await signSession({ userId: existing.id, tenantId: existing.tenantId, role: existing.role }, deps.secret);
      // Après le contrôle `disabled` : un compte révoqué ne doit pas être crédité d'une connexion qui n'a pas eu
      // lieu.
      marquerConnexion(deps.comptes, existing.id);
      return reply.code(200).send({ token: jwt, user: { email: entree.identite.email, role: existing.role, tenantId: existing.tenantId }, isNew: false });
    }
    const cree = entree.comptes[0];
    if (!cree) throw new Error('entrée Google créée sans compte');
    const jwt = await signSession({ userId: cree.id, tenantId: cree.tenantId, role: 'admin' }, deps.secret);
    // isNew:true : le front ouvre le tunnel de la Base (le numéro, puis la page finale `/demarrer`), ou la souscription
    // du Pro quand l'inscription vient du choix du Pro (`arriveeDUnNouvelEspace`, `web/lib/session.ts`).
    return reply.code(201).send({ token: jwt, user: { email: entree.identite.email, role: 'admin', tenantId: cree.tenantId }, isNew: true });
  });

  /**
   * La demande d'inscription d'une adresse INCONNUE (lot identité B) : rien ne se crée, un lien part. Dans cet ordre :
   * le refus d'exploitation, les dépendances, le défi anti-robot, UN comptage des trois plafonds, la demande, l'envoi
   * ATTENDU (un 202 sans e-mail bloquerait l'inscription en silence). Le mot de passe, le nom d'espace et le nom qu'une
   * console d'avant le lot envoie encore sont ignorés : ils se choisissent au clic, par qui a reçu le lien. Pas
   * d'`apresEntree` ici : l'accord publicitaire se donne au clic, lui aussi.
   */
  const demanderUnLien = async (req: FastifyRequest, reply: FastifyReply, email: string, corps: Record<string, unknown>): Promise<FastifyReply> => {
    // 🔴 Une adresse d'exploitation (`OPS_EMAILS`) ne naît jamais par l'inscription libre, même prouvée au clic : la
    // décision du lot laisse `/ops` tel quel, et l'invitation et Google restent ses portes. Même réponse qu'une adresse
    // déjà prise, pour ne pas dire qui est dans la liste ; aucune demande écrite, aucun e-mail.
    if (estAdresseOps(deps.opsEmails, email)) return reply.code(409).send(ADRESSE_DEJA_CONNUE);
    const comptes = deps.comptes;
    if (!comptes?.demanderInscription || !comptes.oublierDemande || !deps.sendEmail || !deps.appUrl) {
      return reply.code(503).send({ error: 'inscription par e-mail indisponible' });
    }
    if (deps.turnstile && !(await deps.turnstile.verifier(str(corps.turnstile), ipIndicative(req)))) {
      return reply.code(403).send({ error: 'La vérification anti-robot n’a pas abouti : réessayez.', code: 'defi' });
    }
    const plafonds = await compterDemande(compteur, email, req, deps.inscriptionPlafondHeure ?? PLAFOND_INSCRIPTIONS_PAR_HEURE);
    if (!plafonds.accepte) {
      await refuserTropDeRequetes(reply, plafonds.attenteMs, plafonds.message);
      return reply;
    }
    if (plafonds.totalDeLHeure === SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE) {
      void deps.alerter?.(`Inscriptions par e-mail : ${SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE} demandes de lien dans l'heure (refus au-delà de ${deps.inscriptionPlafondHeure ?? PLAFOND_INSCRIPTIONS_PAR_HEURE}).`)?.catch(() => {});
    }
    const demande = lireDemande(email, corps);
    const jeton = await comptes.demanderInscription(demande, DUREE_LIEN_INSCRIPTION_MS);
    try {
      await deps.sendEmail({ to: email, ...emailInscription(demande.langue, lienInscription(deps.appUrl, jeton, demande.langue)) });
    } catch (err) {
      // Le lien n'est pas parti : il ne doit rien confirmer. Le journal ne porte ni l'adresse ni le jeton.
      await comptes.oublierDemande(jeton).catch(() => {});
      journaliser('error', 'inscription_envoi_echec', { err });
      return reply.code(503).send({ error: 'L’e-mail n’a pas pu partir : réessayez dans un instant, ou continuez avec Google.' });
    }
    return reply.code(202).send({ lienEnvoye: true });
  };

  // Inscription libre. Une adresse INCONNUE reçoit un lien (`demanderUnLien`), et l'identité, l'espace et la session
  // naissent au clic (`/auth/signup/confirm`), l'adresse prouvée. Une adresse CONNUE qui donne son mot de passe ajoute un
  // espace tout de suite, puis la porte du second facteur ; sans mot de passe, 409, et la console le demande.
  app.post('/auth/signup', async (req, reply) => {
    // Sans magasin du second facteur, l'inscription ne pourrait pas lire l'état du facteur de l'identité qu'elle crée
    // (`lireParCompte`), donc ni son code ni son obligation ailleurs : refus avant de créer quoi que ce soit.
    if (!deps.comptes?.createTenantWithAdmin || !deps.mfa || !deps.comptes.motDePasseDeLAdresse) return reply.code(503).send({ error: 'inscription indisponible' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = str(b.email).trim().toLowerCase();
    const password = str(b.password);
    const name = str(b.name).trim() || null;
    if (!EMAIL_RE.test(email) || email.length > LONGUEUR_MAX_EMAIL) return reply.code(400).send({ error: 'email invalide' });
    if (await freine(signupLimiter, empreinteTentative(req, email), reply)) return reply;
    const existant = await deps.comptes.motDePasseDeLAdresse(email);
    if (existant === undefined) return demanderUnLien(req, reply, email, b);
    // 🔴 Une adresse déjà connue ne s'inscrit qu'avec son mot de passe : l'inscription réutilise son identité, et
    // sans cette vérification n'importe qui se rattacherait à l'identité d'un autre, puis changerait le mot de
    // passe de tous ses espaces. Une identité sans mot de passe (invitation en attente, Google) ne s'étend pas
    // par ici. Sans mot de passe du tout (l'étape de l'adresse de la console), le même 409 : la console demande alors
    // le mot de passe et le nom du nouvel espace.
    if (password === '') return reply.code(409).send(ADRESSE_DEJA_CONNUE);
    if (str(b.workspaceName).trim() === '') return reply.code(400).send({ error: 'nom de l\'espace requis' });
    // La même règle que le renommage (`src/user/nom-espace.ts`) : un nom de 500 Ko ou un saut de ligne
    // s'afficheraient tels quels dans l'écran de choix.
    const nomLu = nomEspace.safeParse(str(b.workspaceName));
    if (!nomLu.success) return reply.code(400).send({ error: MESSAGE_NOM_ESPACE_INVALIDE });
    const workspaceName = nomLu.data;
    if (password.length < MIN_MOT_DE_PASSE) return reply.code(400).send({ error: `mot de passe trop court (min ${MIN_MOT_DE_PASSE})` });
    if (existant === null || !(await verifyPassword(password, existant))) return reply.code(409).send(ADRESSE_DEJA_CONNUE);
    try {
      const { tenantId, userId } = await deps.comptes.createTenantWithAdmin(workspaceName, { email, name, passwordHash: await hashPassword(password) }, 'console');
      // L'inscription crée un admin d'un espace qui n'exige pas le second facteur (défaut de la migration 0230) : elle
      // rend la session, sauf si l'identité a déjà un facteur actif (son code) ou est admin d'un AUTRE espace qui
      // l'exige (l'enrôlement). La console lit les deux formes (`web/app/signup/page.tsx`).
      const facteur = await deps.mfa.lireParCompte(userId);
      if (!facteur) throw new Error('inscription : le compte créé n’a pas d’identité');
      const etape: EtapeConnexion = { identityId: facteur.identityId, email, comptes: [{ userId, tenantId, role: 'admin' }] };
      // Une identité existante : l'accord coché s'enregistre, sans inscription chez Meta (seule une identité neuve en fait une).
      if (deps.pub) await apresEntree(deps.pub, { adresse: email, corps: req.body, nouvelle: false, prouvee: false, requete: req });
      return reply.code(201).send(await apresLeMotDePasse(deps, etape, { actif: facteur.secret !== null, obligatoire: facteur.obligatoire }));
    } catch (err) {
      if (err instanceof DuplicateEmailError) return reply.code(409).send(ADRESSE_DEJA_CONNUE);
      throw err;
    }
  });

  /**
   * Le clic sur le lien d'inscription (lot identité B) : le nom de l'espace, le nom, le mot de passe et l'accord
   * publicitaire se choisissent ICI, par la personne qui a reçu l'e-mail. 🔴 Le jeton est relu AVANT le hachage du mot
   * de passe : un jeton inventé ne coûte qu'une requête indexée, jamais un scrypt. Les refus sont 400 et 409, jamais
   * 401 : la console viderait une autre session ouverte dans le même navigateur.
   */
  app.post('/auth/signup/confirm', async (req, reply) => {
    const comptes = deps.comptes;
    if (!comptes?.confirmerInscription || !comptes.inscriptionVivante || !deps.mfa) return reply.code(503).send({ error: 'inscription indisponible' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (await freine(confirmLimiter, empreinteTentative({ ip: reseauDuClient(req) }, 'confirmation'), reply)) return reply;
    const jeton = str(b.jeton);
    if (jeton === '' || jeton.length > LONGUEUR_MAX_JETON) return reply.code(400).send(LIEN_MORT);
    if (str(b.workspaceName).trim() === '') return reply.code(400).send({ error: 'nom de l\'espace requis' });
    const nomLu = nomEspace.safeParse(str(b.workspaceName));
    if (!nomLu.success) return reply.code(400).send({ error: MESSAGE_NOM_ESPACE_INVALIDE });
    const name = str(b.name).trim() || null;
    if (name !== null && name.length > LONGUEUR_MAX_NOM) return reply.code(400).send({ error: `nom trop long (${LONGUEUR_MAX_NOM} caractères au plus)` });
    const password = str(b.password);
    if (password.length < MIN_MOT_DE_PASSE) return reply.code(400).send({ error: `mot de passe trop court (min ${MIN_MOT_DE_PASSE})` });
    if (!(await comptes.inscriptionVivante(jeton))) return reply.code(400).send(LIEN_MORT);
    const r = await comptes.confirmerInscription(jeton, { workspaceName: nomLu.data, name, passwordHash: await hashPassword(password) });
    if (r.statut === 'lien_invalide') return reply.code(400).send(LIEN_MORT);
    if (r.statut === 'adresse_connue') {
      return reply.code(409).send({ error: 'Cette adresse a déjà un compte : connectez-vous.', code: REFUS_INSCRIPTION.adresseConnue });
    }
    const facteur = await deps.mfa.lireParCompte(r.userId);
    if (!facteur) throw new Error('inscription confirmée : le compte créé n’a pas d’identité');
    const etape: EtapeConnexion = { identityId: facteur.identityId, email: r.email, comptes: [{ userId: r.userId, tenantId: r.tenantId, role: 'admin' }] };
    // L'adresse est prouvée (le clic) et l'identité est neuve : l'accord DU CLIC s'enregistre et l'inscription part chez
    // Meta. Les identifiants du navigateur du clic passent devant ceux gardés avec la demande ; sans accord, rien.
    if (deps.pub) {
      const accord = lireChampPub(b);
      const corps = accord === null ? {} : { pub: { accord: true, fbc: accord.fbc ?? r.pubFbc ?? undefined, fbp: accord.fbp ?? r.pubFbp ?? undefined } };
      await apresEntree(deps.pub, { adresse: r.email, corps, nouvelle: true, prouvee: true, requete: req });
    }
    const suite = await apresLeMotDePasse(deps, etape, { actif: facteur.secret !== null, obligatoire: facteur.obligatoire });
    return reply.code(201).send({ ...suite, inscription: { offre: r.offrePro ? 'pro' : null, application: r.application, langue: r.langue } });
  });

  // Mot de passe perdu : toujours 200 (anti-énumération), un lien si le compte existe.
  app.post('/auth/forgot-password', async (req, reply) => {
    const email = str((req.body as { email?: unknown } | undefined)?.email).trim().toLowerCase();
    // Clé sur l'adresse. Le `take()` précède toute lecture : le seuil du 429 ne révèle pas l'existence du compte.
    if (await freine(forgotLimiter, empreinteTentative(req, email), reply)) return reply;
    const generic = { ok: true, message: 'Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.' };
    if (EMAIL_RE.test(email) && deps.tokens && deps.sendEmail && deps.appUrl) {
      try {
        // Le jeton vise un compte de l'adresse, mais `setPassword` écrit sur l'identité : le nouveau mot de passe
        // vaut pour tous ses espaces, l'utilisateur n'en ayant qu'un.
        const identite = await deps.users.findIdentity(email); // null si inconnue / sans mdp (Google-only)
        const user = identite?.comptes[0] ?? null;
        if (user) {
          const raw = await deps.tokens.create('reset', user.id, deps.resetTtlMs ?? 60 * 60 * 1000);
          // Envoi en fire-and-forget : la réponse ne dépend pas de la latence de Resend, qui trahirait une adresse
          // connue.
          void deps.sendEmail({
            to: email,
            subject: 'Réinitialiser ton mot de passe',
            text: `Tu as demandé à réinitialiser ton mot de passe.\n\nClique sur ce lien (valide 1 h) :\n${deps.appUrl}/reset/${raw}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
          }).catch(() => {});
        }
      } catch {
        // On ne révèle jamais une erreur ici (anti-énumération).
      }
    }
    return reply.code(200).send(generic);
  });

  // Réinitialisation : consomme le token (usage unique) et pose le nouveau mot de passe.
  app.post('/auth/reset-password', async (req, reply) => {
    if (!deps.tokens || !deps.comptes?.setPassword) return reply.code(503).send({ error: 'réinitialisation indisponible' });
    const b = (req.body ?? {}) as { token?: unknown; password?: unknown };
    const token = str(b.token);
    const password = str(b.password);
    if (token === '') return reply.code(400).send({ error: 'token requis' });
    // Clé sur le jeton (pas d'adresse ici) : borne le brute-force d'un lien sans bloquer les autres.
    if (await freine(resetLimiter, empreinteTentative(req, token), reply)) return reply;
    if (password.length < MIN_MOT_DE_PASSE) return reply.code(400).send({ error: `mot de passe trop court (min ${MIN_MOT_DE_PASSE})` });
    const userId = await deps.tokens.consume('reset', token);
    if (!userId) return reply.code(400).send({ error: 'lien invalide ou expiré' });
    await deps.comptes.setPassword(userId, await hashPassword(password));
    return reply.code(200).send({ ok: true });
  });

  // Acceptation d'invitation : consomme le token (usage unique), pose le mot de passe, puis la même porte que la
  // connexion (second facteur si dû, session sinon).
  app.post('/auth/invitations/accept', async (req, reply) => {
    if (!deps.tokens || !deps.comptes?.setPassword || !deps.comptes.getSessionUser || !deps.mfa) return reply.code(503).send({ error: 'invitations indisponibles' });
    const b = (req.body ?? {}) as { token?: unknown; password?: unknown };
    const token = str(b.token);
    const password = str(b.password);
    if (token === '') return reply.code(400).send({ error: 'token requis' });
    // Clé sur le jeton d'invitation : borne le brute-force d'un lien sans bloquer les autres.
    if (await freine(acceptLimiter, empreinteTentative(req, token), reply)) return reply;
    if (password.length < MIN_MOT_DE_PASSE) return reply.code(400).send({ error: `mot de passe trop court (min ${MIN_MOT_DE_PASSE})` });
    const userId = await deps.tokens.consume('invite', token);
    if (!userId) return reply.code(400).send({ error: 'invitation invalide ou expirée' });
    const su = await deps.comptes.getSessionUser(userId);
    if (!su) return reply.code(400).send({ error: 'invitation invalide ou expirée' });
    const facteur = await deps.mfa.lireParCompte(userId);
    if (!facteur) return reply.code(400).send({ error: 'invitation invalide ou expirée' });
    await deps.comptes.setPassword(userId, await hashPassword(password));
    // Accepter une invitation, c'est se connecter pour la première fois : même porte que la connexion. Une
    // invitation d'admin dans un espace qui exige le second facteur (ou une identité déjà admin d'un tel espace)
    // enrôle d'abord : le compte invité est actif, `obligatoire` le compte. Une identité qui a un facteur donne son code.
    const etape: EtapeConnexion = {
      identityId: facteur.identityId,
      email: su.email,
      comptes: [{ userId, tenantId: su.tenantId, role: su.role }],
    };
    return reply.code(200).send(await apresLeMotDePasse(deps, etape, {
      actif: facteur.secret !== null,
      obligatoire: facteur.obligatoire,
    }));
  });

  // Changement de mot de passe (compte connecté) : vérifie le mdp courant.
  app.post('/auth/change-password', { preHandler: garde }, async (req, reply) => {
    if (!deps.comptes?.getPasswordHash || !deps.comptes.setPassword) return reply.code(503).send({ error: 'indisponible' });
    const auth = req.auth;
    const userId = auth?.userId;
    if (!auth || !userId) return reply.code(401).send({ error: 'authentification requise' });
    const b = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    const current = str(b.currentPassword);
    const next = str(b.newPassword);
    if (next.length < MIN_MOT_DE_PASSE) return reply.code(400).send({ error: `mot de passe trop court (min ${MIN_MOT_DE_PASSE})` });
    const hash = await deps.comptes.getPasswordHash(userId);
    const ok = await verifyPassword(current, hash ?? DUMMY_HASH);
    if (!hash || !ok) return reply.code(401).send({ error: 'mot de passe actuel incorrect' });
    await deps.comptes.setPassword(userId, await hashPassword(next));
    // L'écriture a posé l'époque des sessions : toutes celles de l'identité tombent, celle-ci comprise. Une session neuve,
    // signée APRÈS, garde connecté qui vient de changer son mot de passe ; la console la range (`web/app/compte`).
    const token = await signSession({ userId: auth.userId, tenantId: auth.tenantId, role: auth.role }, deps.secret);
    return reply.code(200).send({ ok: true, token });
  });

  // Le second facteur : routes d'étape (avant session) et de la page Compte. La suite leur est passée, pas
  // recopiée : la même fonction que pour `/auth/login`.
  registerMfa(app, deps, garde, (etape, options) => suiteDeConnexion(deps, etape, options));
}
