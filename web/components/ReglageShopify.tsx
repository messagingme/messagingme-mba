'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cardCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { Toggle } from '@/components/Toggle';
import { useConfirmation } from '@/components/Confirmation';
import { routeInconnue } from '@/lib/canaux-services';
import { couperShopify, lireShopify, reglerPauseShopify, type EtatShopifyVue } from '@/lib/api-shopify';
import { etatDeLAutomation } from '@/lib/shopify-lignes';
import { fmtMontant } from '@/lib/ventes';
import { ShopifyBrancher } from '@/components/ShopifyBrancher';
import { ShopifyImport } from '@/components/ShopifyImport';

/**
 * TOOLS > INTÉGRATIONS > SHOPIFY : brancher la boutique, la mettre en pause, importer ses clients abonnés, couper
 * (conception 2026-10-22, maquette validée par Julien). Sans boutique, le mode opératoire chez Shopify puis les clés
 * (`ShopifyBrancher`). Ses messages sont devenus des automations (menu « Scénario », lot 5) : ils se règlent sur leur page,
 * Scénario > Automation > Shopify (lot 7), chacun dans son scénario, plus par un assistant. Claude Code fait la même chose
 * par la skill `shopify` du plugin : les deux passent par la même gestion côté serveur.
 *
 * 🔴 UNE INTÉGRATION NEUVE NE S'AFFICHE PAS AVANT SON API, comme Salesforce : tant que la route n'existe pas (404 du
 * routeur), la carte n'est pas rendue.
 *
 * ⚠️ ADMIN SEULEMENT : la carte ne vit que dans la page des administrateurs, et ses routes sont sous `g.admin`.
 */

/** Le montant récupéré, par devise et jamais additionné, précédé de `avant` ; rien quand aucun panier n'a été récupéré. */
function montantsRecuperes(vue: EtatShopifyVue, locale: string, avant: string): string {
  const m = vue.paniers.montantsRecuperes;
  return m.length === 0 ? '' : avant + m.map((x) => fmtMontant(x.montant, x.devise, locale)).join(' · ');
}

const ISSUES: Record<string, [string, string]> = {
  envoye: ['envoyés', 'sent'],
  desabonne: ['écartés : le client a dit STOP', 'left out: the customer said STOP'],
  sans_consentement: ['écartés : sans consentement', 'left out: no consent'],
  limite_contacts: ['non partis : limite de contacts de l’offre', 'not sent: plan contact limit'],
  limite_modeles: ['non partis : modèles du mois épuisés', 'not sent: monthly templates used up'],
  sans_telephone: ['sans téléphone', 'without phone'],
  donnee_manquante: ['non partis : une donnée du modèle manque', 'not sent: a template value is missing'],
  modele_refuse: ['non partis : modèle refusé par Meta', 'not sent: template refused by Meta'],
  numero_indisponible: ['non partis : numéro indisponible', 'not sent: number unavailable'],
  bloque: ['écartés : contact bloqué', 'left out: blocked contact'],
  refuse: ['refusés', 'refused'],
};

