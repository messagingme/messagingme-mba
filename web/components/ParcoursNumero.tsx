'use client';

import { ValidationConnexion, VALIDATION_BOUTON } from '@/components/ValidationConnexion';
import { AideErreurMeta } from '@/components/AideErreurMeta';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Bouton, classesBouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { useT } from '@/lib/i18n';
import { useConnexionNumero } from '@/lib/connexion-numero';
import type { ApiConnexionNumero } from '@/lib/api/connexion-numero';
import { COEXISTENCE_BOUTON, COEXISTENCE_PHRASES, FENETRE_BLOQUEE } from '@/lib/fenetre-meta';
import { repriseDuNumeroFourni } from '@/lib/lien-numero';
import { ETAPES_NUMERO_FOURNI, SI_SEUL_TEXT_MESSAGE } from '@/lib/partage/etapes-numero-fourni';
import { PREREQUIS_META } from '@/lib/partage/etapes-meta';
import { ETAPES_COMPTE_FOURNI } from '@/lib/partage/etapes-application';
import { AIDE_NUMERO_FOURNI } from '@/lib/partage/aide-connexion';
import { QrApplication } from '@/components/QrApplication';
import {
  BULLE_WHATSAPP_BUSINESS, DEPLOIEMENT_SECOND, ETAPES_A_VENIR, ISSUE_API, ISSUE_FOURNI, ISSUE_FOURNI_APPLICATION, ISSUE_INSTALLER, LOGO_WHATSAPP_BUSINESS,
  MAGASINS_APPLICATION, META_BUSINESS_URL, NOTE_CARTE_APPLICATION, NOTE_INSTALLER_APPLICATION, NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE, QUESTION_APPLICATION,
  QUESTION_COMPTE, QUESTION_DEPLOIEMENT, QUESTION_FOURNIR, QUESTION_MEME_NUMERO, QUESTION_NUMERO, QUESTION_NUMERO_APPLICATION, SUITE_FOURNI_APPLICATION,
  WHATSAPP_ORDINAIRE, type ReponseCompte,
} from '@/lib/questions-numero';

/** Les choix du parcours : le mode du lien de Claude Code, ou celui que les questions de la console ont fait. */
type Choix = 'fourni' | 'apporte' | 'coexistence' | 'fourni_application';

/**
 * « Avant de commencer, chez Meta » : les conditions d'une fenêtre de Meta, numérotées. Le parcours le pose avant ses
 * fenêtres, et la voie « J’utilise un numéro existant » du Crédit WhatsApp aussi (`QuiRegleMeta`), depuis les mêmes sources.
 */
export function EncadreChezMeta({ prerequis }: { prerequis: ReadonlyArray<{ readonly fr: string; readonly en: string }> }) {
  const t = useT();
  return (
    <div data-testid="prerequis-meta" className="mt-6 rounded-carte border border-ink-200 bg-ink-50 p-5">
      <div className="text-sm font-semibold text-ink-900">{t('Avant de commencer, chez Meta', 'Before you start, at Meta')}</div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
        {prerequis.map((e) => <li key={e.fr}>{t(e.fr, e.en)}</li>)}
      </ol>
    </div>
  );
}

/**
 * LE PARCOURS DE CONNEXION DU NUMÉRO (lot 3b, sorti de `/connecter-whatsapp` au lot 3c pour servir aussi `/brancher`).
 *
 * Sans choix déjà fait, il pose d'abord les questions du tunnel de la vitrine (2026-10-30, `@/lib/questions-numero`) :
 * « Avez-vous un compte Meta Business ? », Oui menant aux deux choix du numéro API ; Non ou « Je ne sais pas » à
 * « Avez-vous déjà l'application WhatsApp Business ? ». Oui demande si un numéro y fonctionne (lot 3 du 2026-11-17) :
 * Oui, « Voulez-vous utiliser ce numéro-là ? » (le cas 4), dont Oui la garde ; Non, ou aucun numéro dedans, « Souhaitez-vous
 * qu'on vous fournisse un numéro ? » : Oui, un numéro de chez nous mis DANS l'application (`fourni_application`), Non, un
 * numéro à soi qu'on y installe ; les deux la gardent ensuite. Non ne la fait plus télécharger (Julien, 2026-11-12) :
 * « Avez-vous déjà un numéro que vous pourriez utiliser ? », Oui menant au numéro API (comme avec un compte), Non à un
 * numéro de chez nous, relié par la fenêtre de Meta, qui crée le compte en chemin. Un numéro qui sert dans WhatsApp,
 * l'application ordinaire, passe dans WhatsApp Business et se garde, jamais vers un autre numéro. La carte s'affiche sous
 * la question. Plus aucune voie par QR code. « Qui paie vos messages à Meta ? »
 * vient avant, posée par la page (`QuiRegleMeta`, lot B du Crédit WhatsApp) : ce guide est la voie de la carte chez Meta,
 * et chaque voie qui garde l'application le dit (`NOTE_CARTE_APPLICATION`).
 *
 * Les trois choix où elles mènent. « Fournissez-moi un numéro » : un numéro de notre réserve s'affiche ; le client le
 * tape dans la fenêtre de Meta, et reçoit le code par l'appel, l'étape `insiste` mise en gras (lot 2c, décision de
 * Julien du 2026-11-09) ; le SMS seulement si la fenêtre ne propose rien d'autre (la ligne fixe le lit à voix haute).
 * Notre Asterisk capte le code dans les deux cas, et le parcours l'affiche pour qu'il le recopie. Les étapes affichées sont
 * celles que Claude redit (`ETAPES_NUMERO_FOURNI`, essai réel 99). « J'ai déjà un numéro » : la fenêtre de Meta, comme depuis l'Accueil.
 * « Garder mon application WhatsApp Business » : la même fenêtre en coexistence (plan 2026-10-24), le numéro reste dans
 * l'application.
 *
 * Il ne connaît pas son autorité : `api` est celle de la session de la console ou celle du lien de Claude Code
 * (`@/lib/api/connexion-numero`). La page décide de ce qu'on voit une fois le numéro connecté.
 *
 * ⚠️ EN v4, RIEN NE FAIT SAUTER L'ÉCRAN DU NUMÉRO DE LA FENÊTRE DE META (mesuré le 2026-10-06) : le client y tape donc
 * le numéro, d'où les consignes. La fenêtre vérifie le code, puis la suite actuelle relie et active le numéro.
 */
