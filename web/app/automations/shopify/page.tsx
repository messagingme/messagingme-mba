'use client';

import { AppShell } from '@/components/AppShell';
import { AutomationsShopify } from '@/components/AutomationsShopify';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { useT } from '@/lib/i18n';

/**
 * SCÉNARIO > AUTOMATION > SHOPIFY (menu « Scénario », lot 7) : les automations de la boutique, sur leur page. Elles
 * étaient en tête de l'écran Automation depuis le lot 5 ; `/automations` ne garde que les « Autres ».
 */
export default function AutomationsShopifyPage() {
  return <AppShell active="automations-shopify">{(session) => <AutomationsShopifyInner tenantId={session.tenantId} />}</AppShell>;
}

function AutomationsShopifyInner({ tenantId }: { tenantId: string }) {
  const t = useT();
  return (
    <div className="space-y-5 p-4">
      <div>
        <TitrePage>{t('Automations Shopify', 'Shopify automations')}</TitrePage>
        <IntroPage>
          {t(
            'Les messages de votre boutique. Chacun est un scénario : son premier bloc est le message envoyé, la suite répond au client.',
            'Your store’s messages. Each one is a scenario: its first block is the message sent, the rest answers the customer.',
          )}
        </IntroPage>
      </div>
      <AutomationsShopify tenantId={tenantId} />
    </div>
  );
}
