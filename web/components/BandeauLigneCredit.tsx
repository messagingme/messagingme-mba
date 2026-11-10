'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { lireEtatLigne } from '@/lib/api-credit-whatsapp';
import { Icone } from '@/components/Icone';

/** Le bandeau masqué d'un clic, sur ce navigateur et pour cet espace. */
const cleMasque = (tenantId: string): string => `mba.bandeau-ligne-credit.${tenantId}`;

/**
 * LE BANDEAU DE LA CONVERSION (révision du Crédit WhatsApp du 2026-11-04, lot C, moment 2 ; texte validé par Julien le
 * 2026-11-06) : la vente ouverte, l'option se prend en ligne et n'est ni prise ni payée (`a_prendre`, l'état des cartes
 * « Qui paie vos messages à Meta ? »), donc pour un Pro dès le début de son essai ou un Business confirmé (la règle de la
 * prise du serveur, lot 3v V1). Sur toutes les pages, pour un administrateur d'un Pro ou d'un Business (l'AppShell ne le
 * monte que pour eux, ce qui épargne la lecture aux autres) ; l'e-mail du même moment va aux mêmes. Masqué d'un clic. Une
 * API sans la route, ou une lecture qui échoue : aucun bandeau.
 */
export function BandeauLigneCredit({ tenantId }: { tenantId: string }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let masque = false;
    try { masque = window.localStorage.getItem(cleMasque(tenantId)) === '1'; } catch { /* stockage indisponible : il paraît */ }
    if (masque) return;
    let vivant = true;
    lireEtatLigne(tenantId)
      .then((v) => { if (vivant) setVisible(v !== null && v.enVente && v.etat === 'a_prendre'); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [tenantId]);

  if (!visible) return null;
  const masquer = (): void => {
    setVisible(false);
    try { window.localStorage.setItem(cleMasque(tenantId), '1'); } catch { /* stockage indisponible : il revient au prochain chargement */ }
  };

  return (
    <div className="shrink-0 border-b border-brand-200 bg-brand-50 px-4 py-2 text-ink-900 sm:px-6" data-testid="bandeau-ligne-credit">
      <div className="mx-auto flex w-full max-w-liste flex-wrap items-center gap-3 text-sm">
        <span>
          {t(
            'Votre formule est active : vous pouvez maintenant payer vos messages chez Messaging Me, sans carte chez Meta, 30 € HT par numéro et par mois.',
            'Your plan is active: you can now pay for your messages at Messaging Me, with no card at Meta, €30 excl. VAT per number per month.',
          )}
        </span>
        <Link href="/offre?tab=whatsapp" data-testid="bandeau-ligne-credit-voir"
          className="ml-auto rounded-controle border border-current bg-white px-3 py-1.5 text-xs font-semibold transition-colors duration-150 hover:bg-ink-50">
          {t('Voir le Crédit WhatsApp', 'See WhatsApp credit')}
        </Link>
        <button type="button" onClick={masquer} data-testid="bandeau-ligne-credit-masquer" title={t('Masquer', 'Hide')}
          className="rounded-controle px-2 py-1 text-ink-500 hover:bg-white">
          <Icone nom="fermer" taille="petite" titre={t('Masquer', 'Hide')} />
        </button>
      </div>
    </div>
  );
}
