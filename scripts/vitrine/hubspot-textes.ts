// Les pages d'intégration CRM du menu Solutions, écrites à la main, leur jumelle anglaise générée par `vitrine:anglais` :
// « Deep HubSpot integration » (2026-11-15, `site/solutions/deep-hubspot-integration/`) et « Salesforce » (2026-11-18,
// `site/solutions/salesforce/`). Le menu Solutions (`entete.ts`), la page Solutions et `llms.txt` (`cas.ts`) les placent
// après les boutiques, dans l'ordre de `SOLUTIONS_CRM`.
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

export const SALESFORCE_SOLUTION = {
  icone: 'i-buildings',
  fr: {
    adresse: '/solutions/salesforce/',
    titre: 'Salesforce',
    menu: 'WhatsApp dans tout votre Salesforce',
    description: 'Marketing, ventes, service client : chaque conversation WhatsApp arrive dans Salesforce, analysée, et devient une action.',
  },
  en: {
    adresse: '/en/solutions/salesforce/',
    titre: 'Salesforce',
    menu: 'WhatsApp across your whole Salesforce',
    description: 'Marketing, sales, customer service: every WhatsApp conversation reaches Salesforce analyzed and becomes an action.',
  },
} as const;

export const SOLUTIONS_CRM = [HUBSPOT_SOLUTION, SALESFORCE_SOLUTION] as const;
