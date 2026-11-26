'use client';

import Link from 'next/link';
import { classesBouton } from '@/components/Bouton';
import { useLocale, useT } from '@/lib/i18n';
import { useOffre } from '@/lib/use-offre';
import { fmtNum } from '@/lib/format';

/** Le seuil d'où le bandeau propose le pack : le même que l'e-mail « vous approchez de votre limite » (80 %). */
const SEUIL = 0.8;

/**
 * LE PACK DE CONTACTS PROPOSÉ SUR LA PAGE CONTACTS (demande de Julien du 2026-11-25) : un Pro ou un Business (2026-11-26) à
 * 80 % de sa limite ou plus lit où il en est, et « Ajouter 1 000 contacts » ouvre l'achat sur la page Offre
 * (`?pack=ajouter`), qui dit le prix et demande la confirmation. Rien hors Pro et Business, rien tant que les packs ne sont
 * pas en vente, rien sur une API plus ancienne.
 */
export function BandeauPackContacts({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const vue = useOffre(tenantId);
  if (!vue || (vue.offre !== 'pro' && vue.offre !== 'business') || !vue.packsContacts || !vue.prixPackContacts) return null;
  const limite = vue.limites.contacts;
  const compte = vue.usage.contacts;
  if (limite === null || limite <= 0 || compte < limite * SEUIL) return null;
  const plein = compte >= limite;
  const pack = fmtNum(vue.packsContacts.contactsParPack, locale);
  const prix = vue.packsContacts.periodicite === 'an' ? vue.prixPackContacts.anCentimes : vue.prixPackContacts.moisCentimes;
  const prixDit = `${fmtNum(prix / 100, locale)} €`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-carte border border-brand-200 bg-brand-50 px-4 py-3" data-testid="contacts-bandeau-pack">
      <p className="min-w-0 flex-1 text-sm text-brand-700">
        {plein
          ? t(`Votre espace est plein : ${fmtNum(compte, locale)} contacts sur ${fmtNum(limite, locale)}. Les nouveaux contacts sont refusés.`,
            `Your workspace is full: ${fmtNum(compte, locale)} contacts out of ${fmtNum(limite, locale)}. New contacts are refused.`)
          : t(`Votre espace compte ${fmtNum(compte, locale)} contacts sur ${fmtNum(limite, locale)}.`,
            `Your workspace has ${fmtNum(compte, locale)} contacts out of ${fmtNum(limite, locale)}.`)}
        {vue.packsContacts.periodicite === 'an'
          ? t(` ${pack} contacts de plus : ${prixDit} HT par an.`, ` ${pack} more contacts: ${prixDit} excl. VAT a year.`)
          : t(` ${pack} contacts de plus : ${prixDit} HT par mois.`, ` ${pack} more contacts: ${prixDit} excl. VAT a month.`)}
      </p>
      <Link href="/offre?pack=ajouter" className={classesBouton('principal', 'normale')} data-testid="contacts-ajouter-pack">
        {t(`Ajouter ${pack} contacts`, `Add ${pack} contacts`)}
      </Link>
    </div>
  );
}