export function ReglageShopify({ tenantId }: { tenantId: string }) {
  const t = useT();
  const confirmer = useConfirmation();
  const [vue, setVue] = useState<EtatShopifyVue | null>(null);
  const [lecture, setLecture] = useState<'en_cours' | 'ok' | 'absente' | 'echec'>('en_cours');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null);
  const [importOuvert, setImportOuvert] = useState(false);

  const recharger = useCallback(() => lireShopify(tenantId)
    .then((v) => { setVue(v); setLecture(v ? 'ok' : 'absente'); })
    .catch((e: unknown) => setLecture(routeInconnue(e) ? 'absente' : 'echec')), [tenantId]);

  useEffect(() => { void recharger(); }, [recharger]);
  // La page d'aide publique renvoie ici par `#integration-shopify` ; la carte n'existe qu'après sa propre lecture.
  useEffect(() => {
    if (lecture !== 'en_cours' && window.location.hash === '#integration-shopify') document.getElementById('integration-shopify')?.scrollIntoView();
  }, [lecture]);

  /** Un geste de la carte : la carte se relit et dit ce qui s'est passé, ou l'erreur du serveur. */
  const geste = async (faire: () => Promise<unknown>, reussi: string, echec: string): Promise<void> => {
    setEnCours(true);
    setMessage(null);
    try {
      await faire();
      setMessage({ genre: 'ok', texte: reussi });
      await recharger();
    } catch (e: unknown) {
      setMessage({ genre: 'erreur', texte: e instanceof Error ? e.message : echec });
    } finally {
      setEnCours(false);
    }
  };

  const couper = async (): Promise<void> => {
    if (!(await confirmer({
      titre: t('Couper la boutique Shopify', 'Cut the Shopify store'),
      message: t(
        'Plus aucun message de commande ne partira. L’app reste installée sur votre boutique : désinstallez-la depuis la page des apps de la boutique. Vous pourrez la rebrancher ici ou depuis Claude Code.',
        'No order message will go out anymore. The app stays installed on your store: uninstall it from the store apps page. You can reconnect it here or from Claude Code.',
      ),
      confirmer: t('Couper', 'Cut'),
    }))) return;
    await geste(() => couperShopify(tenantId), t('Boutique coupée : plus aucun message ne part.', 'Store cut: no message goes out anymore.'), t('Coupure impossible', 'Unable to cut'));
  };

  /**
   * La pause (décision 15) : ses parcours en cours s'arrêtent et rien ne part plus ; à la reprise, rien de ce qui s'est
   * passé pendant la pause n'est rattrapé. La mettre se confirme, la reprendre non.
   */
  const basculerLaPause = async (pause: boolean): Promise<void> => {
    if (pause && !(await confirmer({
      titre: t('Mettre la boutique en pause', 'Pause the store'),
      message: t(
        'Aucun message Shopify ne partira plus, et les parcours en cours s’arrêtent. À la reprise, les commandes et les paniers de la pause ne sont pas rattrapés.',
        'No Shopify message will go out anymore, and running journeys stop. When you resume, the orders and checkouts of the pause are not caught up.',
      ),
      confirmer: t('Mettre en pause', 'Pause'),
    }))) return;
    await geste(
      () => reglerPauseShopify(tenantId, pause),
      pause ? t('Boutique en pause : rien ne part.', 'Store paused: nothing goes out.') : t('Boutique reprise : ses automations repartent.', 'Store resumed: its automations go out again.'),
      t('Réglage impossible', 'Unable to save'),
    );
  };

  const fini = async (bilan: string): Promise<void> => {
    setImportOuvert(false);
    setMessage({ genre: 'ok', texte: bilan });
    await recharger();
  };
  /** Branchée ; `avertissement` : l'attestation n'a pas pu être enregistrée, la carte le dit à la place du succès. */
  const branchee = async (texte: string, avertissement?: string): Promise<void> => {
    setMessage(avertissement ? { genre: 'erreur', texte: avertissement } : { genre: 'ok', texte });
    await recharger();
  };

  if (lecture === 'en_cours' || lecture === 'absente') return null;
  const b = vue?.boutique ?? null;
  const compteurs = Object.entries(vue?.compteurs ?? {}).filter(([, n]) => n > 0);
  const etatPanier = etatDeLAutomation(vue?.lignes.find((l) => l.evenement === 'checkout_abandoned'));
  const relanceEnService = etatPanier === 'active' || etatPanier === 'active_nouvelle_version';

  return (
    <section id="integration-shopify" className={cardCls} data-testid="integration-shopify">
      <h3 className="text-sm font-semibold text-ink-900">Shopify</h3>
      {lecture === 'echec' && <p className="mt-1 text-sm text-danger">{t('La lecture a échoué : rechargez la page.', 'The read failed: reload the page.')}</p>}
      {lecture === 'ok' && b === null && (
        <>
          <p className="mt-1 text-sm text-ink-500" data-testid="integration-shopify-vide">
            {t(
              'Vos clients reçoivent sur WhatsApp la confirmation de leur commande, son expédition, et une relance s’ils abandonnent leur panier.',
              'Your customers get on WhatsApp their order confirmation, its shipping, and a reminder if they abandon their checkout.',
            )}
          </p>
          <ShopifyBrancher tenantId={tenantId} onBranche={(a) => branchee(t('Boutique branchée : allumez maintenant ses automations dans Scénario > Automation > Shopify.', 'Store connected: now turn its automations on in Scenario > Automation > Shopify.'), a)} />
        </>
      )}
      {b !== null && (
        <div className="mt-1 space-y-3 text-sm">
          <p className="text-ink-500" data-testid="integration-shopify-etat">
            {b.etat === 'connectee'
              ? t(`Boutique ${b.nom ?? b.domaine} branchée (${b.domaine}).`, `Store ${b.nom ?? b.domaine} connected (${b.domaine}).`)
              : t(`Boutique ${b.domaine} coupée : plus aucun message ne part.`, `Store ${b.domaine} cut: no message goes out anymore.`)}
            {b.dernierEvenementLe && ` ${t('Dernier événement reçu', 'Last event received')} : ${new Date(b.dernierEvenementLe).toLocaleString()}.`}
          </p>
          {b.etat === 'coupee' && b.origine === 'claude_code' && (
            <p className="text-ink-500">
              {t(
                'Branchée par Claude Code : rebranchez-la depuis Claude Code, ou ici avec les clés de son app (elle reste alors branchée par Claude Code).',
                'Connected by Claude Code: reconnect it from Claude Code, or here with its app’s keys (it then stays connected by Claude Code).',
              )}
            </p>
          )}
          {/* Rebrancher : une boutique coupée, ou une boutique de la console dont l'abonnement des événements a échoué
              (le refus le dit au branchement ; relu plus tard, la carte la montre branchée : relecture du lot 3). */}
          {(b.etat === 'coupee' || b.origine === 'console') && (
            <ShopifyBrancher tenantId={tenantId} rebrancher onBranche={(a) => branchee(t('Boutique rebranchée.', 'Store reconnected.'), a)} />
          )}
          {b.etat === 'connectee' && (
            <>
              <p className="text-ink-900" data-testid="integration-shopify-automations">
                {t(
                  'Ses messages (commande payée, commande expédiée, panier abandonné) sont des automations : allumez-les et réglez-les dans ',
                  'Its messages (order paid, order shipped, abandoned checkout) are automations: turn them on and set them up in ',
                )}
                <Link href="/automations/shopify" className="text-brand-600 hover:underline">{t('Scénario > Automation > Shopify', 'Scenario > Automation > Shopify')}</Link>.
              </p>
              <div className="flex flex-wrap items-center gap-3" data-testid="integration-shopify-pause">
                <Toggle
                  checked={b.pauseLe !== null} onChange={() => void basculerLaPause(b.pauseLe === null)} disabled={enCours}
                  libelle={t('Boutique en pause', 'Store paused')} testid="integration-shopify-pause-interrupteur"
                />
                <span className="text-ink-900">
                  {b.pauseLe === null
                    ? t('Pause : aucune. Les automations allumées partent.', 'Pause: none. Automations that are on go out.')
                    : t(`En pause depuis le ${new Date(b.pauseLe).toLocaleString()} : rien ne part.`, `Paused since ${new Date(b.pauseLe).toLocaleString()}: nothing goes out.`)}
                </span>
              </div>
            </>
          )}
          {relanceEnService && (
            <p className="text-ink-500" data-testid="integration-shopify-paniers">
              {t(
                `Paniers abandonnés : relance ${b.delaiPanierMinutes ?? 60} min après la dernière modification. Sur 7 jours, ${Object.values(vue!.paniers.relances).reduce((s, n) => s + n, 0)} relancés (${vue!.paniers.relances.envoye ?? 0} partis), ${vue!.paniers.fermesATemps} devenus une commande à temps, ${vue!.paniers.enAttente} en attente.`,
                `Abandoned checkouts: reminder ${b.delaiPanierMinutes ?? 60} min after the last change. Over 7 days, ${Object.values(vue!.paniers.relances).reduce((s, n) => s + n, 0)} reminded (${vue!.paniers.relances.envoye ?? 0} sent), ${vue!.paniers.fermesATemps} turned into an order in time, ${vue!.paniers.enAttente} waiting.`,
              )}
              {/* Le chiffre d'affaires attribué (plan 2026-10-30) : relances parties et récupérés comptés sur la MÊME date,
                  celle de la relance, pour qu'ils se comparent ; les commandes de test ne comptent pas. */}
              {' '}
              {t(
                `Selon la date de la relance : ${vue!.paniers.relancesParties} relances parties, ${vue!.paniers.recuperes} récupérés${montantsRecuperes(vue!, 'fr', ' pour ')}${vue!.paniers.recuperesTest > 0 ? `, et ${vue!.paniers.recuperesTest} de test, non comptés` : ''}.`,
                `By reminder date: ${vue!.paniers.relancesParties} reminders sent, ${vue!.paniers.recuperes} recovered${montantsRecuperes(vue!, 'en', ' for ')}${vue!.paniers.recuperesTest > 0 ? `, plus ${vue!.paniers.recuperesTest} recovered in test, not counted` : ''}.`,
              )}
            </p>
          )}
          {b.etat === 'connectee' && (
            <p className="flex flex-wrap items-center gap-2 text-ink-900">
              {t('Vos clients abonnés à votre marketing dans Shopify peuvent entrer dans vos contacts.', 'Your customers subscribed to your marketing in Shopify can join your contacts.')}
              <Bouton type="button" taille="petite" variante="secondaire" onClick={() => setImportOuvert(true)} data-testid="integration-shopify-importer">{t('Importer', 'Import')}</Bouton>
            </p>
          )}
          {b.origine === 'console' && (
            <p className="text-ink-500" data-testid="integration-shopify-rgpd">
              {t(
                'Branchée depuis la console, la boutique ne nous transmet pas les demandes d’effacement de vos clients : quand Shopify vous en transmet une, supprimez vous-même la fiche du client dans Contacts.',
                'Connected from the console, the store does not forward your customers’ erasure requests to us: when Shopify forwards one to you, delete the customer’s record yourself in Contacts.',
              )}
            </p>
          )}
          {compteurs.length > 0 && (
            <ul className="space-y-0.5 text-ink-500" data-testid="integration-shopify-compteurs">
              <li className="font-medium text-ink-900">{t('Les 30 derniers jours', 'The last 30 days')}</li>
              {compteurs.map(([issue, n]) => <li key={issue}>{n} {t(...(ISSUES[issue] ?? [issue, issue]))}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {b.etat === 'connectee' && (
              <Bouton type="button" variante="secondaire" onClick={() => void couper()} disabled={enCours} enCours={enCours} data-testid="integration-shopify-couper">
                {t('Couper', 'Cut')}
              </Bouton>
            )}
            {vue!.pageApps && (
              <a href={vue!.pageApps} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                {t('La page des apps de la boutique', 'The store apps page')}
              </a>
            )}
          </div>
        </div>
      )}
      {message && <p className={`mt-3 text-sm ${message.genre === 'ok' ? 'text-ink-900' : 'text-danger'}`} data-testid="integration-shopify-message">{message.texte}</p>}
      {importOuvert && <ShopifyImport tenantId={tenantId} onClose={() => setImportOuvert(false)} onFini={fini} />}
    </section>
  );
}
