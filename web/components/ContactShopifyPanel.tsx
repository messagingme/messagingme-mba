'use client';

import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/day';
import { getAchatsShopify } from '@/lib/achats-shopify';
import { fmtMontant, libelleSource } from '@/lib/ventes';
import { BORNES_ACHATS, type AchatsShopifyVue, type PanierShopifyVue } from '@/lib/partage/achats-shopify';
import { Squelette } from '@/components/Squelette';

/**
 * Onglet « Shopify » de la fiche contact (plan 2026-11-16) : tout ce que la boutique nous a appris de ce client. Ses
 * commandes, ce que WhatsApp en a rapporté, ses paniers abandonnés. Lecture seule.
 *
 * Chargé au premier affichage de l'onglet seulement, comme l'Historique. 🔴 Une erreur (une API plus ancienne qui rend
 * 404, une panne) dit « indisponible », jamais « aucune commande » : ce serait mentir sur un client qui a commandé.
 */
export function ContactShopifyPanel({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [etat, setEtat] = useState<{ etat: 'charge' } | { etat: 'erreur' } | { etat: 'pret'; achats: AchatsShopifyVue }>({ etat: 'charge' });

  useEffect(() => {
    let alive = true;
    setEtat({ etat: 'charge' });
    getAchatsShopify(tenantId, contactId)
      .then((a) => { if (alive) setEtat(a ? { etat: 'pret', achats: a } : { etat: 'erreur' }); })
      .catch(() => { if (alive) setEtat({ etat: 'erreur' }); });
    return () => { alive = false; };
  }, [tenantId, contactId]);

  if (etat.etat === 'charge') return <Squelette forme="lignes" className="mt-4" />;
  if (etat.etat === 'erreur') {
    return (
      <p className="mt-4 rounded-controle bg-ink-50 px-3 py-2 text-sm text-ink-500" data-testid="fiche-shopify-indisponible">
        {t('Les achats de ce client ne sont pas lisibles pour le moment. Réessayez dans quelques minutes.', 'This customer’s purchases cannot be read right now. Try again in a few minutes.')}
      </p>
    );
  }
  const { boutique, resume, rapporte, commandes, paniers } = etat.achats;
  if (!boutique) {
    return (
      <p className="mt-4 text-sm text-ink-500" data-testid="fiche-shopify-sans-boutique">
        {t('Aucune boutique Shopify n’est branchée sur cet espace.', 'No Shopify store is connected to this workspace.')}
      </p>
    );
  }
  const montant = (m: string, devise: string | null) => (devise ? fmtMontant(m, devise, locale) : m);
  const depuis = formatDate(boutique.commandesDepuis, locale);
  /**
   * Les commandes de test ne comptent jamais dans le rapporté (la règle du chiffre attribué). Quand certaines portent
   * pourtant une source, l'écran le dit : sinon « aucune commande attribuée » contredit la liste juste en dessous (vu à
   * l'essai réel du 2026-11-16, sur l'espace de démonstration, où toutes les commandes attribuées étaient de test).
   */
  const testAttribuees = commandes.some((c) => c.test && c.attribution !== null);

  return (
    <div className="mt-4 space-y-5 text-sm" data-testid="fiche-shopify">
      <p className="text-xs text-ink-500">
        {t(
          `${boutique.nom ?? boutique.domaine} : commandes payées suivies depuis le ${depuis}, commandes de test comprises, remboursements non déduits.`,
          `${boutique.nom ?? boutique.domaine}: paid orders recorded since ${depuis}, test orders included, refunds not deducted.`,
        )}
        {boutique.coupeeLe && ` ${t(`Boutique coupée le ${formatDate(boutique.coupeeLe, locale)}.`, `Store disconnected on ${formatDate(boutique.coupeeLe, locale)}.`)}`}
      </p>

      <div data-testid="fiche-shopify-resume" className="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-2">
        <span className="text-ink-500">{t('Commandes payées', 'Paid orders')}</span>
        <span className="text-ink-900">
          {resume.commandes}
          {resume.commandesTest > 0 && (
            <span className="text-ink-500"> {t(`(dont ${resume.commandesTest} de test)`, `(${resume.commandesTest} test)`)}</span>
          )}
        </span>
        <span className="text-ink-500">{t('Total dépensé', 'Total spent')}</span>
        <span className="text-ink-900">{montant(resume.depense, boutique.devise)}</span>
        <span className="text-ink-500">{t('Dernière commande', 'Last order')}</span>
        <span className="text-ink-900">{resume.derniereLe ? formatDate(resume.derniereLe, locale) : '-'}</span>
        <span className="text-ink-500">{t('Rapporté par WhatsApp', 'Brought in by WhatsApp')}</span>
        <span className="text-ink-900" data-testid="fiche-shopify-rapporte">
          {rapporte.length === 0
            ? <span className="text-ink-500">
              {testAttribuees
                ? t('Aucune vente réelle attribuée à WhatsApp', 'No real sale attributed to WhatsApp')
                : t('Aucune commande attribuée à WhatsApp', 'No order attributed to WhatsApp')}
            </span>
            : rapporte.map((r) => (
              <span key={r.devise} className="block">
                {montant(r.montant, r.devise)}
                <span className="text-ink-500">
                  {' '}{t(`sur ${r.commandes} commande${r.commandes > 1 ? 's' : ''}`, `over ${r.commandes} order${r.commandes > 1 ? 's' : ''}`)}
                  {Number(r.prouve) > 0 && `, ${t(`dont ${montant(r.prouve, r.devise)} prouvés`, `${montant(r.prouve, r.devise)} proven`)}`}
                </span>
              </span>
            ))}
          {testAttribuees && (
            <span className="block text-xs text-ink-500" data-testid="fiche-shopify-rapporte-test">
              {t('Les commandes de test attribuées ne comptent pas dans ce chiffre.', 'Attributed test orders do not count in this figure.')}
            </span>
          )}
        </span>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">{t('Commandes', 'Orders')}</h3>
        {commandes.length === 0 ? (
          <p className="text-ink-500" data-testid="fiche-shopify-aucune-commande">
            {t(`Aucune commande de ce client depuis le ${depuis}.`, `No order from this customer since ${depuis}.`)}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100" data-testid="fiche-shopify-commandes">
              {commandes.map((c) => (
                <li key={c.commandeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="fiche-shopify-commande">
                  <span className="w-24 shrink-0 text-ink-900">{formatDate(c.payeeLe, locale)}</span>
                  <span className="w-24 shrink-0 font-medium text-ink-900">{c.montant === null ? '-' : montant(c.montant, c.devise)}</span>
                  {c.test && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">{t('test', 'test')}</span>}
                  <span className="min-w-0 flex-1 text-xs text-ink-500">
                    {c.attribution
                      ? <span className="text-brand-700">
                        {t(`WhatsApp : ${libelleSource({ source: c.attribution.source, nom: c.attribution.campagne }, t)}`, `WhatsApp: ${libelleSource({ source: c.attribution.source, nom: c.attribution.campagne }, t)}`)}
                        {c.attribution.preuve && ` (${c.attribution.preuve === 'utm' ? t('prouvé par le lien', 'proven by the link') : t('prouvé par le panier', 'proven by the checkout')})`}
                      </span>
                      : t('Non attribuée à WhatsApp', 'Not attributed to WhatsApp')}
                  </span>
                </li>
              ))}
            </ul>
            {resume.commandes > commandes.length && (
              <p className="mt-1 text-xs text-ink-500">
                {t(`Les ${BORNES_ACHATS.commandes} plus récentes sur ${resume.commandes}.`, `The ${BORNES_ACHATS.commandes} most recent of ${resume.commandes}.`)}
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
          {t(`Paniers abandonnés (${BORNES_ACHATS.joursPaniers} derniers jours)`, `Abandoned checkouts (last ${BORNES_ACHATS.joursPaniers} days)`)}
        </h3>
        {paniers.length === 0 ? (
          <p className="text-ink-500" data-testid="fiche-shopify-aucun-panier">
            {t('Aucun panier abandonné récent à son numéro.', 'No recent abandoned checkout for this number.')}
          </p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100" data-testid="fiche-shopify-paniers">
            {paniers.map((p, i) => (
              <li key={`${p.ouvertLe}-${i}`} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                <span className="w-24 shrink-0 text-ink-900">{formatDate(p.ouvertLe, locale)}</span>
                <span className="text-xs text-ink-500">{etatPanier(p, locale, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Où en est un panier : relancé, relance non partie, commandé ou fermé, ou encore ouvert. */
function etatPanier(p: PanierShopifyVue, locale: 'fr' | 'en', t: (fr: string, en?: string) => string): string {
  if (p.relanceLe && p.issue === 'envoye') return t(`Relancé sur WhatsApp le ${formatDate(p.relanceLe, locale)}`, `Reminder sent on WhatsApp on ${formatDate(p.relanceLe, locale)}`);
  if (p.issue) return t('Relance non envoyée', 'Reminder not sent');
  if (p.fermeLe) return t(`Commandé ou fermé le ${formatDate(p.fermeLe, locale)}`, `Ordered or closed on ${formatDate(p.fermeLe, locale)}`);
  return t('Ouvert, pas relancé', 'Open, no reminder sent');
}
