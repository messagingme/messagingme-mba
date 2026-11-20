'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { classesBouton } from '@/components/Bouton';

/**
 * LE VOLET « MAKE, N8N, ZAPIER » DE TOOLS > INTÉGRATIONS (2026-11-20, demande de Julien). Il n'ajoute aucune mécanique :
 * il oriente, sens par sens, vers les écrans qui existent déjà, et vers la fiche-chapeau du centre d'aide
 * (`docs/aide/fiches/brancher-make-n8n-ou-zapier.md`), qui renvoie elle-même à la fiche de chaque voie.
 * - Recevoir (l'outil nous envoie) : le webhook entrant, ou notre API avec une clé.
 * - Envoyer (nous envoyons à l'outil) : tous les événements par un webhook sortant, ou à un moment précis d'un scénario
 *   par un connecteur API que joue le bloc Appel API.
 */
export function IntegrationAutomatisation() {
  const t = useT();
  const ligne = (testid: string, texte: string, href: string, bouton: string) => (
    <li className="flex items-center justify-between gap-4" data-testid={testid}>
      <span className="min-w-0 flex-1 text-sm text-ink-700">{texte}</span>
      <Link href={href} className={classesBouton('secondaire', 'petite', 'shrink-0 whitespace-nowrap')}>{bouton}</Link>
    </li>
  );
  return (
    <div className="space-y-5" data-testid="integration-automatisation">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-900">{t('Recevoir : votre outil nous envoie des données', 'Receive: your tool sends us data')}</p>
        <ul className="space-y-2">
          {ligne('automatisation-webhook-entrant',
            t('Un webhook entrant : une adresse à coller dans votre outil, puis chaque valeur attachée à la fiche du contact.', 'An incoming webhook: an address to paste into your tool, then each value attached to the contact record.'),
            '/webhooks', t('Webhooks', 'Webhooks'))}
          {ligne('automatisation-cle-api',
            t('Ou notre API, avec une clé : pour envoyer un modèle WhatsApp ou lire un contact depuis votre outil.', 'Or our API, with a key: to send a WhatsApp template or read a contact from your tool.'),
            '/developers/keys', t('Clés d’API', 'API keys'))}
        </ul>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-900">{t('Envoyer : nous envoyons vos données à votre outil', 'Send: we send your data to your tool')}</p>
        <ul className="space-y-2">
          {ligne('automatisation-webhook-sortant',
            t('Tous les événements, en continu : message reçu, lien cliqué, désabonnement, conversation analysée…', 'Every event, continuously: message received, link clicked, unsubscribe, analysed conversation…'),
            '/developers/evenements', t('Webhooks sortants', 'Outgoing webhooks'))}
          {ligne('automatisation-connecteur',
            t('À un moment précis d’un scénario : un connecteur API, joué par le bloc Appel API.', 'At a precise point of a scenario: an API connector, played by the API call block.'),
            '/connecteurs', t('Connecteurs API', 'API connectors'))}
        </ul>
      </div>
      <a
        href={t('https://app.messagingme.fr/aide/brancher-make-n8n-ou-zapier/', 'https://app.messagingme.fr/en/help/connect-make-n8n-or-zapier/')}
        target="_blank" rel="noopener noreferrer" data-testid="automatisation-guide"
        className="inline-block text-sm font-medium text-brand-600 hover:underline"
      >
        {t('Le guide pas à pas', 'The step-by-step guide')}
      </a>
    </div>
  );
}
