'use client';

import { AppShell } from '@/components/AppShell';
import { FacturesEspace } from '@/components/FacturesEspace';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { useT } from '@/lib/i18n';

/**
 * FACTURATION (2026-11-16, demande de Julien : un onglet de Paramètres qui liste les factures et donne leurs liens Stripe).
 * La même liste que l'onglet Offre (`FacturesEspace`, route `/offre/factures`) : Pro, numéro et recharges, chacune avec sa
 * page et son PDF hébergés par Stripe. Admin seul, comme l'Offre : le serveur tient la même frontière.
 */
export default function FacturesPage() {
  const t = useT();
  return (
    <AppShell active="parametres-factures">
      {(session) => (
        <div className="mx-auto max-w-formulaire space-y-6">
          <header>
            <TitrePage>{t('Facturation', 'Billing')}</TitrePage>
            <IntroPage>{t('Toutes les factures de votre espace, avec leur lien Stripe.', 'All your workspace invoices, with their Stripe link.')}</IntroPage>
          </header>
          <FacturesEspace tenantId={session.tenantId} />
        </div>
      )}
    </AppShell>
  );
}
