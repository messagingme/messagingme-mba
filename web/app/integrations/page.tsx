'use client';

import { AppShell } from '@/components/AppShell';
import { useT } from '@/lib/i18n';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { VoletIntegration } from '@/components/VoletIntegration';
import { ConnecteurSurDemande } from '@/components/ConnecteurSurDemande';
import { IntegrationAutomatisation } from '@/components/IntegrationAutomatisation';
import { ReglageIntegrationBatch } from '@/components/ReglageIntegrationBatch';
import { ReglageHubspot } from '@/components/ReglageHubspot';
import { ReglageSalesforce } from '@/components/ReglageSalesforce';
import { ReglageShopify } from '@/components/ReglageShopify';

/**
 * TOOLS > INTÉGRATIONS (2026-10-26, demande de Julien) : les outils du client que la console branche. Ils vivaient dans
 * Paramètres > Général, qui ne règle plus que l'espace (fuseau, heures, équipe) ; ils rejoignent Tools, qui regroupe ce
 * qui BRANCHE la console sur l'extérieur.
 *
 * UN VOLET PAR OUTIL, REPLIÉ (2026-11-20, demande de Julien) : le logo, le nom et ce que fait l'outil ; sa carte de
 * réglage se déplie dedans (`VoletIntegration`). HubSpot, Salesforce et Dynamics 365 sont des connecteurs CRM, réservés à
 * l'offre Entreprise ; Dynamics 365 n'a pas de carte, il se branche avec nous (`ConnecteurSurDemande`).
 *
 * Réservée aux administrateurs, comme l'étaient ces cartes et comme leurs routes (`g.admin`) : `integrations` n'est pas
 * dans `ECRANS_ENCADREMENT`, la coquille y renvoie un manager à l'Inbox. Chaque carte lit l'offre et se ferme d'elle-même.
 *
 * ⚠️ LES ANCRES NE CHANGENT PAS (`#integration-hubspot`, `#integration-shopify`…) : l'Accueil, les guides et des liens
 * déjà partis les nomment, et `/parametres#integration-…` renvoie ici avec la même ancre. Elles déplient leur volet.
 */
export default function IntegrationsPage() {
  return (
    <AppShell active="integrations">
      {(session) => <Integrations tenantId={session.tenantId} />}
    </AppShell>
  );
}

function Integrations({ tenantId }: { tenantId: string }) {
  const t = useT();
  const enTravaux = (
    <p className="text-sm text-ink-500" data-testid="integration-en-travaux">
      {t('En cours de développement.', 'Work in progress.')}
    </p>
  );
  return (
    <div className="mx-auto max-w-formulaire space-y-6">
      <header className="space-y-1">
        <span className="text-xs font-medium text-ink-500">{t('Tools', 'Tools')}</span>
        <TitrePage>{t('Intégrations', 'Integrations')}</TitrePage>
        <IntroPage>
          {t(
            'Les outils de votre entreprise que Messaging Me alimente : votre outil marketing, votre CRM et votre boutique.',
            'The business tools Messaging Me feeds: your marketing tool, your CRM and your store.',
          )}
        </IntroPage>
      </header>
      <div className="space-y-3">
        {/* La boutique Shopify (2026-10-21) : brancher, importer les clients, mettre en pause, couper. */}
        <VoletIntegration cle="shopify" logo="/logos/shopify-noir.svg" logoLarge nom="Shopify"
          resume={t('Commandes, expéditions et paniers abandonnés sur WhatsApp.', 'Orders, shipping and abandoned carts on WhatsApp.')}>
          <ReglageShopify tenantId={tenantId} siAbsente={enTravaux} />
        </VoletIntegration>
        {/* L'outil qui reçoit les signaux (lot 6 de l'API publique). */}
        <VoletIntegration cle="batch" logo="/logos/batch.svg" logoLarge nom="Batch"
          resume={t('Reçoit les signaux de la console sur les profils qu’il connaît.', 'Receives the console’s signals on the profiles it knows.')}>
          <ReglageIntegrationBatch tenantId={tenantId} />
        </VoletIntegration>
        {/* L'interrupteur HubSpot (migration 0179) : c'est lui qui fait apparaître le bloc HubSpot de l'Accueil, numéro ou
            pas. L'Accueil renvoie ici (`#integration-hubspot`) quand il est éteint. */}
        <VoletIntegration cle="hubspot" logo="/logos/hubspot.svg" nom="HubSpot"
          resume={t('Fiches, conversations, modèles et workflows reliés à votre CRM.', 'Records, conversations, templates and workflows linked to your CRM.')}>
          <ConnecteurSurDemande tenantId={tenantId} nom="HubSpot">
            <ReglageHubspot tenantId={tenantId} />
          </ConnecteurSurDemande>
        </VoletIntegration>
        {/* Salesforce et Dynamics 365 se branchent avec nous : l'Entreprise a un bouton de contact, les autres offres la
            ligne « Inclus dans l'offre Entreprise » (`ConnecteurSurDemande`). */}
        <VoletIntegration cle="salesforce" logo="/logos/salesforce.svg" nom="Salesforce"
          resume={t('Les conversations WhatsApp dans votre org Salesforce.', 'WhatsApp conversations in your Salesforce org.')}>
          <ReglageSalesforce tenantId={tenantId} siAbsente={<ConnecteurSurDemande tenantId={tenantId} nom="Salesforce" sujet="salesforce" />} />
        </VoletIntegration>
        <VoletIntegration cle="dynamics" logo="/logos/dynamics-365.svg" nom="Dynamics 365"
          resume={t('Les conversations WhatsApp dans Microsoft Dynamics 365.', 'WhatsApp conversations in Microsoft Dynamics 365.')}>
          <ConnecteurSurDemande tenantId={tenantId} nom="Dynamics 365" sujet="dynamics" />
        </VoletIntegration>
        {/* Les outils d'automatisation sans code (2026-11-20) : ce volet oriente vers les écrans existants, sens par sens. */}
        <VoletIntegration cle="automatisation" logo={['/logos/make.svg', '/logos/n8n.svg', '/logos/zapier.svg']} nom="Make, n8n, Zapier"
          resume={t('Recevoir leurs données, et leur envoyer les vôtres.', 'Receive their data, and send them yours.')}>
          <IntegrationAutomatisation />
        </VoletIntegration>
      </div>
    </div>
  );
}
