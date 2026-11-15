// La page « Deep HubSpot integration » du menu Solutions (2026-11-15, demande de Julien) : écrite à la main dans
// `site/solutions/deep-hubspot-integration/`, sa jumelle anglaise générée par `vitrine:anglais`. Le menu Solutions
// (`entete.ts`) et la page Solutions (`cas.ts`) la placent après les boutiques, depuis ces textes.
export const HUBSPOT_SOLUTION = {
  icone: 'i-arrows-left-right',
  fr: {
    adresse: '/solutions/deep-hubspot-integration/',
    titre: 'Deep HubSpot integration',
    menu: 'WhatsApp au cœur de votre HubSpot',
    description: 'Chaque conversation WhatsApp remonte analysée dans HubSpot et devient une action.',
  },
  en: {
    adresse: '/en/solutions/deep-hubspot-integration/',
    titre: 'Deep HubSpot integration',
    menu: 'WhatsApp at the heart of your HubSpot',
    description: 'Every WhatsApp conversation comes back analyzed in HubSpot and becomes an action.',
  },
} as const;
