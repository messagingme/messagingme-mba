'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { formatDate } from '@/lib/day';
import { Modale } from '@/components/Modale';
import { Bouton } from '@/components/Bouton';
import { routeInconnue } from '@/lib/canaux-services';
import { apercuRattrapageShopify, lancerRattrapageShopify, lireRattrapageShopify } from '@/lib/api-shopify';
import type { ApercuRepriseVue, RepriseShopifyVue } from '@/lib/partage/reprise-shopify';

/** Une reprise qui tourne encore : la carte la relit à ce rythme, jusqu'à sa fin. */
const RELECTURE_MS = 10_000;

/**
 * Un nombre et son nom accordés : le français garde le singulier jusqu'à 1, l'anglais seulement à 1. Les deux formes de
 * chaque langue sont données entières, l'accord touchant parfois plusieurs mots (« commande payée créée »).
 */
function useNombre() {
  const t = useT();
  return (n: number, fr: readonly [string, string], en: readonly [string, string]): string =>
    t(`${n} ${n > 1 ? fr[1] : fr[0]}`, `${n} ${n === 1 ? en[0] : en[1]}`);
}

/**
 * LE RATTRAPAGE DES COMMANDES DES 60 DERNIERS JOURS (segments Shopify enrichis, lots 5 et 5b), dans la carte Shopify :
 * l'état de la dernière reprise, puis un aperçu qui compte sans rien écrire, et le lancement. Les mêmes fonctions que
 * `preview_shopify_order_history` et `import_shopify_order_history` (`src/shopify/reprise.ts`) : depuis le lot 5b, la
 * fiche de l'acheteur au mobile utilisable qui n'en a pas est créée, consentante sur la foi de l'attestation, dans les
 * places de l'offre, et l'aperçu prévient quand elles en prendraient les dernières (`remplitLesPlaces`) ; aucun message
 * ne part.
 *
 * 🔴 UNE API PLUS ANCIENNE (404 du routeur) : rien n'est montré, le bouton appellerait une route qui n'existe pas. Une
 * lecture en panne garde ce qui était affiché, et la relecture continue tant que la reprise tourne. 🔴 Une API d'avant le
 * lot 5b ne crée aucune fiche et n'en rend pas les comptes (`fichesACreer`, `fichesCreees`) : sans eux, l'écran garde le
 * texte du lot 5, jamais une création promise qu'elle ne ferait pas.
 */
