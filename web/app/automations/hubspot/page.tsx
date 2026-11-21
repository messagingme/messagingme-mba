'use client';

import { AppShell } from '@/components/AppShell';
import { AutomationsHubspot } from '@/components/AutomationsHubspot';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { useT } from '@/lib/i18n';

/**
 * SCÉNARIO > AUTOMATION > HUBSPOT (menu « Scénario », lots 6c et 7) : les automations que HubSpot déclenche, sur leur page,
 * comme celles de Shopify. `/automations` ne garde que les « Autres ».
 */
export default function AutomationsHubspotPage() {
  return <AppShell active="automations-hubspot" pleineLargeur>{(session) => <AutomationsHubspotInner tenantId={session.tenantId} />}</AppShell>;
}

function AutomationsHubspotInner({ tenantId }: { tenantId: string }) {
  const t = useT();
  return (
    <div className="space-y-5 p-4">
      <div>
        <TitrePage>{t('Automations HubSpot', 'HubSpot automations')}</TitrePage>
        <IntroPage>
          {t(
            'Les messages que HubSpot déclenche : un deal qui change d’étape, un rendez-vous, un workflow HubSpot. Chacun est un scénario : son premier bloc est le message envoyé, la suite répond au client.',
            'The messages HubSpot triggers: a deal that changes stage, a meeting, a HubSpot workflow. Each one is a scenario: its first block is the message sent, the rest answers the customer.',
          )}
        </IntroPage>
      </div>
      <AutomationsHubspot tenantId={tenantId} />
    </div>
  );
}