export function ParcoursNumero({ tenantId, api, choixInitial, connecte, retour, surConnexion, filiere = 'api', parLaLigne = false, surOccupe }: {
  tenantId: string;
  api: ApiConnexionNumero;
  /**
   * La fenêtre de Meta de ce parcours s'ouvre ou se ferme (jaune de la relecture du lot 3v-1) : `QuiRegleMeta` ferme alors
   * les gestes qui démonteraient ce parcours, et avec lui la connexion en cours. Un setter d'état, d'identité stable.
   */
  surOccupe?: (occupe: boolean) => void;
  /**
   * Le numéro fourni du Crédit WhatsApp (« J’ai besoin d’un numéro », lot 3v) : la fenêtre de Meta s'ouvre avec la solution du
   * partenaire, que la configuration ne rend qu'à un espace qui a droit à la ligne, et la fin passe par la ligne
   * (`connect({ parLaLigne: true })`). Seulement avec `choixInitial` à `fourni`, jamais `fourni_application`.
   * `si-ouverte` (le lien de Claude, `/brancher`, lot 3v-2b) : la même fenêtre dès que la configuration rend la solution
   * du partenaire (l'option payée, aucun numéro), en `apporte` comme en `fourni`, jamais en gardant l'application.
   */
  parLaLigne?: boolean | 'si-ouverte';
  /**
   * `application` : la filière de l'application WhatsApp Business (2026-10-22), ouverte par le lien de Claude Code. Le
   * numéro se relie par un QR code scanné depuis le téléphone, à la place de la fenêtre de Meta. Absente : l'API.
   */
  filiere?: 'api' | 'application';
  /** Où Stripe renvoie après le paiement : cette page-ci (`/brancher` ou `/connecter-whatsapp`). */
  retour: 'brancher' | 'console';
  /** Le choix déjà fait (le mode du lien de Claude Code), ou `null` pour poser d'abord les questions du tunnel. */
  choixInitial: Choix | null;
  /** Le numéro est connecté : la lecture du code s'arrête. */
  connecte: boolean;
  /** La fenêtre de Meta a relié le compte : ses avertissements, à afficher par la page. */
  surConnexion(avertissements: string[]): void;
}) {
  const t = useT();
  const [choix, setChoix] = useState<Choix | null>(choixInitial);
  const [numero, setNumero] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  /** L'application WhatsApp a appelé le numéro fourni, hors de la voie de l'application (2026-11-17). */
  const [appelApplication, setAppelApplication] = useState(false);
  const [copie, setCopie] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** L'abonnement du numéro (lot 3c) : `undefined` tant qu'il n'est pas lu (ou sur une API sans la route). */
  const [abonnement, setAbonnement] = useState<{ statut: string } | null | undefined>(undefined);
  /** Retour de la page de Stripe (`?abonnement=recu`) : la confirmation arrive par le webhook, on ne repaie pas. */
  const [paiementRecu, setPaiementRecu] = useState(false);
  /** Le numéro vient d'être rendu (« Abandonner ») alors que l'abonnement court : il ne se « prépare » pas. */
  const [rendu, setRendu] = useState(false);
  /** La fin de l'abonnement est programmée à la fin de la période payée (lot 4, livraison B). */
  const [finProgrammee, setFinProgrammee] = useState(false);
  /** Un Pro vivant inclut le numéro (lot 6, B2b) : il s'obtient sans payer. Faux tant qu'il n'est pas lu. */
  const [inclus, setInclus] = useState(false);
  /** Le Pro est en essai (lot 2 du 2026-11-17) : le numéro se paie, ses 3,50 € se déduisent du premier mois de Pro. */
  const [essaiPro, setEssaiPro] = useState(false);
  /** Filière application, numéro fourni : le QR code s'affiche une fois le compte créé dans l'application. */
  const [qrDemande, setQrDemande] = useState(false);
  /** La réponse à « Avez-vous un compte Meta Business ? » : gardée quand « Retour » ramène aux questions. */
  const [compte, setCompte] = useState<ReponseCompte | null>(null);
  /** La réponse à « Avez-vous déjà l'application WhatsApp Business ? ». */
  const [appli, setAppli] = useState<'oui' | 'non' | null>(null);
  /** La réponse à « Avez-vous déjà un numéro que vous pourriez utiliser ? » (après le choix de l'API, lot 4 du 2026-11-17). */
  const [numeroPerso, setNumeroPerso] = useState<'oui' | 'non' | null>(null);
  /** La réponse à « Avez-vous déjà un numéro qui fonctionne sur cette application ? » (après « Oui », lot 3 du 2026-11-17). */
  const [numeroAppli, setNumeroAppli] = useState<'oui' | 'non' | null>(null);
  /** La réponse à « Voulez-vous utiliser ce numéro-là ? » (après « Oui » au numéro de l'application, le cas 4, lot 3a). */
  const [memeNumero, setMemeNumero] = useState<'oui' | 'non' | null>(null);
  /** La réponse à « Comment voulez-vous utiliser WhatsApp ? » (lot 4 du 2026-11-17), une seule ouverte à la fois. */
  const [deploiement, setDeploiement] = useState<'application' | 'api' | null>(null);
  /** La réponse à « Souhaitez-vous qu'on vous fournisse un numéro ? » (lot 3 du 2026-11-17). */
  const [fournir, setFournir] = useState<'oui' | 'non' | null>(null);
  const repondreCompte = (r: ReponseCompte) => { setCompte(r); setAppli(null); setNumeroAppli(null); setMemeNumero(null); setDeploiement(null); setFournir(null); setNumeroPerso(null); };
  const repondreAppli = (r: 'oui' | 'non') => { setAppli(r); setNumeroAppli(null); setMemeNumero(null); setDeploiement(null); setFournir(null); setNumeroPerso(null); };
  const repondreNumeroAppli = (r: 'oui' | 'non') => { setNumeroAppli(r); setMemeNumero(null); setDeploiement(null); setFournir(null); setNumeroPerso(null); };
  const repondreMemeNumero = (r: 'oui' | 'non') => { setMemeNumero(r); setDeploiement(null); setFournir(null); setNumeroPerso(null); };
  const repondreDeploiement = (r: 'application' | 'api') => { setDeploiement(r); setFournir(null); setNumeroPerso(null); };
  /**
   * Chaque nouvelle question vient à l'écran (Julien, 2026-11-17, lot 4 : « on est obligé de scroller à la main ») : le
   * dernier élément de l'arbre, après chaque réponse, sans animation pour qui la refuse. Rien au chargement.
   */
  const arbre = useRef<HTMLDivElement>(null);
  const reponses = [compte, appli, numeroAppli, memeNumero, deploiement, fournir, numeroPerso].join('|');
  useEffect(() => {
    if (compte === null) return;
    const dernier = arbre.current?.lastElementChild;
    if (!(dernier instanceof HTMLElement)) return;
    const sansAnimation = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    dernier.scrollIntoView({ behavior: sansAnimation ? 'auto' : 'smooth', block: 'nearest' });
  }, [reponses, compte]);
  /**
   * Retient la voie chez le serveur (lot 3 du 2026-11-17) : le code de l'application ne se montre que sur la voie de
   * l'application (la garde du lot 1). La session de la console seule : le lien de Claude arrive avec sa voie retenue.
   */
  const retenir = (destination: 'api' | 'application'): Promise<unknown> => Promise.resolve(api.retenirDestination?.(destination));
  /**
   * Ouvre le numéro fourni par la fenêtre de Meta, et le garde pour le retour de Stripe et le rechargement
   * (`varianteGardee`). Sans attendre la voie : sur la fenêtre de Meta, un échec ne cache aucun code.
   */
  const choisirFourni = () => { void retenir('api').catch(() => {}); garderVariante(tenantId, 'fourni'); setChoix('fourni'); };
  /**
   * Ouvre le numéro fourni mis DANS l'application WhatsApp Business, puis gardée (lot 3 du 2026-11-17). 🔴 La voie est
   * retenue AVANT d'avancer (relecture du lot 3) : sans elle, la garde du lot 1 cacherait le code de l'application, et la
   * page l'attendrait sans fin, numéro payé. Un refus (une API d'avant la route, le réseau) se dit, et rien n'avance.
   */
  const choisirFourniApplication = () => {
    setErreur(null);
    void retenir('application').then(
      () => { garderVariante(tenantId, 'fourni_application'); setChoix('fourni_application'); },
      () => setErreur(t(
        'Ce choix n’a pas pu être enregistré. Réessayez dans quelques minutes.',
        'This choice could not be saved. Try again in a few minutes.',
      )),
    );
  };
  const application = filiere === 'application';
  /** Le numéro fourni, saisi dans la fenêtre de Meta (`fourni`) ou mis dans l'application WhatsApp Business (plan 2026-10-31). */
  const fourni = choix === 'fourni' || choix === 'fourni_application';
  /** Le numéro fourni va dans l'application : relié par le QR code (filière application), ou gardé en coexistence. */
  const dansApplication = application || choix === 'fourni_application';
  const connexion = useConnexionNumero(tenantId, api, surConnexion);
  const ligne = parLaLigne === true || (parLaLigne === 'si-ouverte' && filiere === 'api'
    && (connexion.cfg?.solutionId ?? null) !== null && (choix === 'apporte' || choix === 'fourni'));
  /** Le lien de Claude, la configuration pas encore lue : ni les conditions de la carte, ni celles de la ligne. */
  const conditionsEnLecture = parLaLigne === 'si-ouverte' && connexion.cfg === null;
  useEffect(() => { surOccupe?.(connexion.busy); }, [connexion.busy, surOccupe]);
  useEffect(() => () => { surOccupe?.(false); }, [surOccupe]);
  /**
   * La course d'un geste et d'une lecture (jaune 5 de la relecture de la livraison B) : une lecture partie AVANT
   * « Remplacer » revient avec l'ancien numéro ou son code. Chaque geste change de génération à son début et à sa fin,
   * et une lecture n'est appliquée que si la génération n'a pas bougé depuis son départ ni un geste n'est en cours.
   */
  const generation = useRef(0);
  const enGeste = useRef(false);
  const fraiche = (depart: number) => depart === generation.current && !enGeste.current;

  useEffect(() => {
    const recu = new URLSearchParams(window.location.search).get('abonnement') === 'recu';
    setPaiementRecu(recu);
    // Retour de Stripe : le client vient de payer le numéro fourni, il ne le rechoisit pas.
    if (recu) setChoix((c) => c ?? varianteGardee(tenantId));
  }, []);

  // Tant qu'un numéro fourni n'est pas là, l'abonnement et le numéro se relisent : le webhook les écrit ensemble.
  useEffect(() => {
    if (!fourni || numero !== null || connecte) return undefined;
    let vivant = true;
    const lire = () => {
      const depart = generation.current;
      api.etat().then((r) => {
        if (!vivant || !fraiche(depart)) return;
        setAbonnement(r.etat.abonnement);
        setInclus(r.etat.inclusDansLePro === true);
        setEssaiPro(r.etat.essaiPro === true);
        if (r.etat.fourni) { setNumero(r.etat.fourni); setCode(r.etat.code?.code ?? null); }
      }).catch(() => {});
    };
    lire();
    const minuterie = setInterval(lire, INTERVALLE_CODE_MS);
    return () => { vivant = false; clearInterval(minuterie); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choix, numero, connecte, tenantId]);

  // Au retour sur la page (rechargement, onglet rouvert), un numéro déjà attribué reprend où il en était, sauf sur un lien
  // de coexistence (`repriseDuNumeroFourni`). Une API qui n'a pas encore la route rend une erreur : le parcours reste au
  // choix, sans message.
  useEffect(() => {
    const depart = generation.current;
    api.lire().then((r) => {
      const reprise = repriseDuNumeroFourni(choixInitial, r);
      if (reprise && fraiche(depart)) {
        dernierRecuLe.current = r.codeRecuLe;
        setNumero(reprise.numero); setCode(reprise.code);
        // La variante du lien de Claude, sinon celle que la console a gardée dans l'onglet.
        setChoix(choixInitial === 'fourni_application' ? 'fourni_application' : choixInitial === null ? varianteGardee(tenantId) : 'fourni');
      }
    }).catch(() => {});
    // L'abonnement, même quand un numéro est déjà là : le portail et le texte après « Abandonner » en dépendent.
    api.etat().then((r) => {
      if (fraiche(depart)) { setAbonnement(r.etat.abonnement); setInclus(r.etat.inclusDansLePro === true); setEssaiPro(r.etat.essaiPro === true); }
    }).catch(() => {});
    // `api` change d'identité à chaque rendu de la page : l'espace suffit à dire qu'il faut relire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /**
   * La fenêtre de Meta rouverte, l'encadré repart à zéro (essai 263, Julien, 2026-11-16 : le « vieux code » restait
   * affiché, « ça porte à confusion »). On retient le code lu à l'ouverture, par sa date de réception chez nous, et on
   * ne montre ensuite qu'un code reçu DEPUIS : une date du serveur comparée à elle-même, jamais à l'horloge du poste.
   */
  const dernierRecuLe = useRef<string | null>(null);
  const codeAvantOuverture = useRef<string | null>(null);
  const ouvrir = () => {
    codeAvantOuverture.current = dernierRecuLe.current;
    setCode(null);
    void connexion.connect(ligne ? { parLaLigne: true } : {});
  };

  // Le code se lit en boucle tant qu'un numéro fourni attend sa connexion.
  useEffect(() => {
    if (!fourni || numero === null || connecte) return undefined;
    const minuterie = setInterval(() => {
      const depart = generation.current;
      api.lire().then((r) => {
        if (!fraiche(depart)) return;
        dernierRecuLe.current = r.codeRecuLe;
        setCode(r.codeRecuLe !== null && r.codeRecuLe === codeAvantOuverture.current ? null : r.code);
        setAppelApplication(r.appelApplication === true);
      }).catch(() => {});
    }, INTERVALLE_CODE_MS);
    return () => clearInterval(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choix, numero, connecte, tenantId]);

  const geste = async (f: () => Promise<void>) => {
    generation.current += 1;
    enGeste.current = true;
    setEnCours(true);
    setErreur(null);
    try { await f(); } catch (err) { setErreur(err instanceof Error ? err.message : t('Une erreur est survenue', 'Something went wrong')); }
    finally { generation.current += 1; enGeste.current = false; setEnCours(false); }
  };
  const abonne = abonnement !== undefined && abonnement !== null && abonnement.statut !== 'resilie';
  const obtenir = () => geste(async () => { setNumero((await api.obtenir()).numero); setCode(null); setRendu(false); });
  const remplacer = () => geste(async () => { setNumero(null); setCode(null); setNumero((await api.remplacer()).numero); });
  const abandonner = () => geste(async () => {
    const r = await api.abandonner();
    setNumero(null); setCode(null); setChoix(choixInitial); setRendu(true); setFinProgrammee(r.finProgrammee === true);
  });
  const payer = () => geste(async () => { window.location.assign((await api.payer(retour)).url); });
  // Le portail se gère depuis la console ; sur la page du lien, c'est Claude qui résilie.
  const portail = api.portail !== undefined && abonnement !== undefined && abonnement !== null
    ? <BoutonPortail api={api} />
    : null;
  const copier = async () => {
    if (!numero) return;
    try { await navigator.clipboard.writeText(numero); setCopie(true); } catch { setCopie(false); }
  };

  // Par la ligne (lot 3v), la fenêtre attend la solution du partenaire : sans elle, rien ne s'ouvre par la carte chez Meta.
  const pret = connexion.cfg?.enabled === true && (!ligne || (connexion.cfg.solutionId ?? null) !== null);
  const boutonFenetre = (
    <Bouton type="button" enCours={connexion.busy} disabled={!pret || connexion.busy} onClick={ouvrir} data-testid="ouvrir-fenetre-meta">
      {connexion.validation ? t(VALIDATION_BOUTON.fr, VALIDATION_BOUTON.en) : connexion.busy ? t('Fenêtre de Meta ouverte…', 'Meta window open…') : t('Ouvrir la fenêtre de Meta', 'Open the Meta window')}
    </Bouton>
  );
  // Le numéro fourni par la fenêtre de Meta, en vidéo (lot 6 de l'aide à la connexion) : pas pour l'application, ni pour
  // la ligne, dont la fenêtre n'est pas celle que montre le film.
  const lienVideo = !dansApplication && !ligne ? (
    <a data-testid="video-numero-fourni" href={t(AIDE_NUMERO_FOURNI.fr, AIDE_NUMERO_FOURNI.en)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
      {t('Voir la vidéo (3 min)', 'Watch the video (3 min)')}
    </a>
  ) : null;
  // Le lien de Claude Code arrive avec son choix : pas de retour vers un choix qu'il n'a pas proposé.
  const boutonRetour = choixInitial === null
    ? <Bouton type="button" variante="discret" onClick={() => setChoix(null)}>{t('Retour', 'Back')}</Bouton>
    : null;
  // En coexistence, le numéro RESTE dans l'application : la 3e condition (un numéro, le nôtre sinon) n'y apprend rien,
  // et le compte Meta Business, sa carte le dit elle-même, la fenêtre de Meta le crée en chemin. Reste ce qu'il est ;
  // le téléphone, qui scanne le code QR, se dit dans les étapes de la fenêtre (`ETAPES_FENETRE_GARDER`).
  // Le numéro fourni mis dans l'application y reste aussi : même chose. Au numéro fourni par la fenêtre de Meta, la
  // condition d'un numéro à soi n'a plus de sens : il vient d'en choisir un, comme Claude le tait (jaune 10 du lot 3a).
  // Par la fenêtre du partenaire (lot 3v), ni carte ni moyen de paiement : les mêmes conditions sans eux.
  // « J’utilise un numéro existant » par la ligne (lot 3v-2b, comme la carte de `QuiRegleMeta`) : son numéro et le téléphone qui le porte.
  const prerequis = ligne ? (choix === 'apporte' ? [...PREREQUIS_LIGNE, NUMERO_LIGNE_MIEN] : PREREQUIS_LIGNE)
    : choix === 'coexistence' || choix === 'fourni_application' ? PREREQUIS_META.slice(0, 1)
      : choix === 'fourni' ? PREREQUIS_META.slice(0, 2) : PREREQUIS_META;
  const boutonCoexistence = (
    <Bouton type="button" enCours={connexion.busy} disabled={!pret || connexion.busy} onClick={() => { void connexion.connect({ coexistence: true }); }} data-testid="ouvrir-fenetre-coexistence">
      {connexion.validation ? t(VALIDATION_BOUTON.fr, VALIDATION_BOUTON.en) : connexion.busy ? t('Fenêtre de Meta ouverte…', 'Meta window open…') : t(COEXISTENCE_BOUTON.fr, COEXISTENCE_BOUTON.en)}
    </Bouton>
  );
  /**
   * La carte qui garde l'application WhatsApp Business : ouverte par un lien de Claude, par « Vous pouvez le garder », ou
   * sous la question de l'application. `ordinaire` : le numéro peut servir dans WhatsApp, l'application ordinaire (lot
   * 3a) ; la carte dit qu'il passe dans WhatsApp Business, à installer sur le même téléphone (ses deux magasins). Sans
   * objet quand on vient de répondre que le numéro est déjà dans WhatsApp Business.
   */
  /** Les deux magasins de WhatsApp Business : sous WhatsApp ordinaire, sous « l'installer d'abord », dans sa bulle. */
  const magasins = (
    <span className="mt-3 flex flex-wrap gap-2">
      {MAGASINS_APPLICATION.map((m) => (
        <a key={m.href} href={m.href} target="_blank" rel="noopener noreferrer" className={classesBouton('secondaire', 'petite')}>
          <Icone nom={m.icone} taille="petite" />
          {t(m.libelle.fr, m.libelle.en)}
        </a>
      ))}
    </span>
  );
  const carteCoexistence = (retour: ReactNode, ordinaire: boolean) => (
    <div data-testid="choix-coexistence-ouvert" className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
      {ordinaire && (
        <div data-testid="whatsapp-ordinaire" className="mb-4">
          <p className="text-sm text-ink-700">{t(WHATSAPP_ORDINAIRE.fr, WHATSAPP_ORDINAIRE.en)}</p>
          {magasins}
        </div>
      )}
      <div className="flex items-center gap-3">
        {boutonCoexistence}
        {retour}
      </div>
      {COEXISTENCE_PHRASES.map((p) => <p key={p.fr} className="mt-3 text-sm text-ink-700">{t(p.fr, p.en)}</p>)}
      {/* Garder l'application, c'est payer Meta avec sa carte (révision du Crédit WhatsApp, décision 8). */}
      <p data-testid="note-carte-application" className="mt-3 text-sm text-ink-700">{t(NOTE_CARTE_APPLICATION.fr, NOTE_CARTE_APPLICATION.en)}</p>
    </div>
  );
  /**
   * Un numéro de chez nous : relié par la fenêtre de Meta (`choisirFourni`, sans compte, ni application, ni numéro, depuis
   * le 2026-11-12), ou mis DANS l'application puis gardée (`choisirFourniApplication`, lot 3 du 2026-11-17). Le même bouton,
   * la même suite que « Fournissez-moi un numéro » du numéro API. `gardeLApplication` : comme chaque voie qui garde
   * l'application, la carte dit qu'on y paie Meta avec sa carte (`NOTE_CARTE_APPLICATION`).
   */
  const carteNumeroDeChezNous = (testid: string, issue: { titre: Texte; texte: Texte; suite?: Texte }, testidBouton: string, choisir: () => void, gardeLApplication = false) => (
    <div data-testid={testid} className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
      <div className="text-base font-semibold text-ink-900">{t(issue.titre.fr, issue.titre.en)}</div>
      <p className="mt-2 text-sm text-ink-700">{t(issue.texte.fr, issue.texte.en)}</p>
      {issue.suite && <p className="mt-2 text-sm text-ink-700">{t(issue.suite.fr, issue.suite.en)}</p>}
      {gardeLApplication && <p data-testid="note-carte-application" className="mt-2 text-sm text-ink-700">{t(NOTE_CARTE_APPLICATION.fr, NOTE_CARTE_APPLICATION.en)}</p>}
      <Bouton type="button" className="mt-4" onClick={choisir} data-testid={testidBouton}>
        {t('Fournissez-moi un numéro', 'Provide me a number')}
      </Bouton>
    </div>
  );
  /**
   * Le numéro API : avec un compte Meta Business, le sien ou un numéro fourni ; après « Oui » à « un numéro que vous
   * pourriez utiliser » (`seulementLeSien`, Julien, 2026-11-17, lot 4 : « il ne faut pas lui proposer de lui fournir un
   * numéro »), le sien seul. Et la ligne qui rappelle qu'on peut garder son application.
   */
  const issueApi = (seulementLeSien: boolean) => (
    <div data-testid="issue-api">
      <div className="text-sm font-semibold text-ink-900">{t(ISSUE_API.titre.fr, ISSUE_API.titre.en)}</div>
      <div className={`mt-2 grid gap-3 ${seulementLeSien ? '' : 'sm:grid-cols-2'}`}>
        {!seulementLeSien && (
          <button type="button" data-testid="choix-fourni" onClick={choisirFourni} className="rounded-carte border border-ink-200 bg-white p-5 text-left hover:border-ink-400">
            <div className="text-base font-semibold text-ink-900">{t('Fournissez-moi un numéro', 'Provide me a number')}</div>
            <p className="mt-1 text-xs text-ink-500">
              {inclus
                ? t('Un numéro dédié, prêt pour WhatsApp. Inclus dans votre offre.', 'A dedicated number, ready for WhatsApp. Included in your plan.')
                : essaiPro
                ? t(ESSAI_PRO_CARTE.fr, ESSAI_PRO_CARTE.en)
                : t('Un numéro dédié, prêt pour WhatsApp : 3,50 € HT par mois.', 'A dedicated number, ready for WhatsApp: €3.50 excl. VAT per month.')}
            </p>
          </button>
        )}
        <button type="button" data-testid="choix-apporte" onClick={() => setChoix('apporte')} className="rounded-carte border border-ink-200 bg-white p-5 text-left hover:border-ink-400">
          <div className="text-base font-semibold text-ink-900">{t('J’ai déjà un numéro', 'I already have a number')}</div>
          <p className="mt-1 text-xs text-ink-500">{t('Vous le saisissez dans la fenêtre de Meta et recevez son code.', 'You enter it in the Meta window and receive its code.')}</p>
        </button>
      </div>
      <p className="mt-3 text-sm text-ink-700">
        {t(ISSUE_API.garder.fr, ISSUE_API.garder.en)}{' '}
        <button type="button" data-testid="choix-coexistence" onClick={() => setChoix('coexistence')} className="font-semibold text-ink-900 underline">
          {t(ISSUE_API.lien.fr, ISSUE_API.lien.en)}
        </button>
      </p>
    </div>
  );
  /**
   * « Comment voulez-vous utiliser WhatsApp ? » et sa suite (Julien, 2026-11-17, lot 4). `sans` : sans l'application,
   * qu'on installe d'abord si on la choisit ; `vide` : l'application, sans numéro dedans ; `second` : un 2e compte dans
   * l'application, pour un autre numéro que le sien. L'application mène à « Souhaitez-vous qu'on vous fournisse un
   * numéro ? », l'API à « Avez-vous déjà un numéro que vous pourriez utiliser ? », dont « Oui » ne propose que le sien.
   */
  const suiteDeploiement = (variante: VarianteDeploiement) => (
    <>
      <QuestionDeploiement variante={variante} choisie={deploiement} choisir={repondreDeploiement} />
      {deploiement === 'application' && variante === 'sans' && (
        <div data-testid="note-installer-application" className="text-sm text-ink-700">
          <p>{t(NOTE_INSTALLER_APPLICATION.fr, NOTE_INSTALLER_APPLICATION.en)}</p>
          {magasins}
        </div>
      )}
      {deploiement === 'application' && (
        <Question
          testid="question-fournir"
          texte={QUESTION_FOURNIR.texte}
          precision={QUESTION_FOURNIR.precision}
          choisie={fournir}
          reponses={(['oui', 'non'] as const).map((r) => ({ cle: r, libelle: QUESTION_FOURNIR[r], choisir: () => setFournir(r) }))}
        />
      )}
      {deploiement === 'application' && fournir === 'oui'
        && carteNumeroDeChezNous('issue-fourni-application', ISSUE_FOURNI_APPLICATION, 'choix-fourni-application', choisirFourniApplication, true)}
      {deploiement === 'application' && fournir === 'non' && (
        <div data-testid="issue-installer">
          <div className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
            <div className="text-base font-semibold text-ink-900">{t(ISSUE_INSTALLER.titre.fr, ISSUE_INSTALLER.titre.en)}</div>
            <p className="mt-2 text-sm text-ink-700">{t(ISSUE_INSTALLER.texte.fr, ISSUE_INSTALLER.texte.en)}</p>
            <p className="mt-2 text-sm text-ink-700">{t(ISSUE_INSTALLER.suite.fr, ISSUE_INSTALLER.suite.en)}</p>
          </div>
          {carteCoexistence(null, false)}
        </div>
      )}
      {deploiement === 'api' && (
        <Question
          testid="question-numero"
          texte={QUESTION_NUMERO.texte}
          precision={QUESTION_NUMERO.precision}
          choisie={numeroPerso}
          reponses={(['oui', 'non'] as const).map((r) => ({ cle: r, libelle: QUESTION_NUMERO[r], choisir: () => setNumeroPerso(r) }))}
        />
      )}
      {deploiement === 'api' && numeroPerso === 'oui' && issueApi(true)}
      {deploiement === 'api' && numeroPerso === 'non' && carteNumeroDeChezNous('issue-fourni', ISSUE_FOURNI, 'choix-issue-fourni', choisirFourni)}
    </>
  );

  return (
    <>
      {/* Ce qu'il faut chez Meta, avant toute fenêtre de Meta : la même source que Claude (guide « compte Meta »). La filière
          application n'a pas de fenêtre de Meta. Le tunnel de la console (`choixInitial` nul) ne l'a pas : ses questions
          disent la même chose une à une, et un pavé au-dessus brouillait le parcours (Julien, 2026-11-17). */}
      {!application && !conditionsEnLecture && choixInitial !== null && <EncadreChezMeta prerequis={prerequis} />}
      {/* Le lien de Claude ouvre la connexion sans carte d'elle-même (lot 3v-2b) : la page le dit, la console le dit déjà. */}
      {ligne && parLaLigne === 'si-ouverte' && (
        <p data-testid="connexion-sans-carte" className="mt-3 text-sm text-ink-700">
          {t('Sans carte chez Meta : vos messages se paieront par votre ligne de crédit.', 'No card at Meta: your messages will be paid by your credit line.')}
        </p>
      )}
      {choix === null ? (
        // Les questions du tunnel de la vitrine : seule la page de la console y passe, un lien de Claude Code arrivant
        // avec son choix (donc jamais sur la filière application). Comme sur la vitrine (Julien, 2026-10-30 : « on garde
        // le carré sélectionné et on passe à la question suivante plus bas »), une question répondue reste affichée, sa
        // réponse en évidence, et une autre réponse change la suite.
        <div ref={arbre} className="mt-6 space-y-3">
          <Question
            testid="question-compte"
            texte={QUESTION_COMPTE.texte}
            precision={QUESTION_COMPTE.precision}
            choisie={compte}
            reponses={(['oui', 'non', 'nsp'] as const).map((r) => ({ cle: r, libelle: QUESTION_COMPTE[r], choisir: () => repondreCompte(r) }))}
          />
          {compte === 'non' && <p data-testid="note-compte" className="text-sm text-ink-700">{t(QUESTION_COMPTE.noteNon.fr, QUESTION_COMPTE.noteNon.en)}</p>}
          {compte === 'nsp' && (
            <p data-testid="note-compte" className="text-sm text-ink-700">
              {t(QUESTION_COMPTE.noteNsp.avant.fr, QUESTION_COMPTE.noteNsp.avant.en)}
              <a href={META_BUSINESS_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-900 underline">business.facebook.com</a>
              {t(QUESTION_COMPTE.noteNsp.apres.fr, QUESTION_COMPTE.noteNsp.apres.en)}
            </p>
          )}
          {compte === 'oui' ? issueApi(false) : compte !== null && (
            <>
              <Question
                testid="question-application"
                texte={QUESTION_APPLICATION.texte}
                precision={QUESTION_APPLICATION.precision}
                choisie={appli}
                reponses={(['oui', 'non'] as const).map((r) => ({ cle: r, libelle: QUESTION_APPLICATION[r], choisir: () => repondreAppli(r) }))}
                bulle={{
                  terme: BULLE_WHATSAPP_BUSINESS.terme,
                  testid: 'bulle-whatsapp-business',
                  contenu: (
                    <>
                      <span className="flex items-start gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- un logo de 8 Ko, sans optimisation à attendre */}
                        <img src={LOGO_WHATSAPP_BUSINESS} alt="" width={40} height={40} className="shrink-0" />
                        <span>{t(BULLE_WHATSAPP_BUSINESS.texte.fr, BULLE_WHATSAPP_BUSINESS.texte.en)}</span>
                      </span>
                      {magasins}
                    </>
                  ),
                }}
              />
              {/* La suite s'affiche dessous, les questions restent : on change de réponse en en cliquant une autre. Avec
                  l'application (Julien, 2026-11-17, lot 3) : un numéro y fonctionne-t-il ? Oui, est-ce celui-là (le cas 4) ?
                  Oui, on la garde. Sinon (lot 4) : comment utiliser WhatsApp, l'application (un 2e compte pour un autre
                  numéro, deux au plus) ou l'API. Sans l'application : la même question, l'application étant à installer. */}
              {appli === 'oui' && (
                <>
                  <Question
                    testid="question-numero-application"
                    texte={QUESTION_NUMERO_APPLICATION.texte}
                    precision={QUESTION_NUMERO_APPLICATION.precision}
                    choisie={numeroAppli}
                    reponses={(['oui', 'non'] as const).map((r) => ({ cle: r, libelle: QUESTION_NUMERO_APPLICATION[r], choisir: () => repondreNumeroAppli(r) }))}
                  />
                  {numeroAppli === 'oui' && (
                    <Question
                      testid="question-meme-numero"
                      texte={QUESTION_MEME_NUMERO.texte}
                      precision={QUESTION_MEME_NUMERO.precision}
                      choisie={memeNumero}
                      reponses={(['oui', 'non'] as const).map((r) => ({ cle: r, libelle: QUESTION_MEME_NUMERO[r], choisir: () => repondreMemeNumero(r) }))}
                    />
                  )}
                  {numeroAppli === 'oui' && memeNumero === 'oui' && carteCoexistence(null, false)}
                  {numeroAppli === 'oui' && memeNumero === 'non' && suiteDeploiement('second')}
                  {numeroAppli === 'non' && suiteDeploiement('vide')}
                </>
              )}
              {appli === 'non' && suiteDeploiement('sans')}
            </>
          )}
        </div>
      ) : choix === 'coexistence' ? (
        carteCoexistence(boutonRetour, true)
      ) : choix === 'apporte' && application ? (
        <QrApplication api={api} />
      ) : choix === 'apporte' ? (
        <div data-testid="choix-apporte-ouvert" className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
          <p className="text-sm text-ink-700">{t('Dans la fenêtre de Meta, choisissez votre entreprise, saisissez votre numéro et le code reçu.', 'In the Meta window, pick your business, enter your number and the code you receive.')}</p>
          <div className="mt-4 flex items-center gap-3">
            {boutonFenetre}
            {boutonRetour}
          </div>
        </div>
      ) : numero === null ? (
        <div data-testid="choix-fourni-ouvert" className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
          <p className="text-sm text-ink-700">
            {dansApplication
              ? t('Nous vous attribuons un numéro britannique dédié, que vous ajouterez dans l’application WhatsApp Business.', 'We assign you a dedicated UK number, which you then add in the WhatsApp Business app.')
              : t('Nous vous attribuons un numéro britannique dédié, que vous connecterez dans la fenêtre de Meta.', 'We assign you a dedicated UK number, which you then connect in the Meta window.')}
          </p>
          {lienVideo}
          {abonne && rendu ? (
            // Rendu par « Abandonner », mais l'abonnement court toujours : on le dit, avec ce qu'on peut en faire.
            <p data-testid="numero-rendu" className="mt-3 text-sm text-ink-700">
              {finProgrammee
                ? t('Numéro rendu. Votre abonnement prend fin à la fin de la période payée : rien ne vous sera plus prélevé.', 'Number given back. Your subscription ends at the end of the paid period: nothing more will be charged.')
                : api.portail
                ? t('Numéro rendu. Votre abonnement continue : obtenez un autre numéro ci-dessous, ou résiliez-le avec « Gérer mon abonnement ».', 'Number given back. Your subscription continues: get another number below, or cancel it with “Manage my subscription”.')
                : t('Numéro rendu. Votre abonnement continue : obtenez un autre numéro ci-dessous, ou demandez à Claude de le résilier.', 'Number given back. Your subscription continues: get another number below, or ask Claude to cancel it.')}
            </p>
          ) : abonne ? (
            // Payé, mais sans numéro : la réserve était vide au moment du paiement. Le bouton réessaie l'attribution.
            <p data-testid="numero-en-preparation" className="mt-3 text-sm text-ink-700">
              {t('Paiement reçu : votre numéro est en préparation, il s’affichera ici dès qu’il sera prêt.', 'Payment received: your number is being prepared and will show here as soon as it is ready.')}
            </p>
          ) : inclus ? (
            // Un Pro vivant inclut le numéro (lot 6, B2b) : rien à payer.
            <p data-testid="numero-inclus" className="mt-3 text-sm text-ink-700">
              {t('Inclus dans votre offre : rien à payer.', 'Included in your plan: nothing to pay.')}
            </p>
          ) : essaiPro && !(paiementRecu && abonnement === null) ? (
            // Pendant l'essai du Pro (lot 2 du 2026-11-17) : le numéro se paie, ses 3,50 € se déduisent du premier mois.
            <p data-testid="numero-essai-deduit" className="mt-3 text-sm text-ink-700">
              {t(ESSAI_PRO_PAIEMENT.fr, ESSAI_PRO_PAIEMENT.en)}
            </p>
          ) : paiementRecu && abonnement === null ? (
            <p data-testid="paiement-en-confirmation" className="mt-3 text-sm text-ink-700">
              {t('Paiement en cours de confirmation… votre numéro s’affichera ici dans quelques secondes.', 'Payment being confirmed… your number will show here in a few seconds.')}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            {abonnement === undefined || abonne || inclus ? (
              <Bouton type="button" enCours={enCours} disabled={enCours} onClick={() => { void obtenir(); }} data-testid="obtenir-numero">
                {t('Obtenir mon numéro', 'Get my number')}
              </Bouton>
            ) : paiementRecu && abonnement === null ? null : (
              // Sans abonnement, ou résilié : même revenu de Stripe, un abonnement résilié se repaie.
              <Bouton type="button" enCours={enCours} disabled={enCours} onClick={() => { void payer(); }} data-testid="payer-numero">
                {t('Payer 3,50 € HT par mois', 'Pay €3.50 excl. VAT per month')}
              </Bouton>
            )}
            {portail}
            {boutonRetour}
          </div>
          {/* Les étapes à venir, grisées (Julien, 2026-11-17, lot 4) : après le paiement, le numéro et son code, puis la
              fenêtre de Meta. La première, en cours : obtenir le numéro quand il n'y a rien à payer. Au retour de Stripe,
              le paiement est fait et le numéro arrive : la deuxième passe en cours. */}
          <ol data-testid="etapes-a-venir" className="mt-4 list-decimal space-y-1 pl-5 text-sm">
            <li className={paiementRecu ? 'text-ink-500 line-through' : 'font-semibold text-ink-900'} aria-current={paiementRecu ? undefined : 'step'}>
              {abonnement === undefined || abonne || inclus ? t(ETAPES_A_VENIR.obtenir.fr, ETAPES_A_VENIR.obtenir.en) : t(ETAPES_A_VENIR.payer.fr, ETAPES_A_VENIR.payer.en)}
            </li>
            {(dansApplication ? ETAPES_A_VENIR.application : ETAPES_A_VENIR.api).map((e, i) => (
              <li key={e.fr} className={paiementRecu && i === 0 ? 'font-semibold text-ink-900' : 'text-ink-400'} aria-current={paiementRecu && i === 0 ? 'step' : undefined}>
                {t(e.fr, e.en)}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="rounded-carte border border-ink-200 bg-white p-5">
            <div className="text-xs font-medium text-ink-500">{t('Votre numéro', 'Your number')}</div>
            <div className="mt-1 flex items-center gap-3">
              <span data-testid="numero-fourni" className="font-mono text-2xl font-semibold text-ink-900">{numero}</span>
              <Bouton type="button" variante="secondaire" taille="petite" onClick={() => { void copier(); }}>{copie ? t('Copié', 'Copied') : t('Copier', 'Copy')}</Bouton>
            </div>
            {/* Le code arrive ICI, juste sous le numéro, en grand et en couleur (essai 263, Julien, 2026-11-16 : « on voit pas
                bien où ça va apparaître ») ; un point qui pulse pendant l'attente, que la page dit gardée ouverte. */}
            <div data-testid="code-capte" className="mt-4 rounded-carte border-2 border-brand-500 bg-brand-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">{t(CODE_ICI.fr, CODE_ICI.en)}</div>
              {code ? (
                <div className="mt-1 font-mono text-4xl font-semibold tracking-widest text-ink-900">{code}</div>
              ) : appelApplication && !dansApplication ? (
                // Le numéro a été tapé dans une application WhatsApp (vécu le 2026-11-17) : son code n'est pas transmis.
                <p data-testid="appel-application" className="mt-2 text-sm font-medium text-ink-900">
                  {t(APPEL_APPLICATION.fr, APPEL_APPLICATION.en)}
                </p>
              ) : (
                <p className="mt-2 flex items-center gap-2 text-sm font-medium text-ink-900">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-brand-500 motion-reduce:animate-none" />
                  {dansApplication ? t('En attente du code de WhatsApp…', 'Waiting for WhatsApp’s code…') : t('En attente du code de Meta…', 'Waiting for Meta’s code…')}
                  <span className="font-normal text-ink-500">{t('(gardez cette page ouverte)', '(keep this page open)')}</span>
                </p>
              )}
            </div>
            {/* Les mêmes étapes que celles que Claude redit (`src/mcp/outils-numero.ts`) : une seule source. */}
            <ol data-testid="etapes-numero-fourni" className="mt-4 list-decimal space-y-1 pl-5 text-sm text-ink-700">
              {(dansApplication ? ETAPES_COMPTE_FOURNI : ETAPES_NUMERO_FOURNI).map((e) => (
                // L'étape de l'appel (`insiste`), en gras : celle où tout se joue (lot 2c).
                <li key={e.fr} className={'insiste' in e && e.insiste ? 'font-semibold text-ink-900' : undefined} data-insiste={'insiste' in e && e.insiste ? '' : undefined}>
                  {t(e.fr, e.en)}
                </li>
              ))}
            </ol>
            {!dansApplication && (
              <p data-testid="si-seul-text-message" className="mt-2 pl-5 text-xs text-ink-500">{t(SI_SEUL_TEXT_MESSAGE.fr, SI_SEUL_TEXT_MESSAGE.en)}</p>
            )}
            {lienVideo && <div className="pl-5">{lienVideo}</div>}
            <div className="mt-4">
              {/* Mis dans l'application (plan 2026-10-31) : une fois le compte créé, la même fenêtre qu'en coexistence. */}
              {!dansApplication ? boutonFenetre : !application ? boutonCoexistence : !qrDemande ? (
                <Bouton type="button" onClick={() => setQrDemande(true)} data-testid="afficher-qr-application">
                  {t('J’ai créé le compte : afficher le QR code', 'I created the account: show the QR code')}
                </Bouton>
              ) : null}
            </div>
          </div>
          {application && qrDemande && <QrApplication api={api} />}
          {/* Ce que l'application garde et perd (Julien, 2026-10-31) : la reprise d'un numéro fourni mis dans l'application. */}
          {choix === 'fourni_application' && (
            <div data-testid="suite-fourni-application" className="rounded-carte border border-ink-200 bg-white p-5">
              {[SUITE_FOURNI_APPLICATION, ...COEXISTENCE_PHRASES].map((p) => <p key={p.fr} className="mt-2 text-sm text-ink-700 first:mt-0">{t(p.fr, p.en)}</p>)}
              {/* L'application gardée, Meta se paie avec sa carte (lot 3 du 2026-11-17), comme sur chaque voie qui la garde. */}
              <p data-testid="note-carte-application" className="mt-2 text-sm text-ink-700">{t(NOTE_CARTE_APPLICATION.fr, NOTE_CARTE_APPLICATION.en)}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Bouton type="button" variante="discret" taille="petite" disabled={enCours} onClick={() => { void remplacer(); }} data-testid="remplacer-numero">
              {/* Mis dans l'application, le numéro n'a plus besoin de ce bouton que pour le code de l'application qui n'arrive
                  pas, avant d'y avoir créé le compte. */}
              {choix === 'fourni_application'
                ? t('Le code n’arrive pas ? En obtenir un autre', 'The code does not arrive? Get another one')
                : application
                ? t('Ce numéro ne passe pas ? En obtenir un autre', 'This number does not go through? Get another one')
                : t('Meta refuse ce numéro ? En obtenir un autre', 'Meta refuses this number? Get another one')}
            </Bouton>
            <Bouton type="button" variante="discret" taille="petite" disabled={enCours} onClick={() => { void abandonner(); }} data-testid="abandonner-numero">
              {t('Abandonner', 'Give up')}
            </Bouton>
            {portail}
          </div>
        </div>
      )}
      {connexion.peutEtreBloquee && <p data-testid="fenetre-bloquee" className="mt-4 text-xs text-ink-500">{t(FENETRE_BLOQUEE.fr, FENETRE_BLOQUEE.en)}</p>}
      {(erreur ?? connexion.error) && <p data-testid="erreur-connexion" className="mt-4 rounded-controle bg-danger-50 px-3 py-2 text-xs text-danger-700">{erreur ?? connexion.error}</p>}
      <ValidationConnexion visible={connexion.validation} />
      <AideErreurMeta code={connexion.erreurMeta} />
    </>
  );
}

type Texte = { readonly fr: string; readonly en: string };

/** La carte du numéro fourni pendant l'essai du Pro (lot 2 du 2026-11-17). */
export const ESSAI_PRO_CARTE: Texte = {
  fr: 'Un numéro dédié, prêt pour WhatsApp : 3,50 € HT, déduits de votre premier mois de formule Pro.',
  en: 'A dedicated number, ready for WhatsApp: €3.50 excl. VAT, deducted from your first month of the Pro plan.',
};

/** Sous le paiement du numéro pendant l'essai du Pro (lot 2 du 2026-11-17). */
export const ESSAI_PRO_PAIEMENT: Texte = {
  fr: 'Pendant votre essai, le numéro se paie 3,50 € HT, déduits de votre premier mois de formule Pro. Sans formule Pro '
    + 'ensuite, il reste à 3,50 € HT par mois.',
  en: 'During your trial, the number costs €3.50 excl. VAT, deducted from your first month of the Pro plan. Without the Pro '
    + 'plan afterwards, it stays at €3.50 excl. VAT per month.',
};

/** Dit à la place du code quand l'application WhatsApp a appelé un numéro destiné à la fenêtre de Meta (2026-11-17). */
export const APPEL_APPLICATION: Texte = {
  fr: 'Ce numéro a été saisi dans une application WhatsApp : ce code-là n’est pas transmis. Ce numéro ne se met pas dans '
    + 'l’application : saisissez-le dans la fenêtre de Meta (bouton ci-dessous), en suivant les étapes.',
  en: 'This number was entered in a WhatsApp app: that code is not passed on. This number does not go in the app: enter '
    + 'it in the Meta window (button below), following the steps.',
};

/** Le titre de l'encadré du code, que l'étape « le code s'affiche… » désigne (essai 263). */
export const CODE_ICI: Texte = { fr: 'Le code s’affichera ici', en: 'The code will appear here' };

/** Où se pose « Comment voulez-vous utiliser WhatsApp ? » (lot 4 du 2026-11-17) : sans l'application, avec elle mais
 * sans numéro dedans, ou pour un 2e compte. */
type VarianteDeploiement = 'sans' | 'vide' | 'second';

/**
 * Une bulle d'explication (Julien, 2026-11-17, lot 4) : elle s'ouvre au survol, au focus ou au clic, sans quitter le
 * tunnel, comme les bulles de la vitrine. Un vrai bouton (`aria-expanded`, `aria-controls`) ; Échap ou la sortie de la
 * souris la ferment ; un lien dedans reste cliquable, le focus qui y passe ne la fermant pas. L'écart entre le terme et
 * la bulle est une marge INTÉRIEURE de la bulle : la souris qui le traverse ne sort pas, et atteint les liens.
 * `auDessus` : elle s'ouvre vers le haut, pour ne pas couvrir le bouton placé dessous (les cartes du déploiement).
 */
function Bulle({ declencheur, testid, children, auDessus = false }: { declencheur: ReactNode; testid: string; children: ReactNode; auDessus?: boolean }) {
  const [ouverte, setOuverte] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOuverte(true)}
      onMouseLeave={() => setOuverte(false)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOuverte(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOuverte(false); }}
    >
      <button
        type="button"
        className="font-semibold text-ink-900 underline decoration-dotted underline-offset-2"
        aria-expanded={ouverte}
        aria-controls={id}
        onClick={() => setOuverte(true)}
        onFocus={() => setOuverte(true)}
        data-testid={testid}
      >
        {declencheur}
      </button>
      <span
        id={id}
        hidden={!ouverte}
        data-testid={`${testid}-bulle`}
        className={`absolute left-0 z-20 w-72 max-w-[80vw] ${auDessus ? 'bottom-full pb-2' : 'top-full pt-2'}`}
      >
        <span className="block rounded-carte border border-ink-200 bg-white p-3 text-left text-xs font-normal text-ink-700 shadow-lg">
          {children}
        </span>
      </span>
    </span>
  );
}

/**
 * « Comment voulez-vous utiliser WhatsApp ? » (Julien, 2026-11-17, lot 4) : deux cartes, une ligne chacune et le détail
 * dans une bulle, la réponse sous chaque carte, comme les cartes de la vitrine. `second` : la carte de l'application dit
 * « un 2e compte », deux au plus.
 */
function QuestionDeploiement({ variante, choisie, choisir }: {
  variante: VarianteDeploiement;
  choisie: 'application' | 'api' | null;
  choisir(r: 'application' | 'api'): void;
}) {
  const t = useT();
  const second = variante === 'second';
  const cartes = [
    {
      cle: 'application' as const,
      titre: second ? DEPLOIEMENT_SECOND.titre : QUESTION_DEPLOIEMENT.application.titre,
      ligne: QUESTION_DEPLOIEMENT.application.ligne,
      bulle: second ? DEPLOIEMENT_SECOND.bulle : QUESTION_DEPLOIEMENT.application.bulle,
      libelle: QUESTION_DEPLOIEMENT.application.libelle,
    },
    { cle: 'api' as const, ...QUESTION_DEPLOIEMENT.api },
  ];
  return (
    <div data-testid="question-deploiement" data-variante={variante} className="rounded-carte border border-ink-200 bg-white p-5">
      <div className="text-base font-semibold text-ink-900">{t(QUESTION_DEPLOIEMENT.texte.fr, QUESTION_DEPLOIEMENT.texte.en)}</div>
      <p className="mt-1 text-xs text-ink-500">{t(QUESTION_DEPLOIEMENT.precision.fr, QUESTION_DEPLOIEMENT.precision.en)}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {cartes.map((c) => (
          <div
            key={c.cle}
            data-testid={`deploiement-${c.cle}`}
            className={`flex flex-col rounded-carte border p-4 ${choisie === c.cle ? 'border-brand-500' : 'border-ink-200'} ${choisie !== null && choisie !== c.cle ? 'opacity-60 hover:opacity-100' : ''}`}
          >
            <div className="text-sm font-semibold text-ink-900">{t(c.titre.fr, c.titre.en)}</div>
            <p className="mt-1 text-xs text-ink-700">{t(c.ligne.fr, c.ligne.en)}</p>
            <span className="mt-2 text-xs">
              <Bulle testid={`deploiement-${c.cle}-detail`} declencheur={t(QUESTION_DEPLOIEMENT.detail.fr, QUESTION_DEPLOIEMENT.detail.en)} auDessus>
                {t(c.bulle.fr, c.bulle.en)}
              </Bulle>
            </span>
            <Bouton
              type="button"
              className="mt-3 self-start"
              variante={choisie === c.cle ? 'principal' : 'secondaire'}
              aria-pressed={choisie === c.cle}
              onClick={() => choisir(c.cle)}
              data-testid={`question-deploiement-${c.cle}`}
            >
              {t(c.libelle.fr, c.libelle.en)}
            </Bouton>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Une question du tunnel, comme sur la vitrine : elle reste affichée une fois répondue, la réponse choisie en évidence
 * (`aria-pressed`) et les autres estompées mais cliquables, pour changer de chemin. `bulle` : un terme du titre qui ouvre
 * une bulle (« WhatsApp Business », lot 4 du 2026-11-17).
 */
function Question({ testid, texte, precision, choisie, reponses, bulle }: {
  testid: string;
  texte: Texte;
  precision: Texte;
  choisie: string | null;
  reponses: ReadonlyArray<{ cle: string; libelle: Texte; choisir(): void }>;
  bulle?: { terme: Texte; testid: string; contenu: ReactNode };
}) {
  const t = useT();
  const titre = t(texte.fr, texte.en);
  const terme = bulle ? t(bulle.terme.fr, bulle.terme.en) : '';
  const rang = bulle ? titre.indexOf(terme) : -1;
  return (
    <div data-testid={testid} className="rounded-carte border border-ink-200 bg-white p-5">
      <div className="text-base font-semibold text-ink-900">
        {bulle && rang >= 0 ? (
          <>
            {titre.slice(0, rang)}
            <Bulle testid={bulle.testid} declencheur={terme}>{bulle.contenu}</Bulle>
            {titre.slice(rang + terme.length)}
          </>
        ) : titre}
      </div>
      <p className="mt-1 text-xs text-ink-500">{t(precision.fr, precision.en)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {reponses.map((r) => (
          <Bouton
            key={r.cle}
            type="button"
            variante={choisie === r.cle ? 'principal' : 'secondaire'}
            className={choisie !== null && choisie !== r.cle ? 'opacity-60 hover:opacity-100' : ''}
            aria-pressed={choisie === r.cle}
            onClick={r.choisir}
            data-testid={`${testid}-${r.cle}`}
          >
            {t(r.libelle.fr, r.libelle.en)}
          </Bouton>
        ))}
      </div>
    </div>
  );
}

/**
 * Le portail client de Stripe (jaune 1 de la relecture de la livraison B) : changer de carte, lire les factures,
 * résilier. Rien sans `api.portail`, c'est-à-dire sur la page du lien de Claude Code.
 */
export function BoutonPortail({ api }: { api: ApiConnexionNumero }) {
  const t = useT();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const ouvrir = api.portail;
  if (!ouvrir) return null;
  const aller = async () => {
    setEnCours(true);
    setErreur(null);
    try { window.location.assign((await ouvrir()).url); } catch (err) {
      setErreur(err instanceof Error ? err.message : t('Une erreur est survenue', 'Something went wrong'));
      setEnCours(false);
    }
  };
  return (
    <>
      <Bouton type="button" variante="discret" taille="petite" enCours={enCours} disabled={enCours} onClick={() => { void aller(); }} data-testid="gerer-abonnement">
        {t('Gérer mon abonnement', 'Manage my subscription')}
      </Bouton>
      {erreur && <span className="text-xs text-danger-700">{erreur}</span>}
    </>
  );
}

/** Le délai entre deux lectures du code pendant que la fenêtre de Meta est ouverte. */
const INTERVALLE_CODE_MS = 3_000;

/**
 * La variante du numéro fourni choisie dans la console, gardée par le navigateur pour CET espace (2026-10-31) : le retour
 * de Stripe, un rechargement, ou un retour plus tard dans un autre onglet reprennent le parcours sans savoir quelle
 * question y a mené. Le lien de Claude porte la sienne. Mémoire
 * indisponible, ou un autre appareil : la variante d'avant, la fenêtre de Meta (l'Accueil garde son bouton « Garder mon
 * application WhatsApp Business »).
 */
const cleVariante = (tenantId: string) => `mba.numero-variante.${tenantId}`;
function varianteGardee(tenantId: string): 'fourni' | 'fourni_application' {
  try { return window.localStorage.getItem(cleVariante(tenantId)) === 'fourni_application' ? 'fourni_application' : 'fourni'; } catch { return 'fourni'; }
}
function garderVariante(tenantId: string, v: 'fourni' | 'fourni_application'): void {
  try { window.localStorage.setItem(cleVariante(tenantId), v); } catch { /* mémoire indisponible : la variante d'avant au retour */ }
}