export function ShopifyRattrapage({ tenantId, onLance }: { tenantId: string; onLance: (texte: string) => void }) {
  const t = useT();
  const nombre = useNombre();
  const { locale } = useLocale();
  const [reprise, setReprise] = useState<RepriseShopifyVue | null | 'absente'>(null);
  const [ouvert, setOuvert] = useState(false);
  /** Un tour de relecture de plus : relancé à chaque lecture, même en panne, tant que la reprise tourne. */
  const [tour, setTour] = useState(0);

  const relire = useCallback(() => lireRattrapageShopify(tenantId)
    .then(setReprise)
    .catch((e: unknown) => { if (routeInconnue(e)) setReprise('absente'); })
    .finally(() => setTour((n) => n + 1)), [tenantId]);

  useEffect(() => { void relire(); }, [relire]);
  const r = reprise !== null && reprise !== 'absente' ? reprise : null;
  const vivante = r !== null && (r.statut === 'en_attente' || r.statut === 'en_cours') && !r.interrompue;
  useEffect(() => {
    if (!vivante) return undefined;
    const minuterie = setTimeout(() => { void relire(); }, RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [vivante, tour, relire]);

  if (reprise === 'absente') return null;
  const date = (iso: string) => formatDate(iso, locale);
  const comptes = r?.comptes;
  // Les fiches créées (lot 5b) : dites seulement par une API qui les compte ; le plafond, seulement s'il a écarté quelqu'un.
  const creees = comptes?.fichesCreees === undefined
    ? ''
    : `, ${nombre(comptes.fichesCreees, ['fiche d’acheteur créée', 'fiches d’acheteurs créées'], ['buyer record created', 'buyer records created'])}`;
  const hors = comptes?.horsPlafond ?? 0;
  const horsPlafond = hors > 0
    ? `, ${nombre(hors, ['au-delà de la limite de contacts de votre offre, non gardée', 'au-delà de la limite de contacts de votre offre, non gardées'], ['over your plan’s contact limit, not kept', 'over your plan’s contact limit, not kept'])}`
    : '';

  return (
    <div className="space-y-1" data-testid="integration-shopify-rattrapage">
      <p className="flex flex-wrap items-center gap-2 text-ink-900">
        {r === null
          ? t(
            'Les commandes payées avant le branchement n’entrent pas dans vos segments : rattrapez celles des 60 derniers jours.',
            'Orders paid before the connection are not in your segments: catch up those of the last 60 days.',
          )
          : t('Le rattrapage des commandes des 60 derniers jours :', 'The catch-up of the orders of the last 60 days:')}
        {!vivante && (
          <Bouton type="button" taille="petite" variante="secondaire" onClick={() => setOuvert(true)} data-testid="integration-shopify-rattraper">
            {r === null ? t('Rattraper', 'Catch up') : t('Relancer', 'Run again')}
          </Bouton>
        )}
      </p>
      {r !== null && comptes && (
        <p className={r.statut === 'refuse' || r.statut === 'erreur' || r.interrompue ? 'text-danger' : 'text-ink-500'} data-testid="integration-shopify-rattrapage-etat">
          {r.interrompue
            ? t(`Le rattrapage lancé le ${date(r.commenceLe)} s’est interrompu : relancez-le.`, `The catch-up started on ${date(r.commenceLe)} stopped: run it again.`)
            : vivante
              ? `${t(`En cours, lancé le ${date(r.commenceLe)} : `, `Running, started on ${date(r.commenceLe)}: `)}${nombre(comptes.lues, ['commande lue', 'commandes lues'], ['order read', 'orders read'])}, ${nombre(comptes.rattachees, ['rattachée à une fiche', 'rattachées à une fiche'], ['attached to a record', 'attached to a record'])}${creees}.`
              : r.statut === 'termine'
                ? `${t(`Terminé le ${date(r.finiLe ?? r.commenceLe)} : `, `Done on ${date(r.finiLe ?? r.commenceLe)}: `)}${nombre(comptes.lues, ['commande payée créée', 'commandes payées créées'], ['paid order created', 'paid orders created'])}${t(` depuis le ${date(r.fenetreDebut)}, `, ` since ${date(r.fenetreDebut)}, `)}${nombre(comptes.rattachees, ['rattachée à une fiche', 'rattachées à une fiche'], ['attached to a record', 'attached to a record'])}${creees}, ${nombre(comptes.deja, ['déjà connue', 'déjà connues'], ['already known', 'already known'])}, ${nombre(comptes.sansFiche + comptes.sansNumero, ['sans fiche ou sans numéro, non gardée', 'sans fiche ou sans numéro, non gardées'], ['without a record or a phone, not kept', 'without a record or a phone, not kept'])}${horsPlafond}.`
                : t(`Arrêté : ${r.erreur ?? 'raison inconnue'}`, `Stopped: ${r.erreur ?? 'unknown reason'}`)}
        </p>
      )}
      {ouvert && (
        <ApercuRattrapage
          tenantId={tenantId}
          onClose={() => setOuvert(false)}
          onLance={(lancee) => {
            setOuvert(false);
            setReprise(lancee);
            onLance(t(
              'Rattrapage lancé : il tourne en arrière-plan, la carte dit où il en est.',
              'Catch-up started: it runs in the background, the card tells where it stands.',
            ));
          }}
        />
      )}
    </div>
  );
}

function ApercuRattrapage({ tenantId, onClose, onLance }: {
  tenantId: string;
  onClose: () => void;
  onLance: (reprise: RepriseShopifyVue) => void;
}) {
  const t = useT();
  const nombre = useNombre();
  const { locale } = useLocale();
  const [apercu, setApercu] = useState<ApercuRepriseVue | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    apercuRattrapageShopify(tenantId)
      .then((a) => { if (vivant) setApercu(a); })
      .catch((e: unknown) => { if (vivant) setErreur(e instanceof Error ? e.message : t('Lecture impossible', 'Unable to read')); });
    return () => { vivant = false; };
  }, [tenantId, t]);

  const lancer = async (): Promise<void> => {
    setEnCours(true);
    setErreur(null);
    try {
      onLance(await lancerRattrapageShopify(tenantId));
    } catch (e: unknown) {
      setErreur(e instanceof Error ? e.message : t('Lancement impossible', 'Unable to start'));
    } finally {
      setEnCours(false);
    }
  };

  const rienALire = apercu !== null && apercu.complet && apercu.lues === 0;
  // Une API du lot 5b compte les fiches qu'elle créerait ; une plus ancienne n'en crée aucune, et l'écran le dit.
  const fichesACreer = apercu?.fichesACreer;
  const horsPlafond = apercu?.horsPlafond ?? 0;
  const places = apercu?.placesLibres ?? null;
  return (
    <Modale
      titre={t('Rattraper les commandes des 60 derniers jours', 'Catch up the orders of the last 60 days')}
      taille="moyenne"
      testId="shopify-rattrapage"
      onClose={onClose}
      pied={apercu !== null && !rienALire ? (
        <Bouton type="button" onClick={() => void lancer()} enCours={enCours} disabled={enCours} data-testid="shopify-rattrapage-lancer">
          {t('Lancer le rattrapage', 'Start the catch-up')}
        </Bouton>
      ) : undefined}
    >
      <div className="space-y-3 text-sm">
        {apercu === null && erreur === null && <p className="text-ink-500">{t('Lecture des commandes de la boutique…', 'Reading the store orders…')}</p>}
        {apercu !== null && (
          <>
            <ul className="space-y-1 text-ink-900" data-testid="shopify-rattrapage-apercu">
              <li className="font-medium">
                {nombre(apercu.lues, ['commande payée créée', 'commandes payées créées'], ['paid order created', 'paid orders created'])}
                {t(` depuis le ${formatDate(apercu.fenetreDebut, locale)}`, ` since ${formatDate(apercu.fenetreDebut, locale)}`)}
              </li>
              <li className="text-ink-500">
                {t('dont ', 'of which ')}
                {nombre(apercu.deja, ['déjà connue : elle reçoit ses produits s’il lui en manque', 'déjà connues : elles reçoivent leurs produits s’il leur en manque'], ['already known: it gets its products if any are missing', 'already known: they get their products if any are missing'])}
              </li>
              <li className="font-medium">{t(`${apercu.rattachables} à rattacher à une fiche de vos contacts`, `${apercu.rattachables} to attach to a record of your contacts`)}</li>
              {fichesACreer !== undefined && fichesACreer > 0 && (
                <li className="font-medium" data-testid="shopify-rattrapage-fiches">
                  {nombre(
                    fichesACreer,
                    ['fiche d’acheteur à créer : consentante sur la foi de votre attestation, étiquetée « Shopify »', 'fiches d’acheteurs à créer : consentantes sur la foi de votre attestation, étiquetées « Shopify »'],
                    ['buyer record to create: opted in on the strength of your attestation, tagged “Shopify”', 'buyer records to create: opted in on the strength of your attestation, tagged “Shopify”'],
                  )}
                  {places !== null && t(` (votre offre laisse ${places} place${places > 1 ? 's' : ''})`, ` (your plan leaves ${places} place${places === 1 ? '' : 's'})`)}
                </li>
              )}
              {apercu.remplitLesPlaces === true && (
                <li className="text-danger" data-testid="shopify-rattrapage-places">
                  {t(
                    'Ces fiches prendraient les dernières places de votre offre : ensuite, un nouveau client qui vous écrirait le premier n’entrerait plus.',
                    'These records would take the last places of your plan: after that, a new customer writing to you first could no longer get in.',
                  )}
                </li>
              )}
              {horsPlafond > 0 && (
                <li className="text-danger" data-testid="shopify-rattrapage-plafond">
                  {nombre(horsPlafond, ['au-delà de la limite de contacts de votre offre : non gardée', 'au-delà de la limite de contacts de votre offre : non gardées'], ['over your plan’s contact limit: not kept', 'over your plan’s contact limit: not kept'])}
                </li>
              )}
              {apercu.sansFiche > 0 && (
                <li className="text-ink-500">
                  {fichesACreer === undefined
                    ? nombre(apercu.sansFiche, ['sans fiche à son numéro : comptée, jamais gardée', 'sans fiche à leur numéro : comptées, jamais gardées'], ['without a record for its phone: counted, never kept', 'without a record for their phone: counted, never kept'])
                    : nombre(
                      apercu.sansFiche,
                      ['sans fiche créée (un contact supprimé après la commande, un STOP, un numéro absent de WhatsApp, ou un numéro sur la seule livraison, comme un cadeau) : comptée, jamais gardée', 'sans fiche créée (un contact supprimé après la commande, un STOP, un numéro absent de WhatsApp, ou un numéro sur la seule livraison, comme un cadeau) : comptées, jamais gardées'],
                      ['without a record created (a contact deleted after the order, a STOP, a number not on WhatsApp, or a number only on the shipping address, like a gift): counted, never kept', 'without a record created (a contact deleted after the order, a STOP, a number not on WhatsApp, or a number only on the shipping address, like a gift): counted, never kept'],
                    )}
                </li>
              )}
              {apercu.sansNumero > 0 && (
                <li className="text-ink-500">
                  {nombre(apercu.sansNumero, ['sans numéro WhatsApp utilisable : comptée, jamais gardée', 'sans numéro WhatsApp utilisable : comptées, jamais gardées'], ['without a usable WhatsApp number: counted, never kept', 'without a usable WhatsApp number: counted, never kept'])}
                </li>
              )}
              {apercu.ecartees > 0 && (
                <li className="text-ink-500">
                  {nombre(apercu.ecartees, ['écartée : jamais payée ou illisible', 'écartées : jamais payées ou illisibles'], ['left out: never paid or unreadable', 'left out: never paid or unreadable'])}
                </li>
              )}
            </ul>
            {!apercu.complet && (
              <p className="text-ink-500" data-testid="shopify-rattrapage-partiel">
                {t('La boutique a beaucoup de commandes : l’aperçu n’a pas tout lu. Le rattrapage, lui, lira tout.', 'The store has many orders: the preview did not read them all. The catch-up will read everything.')}
              </p>
            )}
            {rienALire && <p className="text-ink-900">{t('Aucune commande payée sur ces 60 jours.', 'No paid order over these 60 days.')}</p>}
            <p className="text-ink-500" data-testid="shopify-rattrapage-regle">
              {fichesACreer === undefined
                ? t(
                  'Aucune fiche n’est créée et aucun message ne part. Le rattrapage tourne en arrière-plan : quelques minutes pour la plupart des boutiques, plus d’une heure pour les très grandes.',
                  'No record is created and no message goes out. The catch-up runs in the background: a few minutes for most stores, over an hour for the largest.',
                )
                : t(
                  'Aucun message ne part. Une fiche créée par le rattrapage est supprimée si WhatsApp ne trouve pas son numéro au premier envoi, et sa place revient. Le rattrapage tourne en arrière-plan : quelques minutes pour la plupart des boutiques, plus d’une heure pour les très grandes.',
                  'No message goes out. A record the catch-up creates is deleted if WhatsApp does not find its number at the first message, and its place comes back. The catch-up runs in the background: a few minutes for most stores, over an hour for the largest.',
                )}
            </p>
          </>
        )}
        {erreur && <p className="text-danger" data-testid="shopify-rattrapage-erreur">{erreur}</p>}
      </div>
    </Modale>
  );
}
