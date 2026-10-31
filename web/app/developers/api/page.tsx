'use client';

import Link from 'next/link';
import { CadreDoc } from '@/components/doc-api/CadreDoc';
import {
  ADRESSE_API, ApiOuMcp, Bloc, C, CLE_EXEMPLE, Encadre, EnTetePage, IndexEndpoints, LienDoc, Liste, Section, Sous, curl, json,
} from '@/components/doc-api/elements';
import { useT } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import { EXEMPLES_CORPS, EXEMPLES_REPONSES } from '@/lib/api-exemples';

/**
 * L'ACCUEIL DE LA DOCUMENTATION DE L'API, dans l'ordre de quelqu'un qui démarre (audit du 2026-10-31) : API ou MCP,
 * la clé (sans elle, aucun appel ne passe, et ils sont tous réels), le premier appel, la suite, le contrat à importer
 * dans son outil, puis l'index de tous les endpoints (`@/lib/api-doc-endpoints`). Court par construction : le détail vit
 * dans les pages de `@/lib/doc-api-pages`. C'est l'adresse publiée sur la vitrine (`site/index.html`) : elle ne bouge
 * pas, ses ancres non plus. Le cadre (public ou console) est `CadreDoc`, qui renvoie aussi les ancres de l'ancienne
 * page unique vers leur nouvelle adresse.
 */
export default function ApiDocsPage() {
  return <CadreDoc page="accueil">{(session) => <Accueil session={session} />}</CadreDoc>;
}

function Accueil({ session }: { session: Session | null }) {
  const t = useT();
  return (
    <>
      <EnTetePage page="accueil">
        <p>
          {t(
            'API REST : contacts, messages WhatsApp et RCS, envois, et chaque événement poussé vers votre serveur par un webhook signé.',
            'REST API: contacts, WhatsApp and RCS messages, sends, and every event pushed to your server through a signed webhook.',
          )}
        </p>
      </EnTetePage>

      <Section id="api-ou-mcp" titre={t('API ou MCP ?', 'API or MCP?')}>
        <ApiOuMcp />
      </Section>

      <Section id="authentification" titre={t('Votre clé', 'Your key')}>
        <p>{t('Chaque appel porte une clé d’API dans l’en-tête Authorization :', 'Every call carries an API key in the Authorization header:')}</p>
        <Bloc legende={t('En-tête', 'Header')}>{`Authorization: Bearer ${CLE_EXEMPLE}`}</Bloc>
        <Liste>
          <li>
            {t(
              'Un administrateur de l’espace la crée dans la console, Developers > Clés d’API, quelle que soit l’offre, ou la demande à Claude (',
              'A workspace administrator creates it in the console, Developers > API keys, whatever the plan, or asks Claude for it (',
            )}
            <C>create_api_key</C>
            {t(
              ') ; une clé créée par Claude a des droits limités (ni le MCP, ni les webhooks, ni la suppression de contacts), qui se donnent dans la console.',
              '); a key created by Claude has limited scopes (no MCP, no webhooks, no contact deletion), which are granted in the console.',
            )}
            {session && (
              <>
                {' '}
                <Link href="/developers/keys" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
                  {t('Gérer les clés', 'Manage keys')}
                </Link>
              </>
            )}
          </li>
          <li>
            {t(
              'Cochez seulement les droits dont votre code a besoin. La clé (mba_…) n’est montrée qu’une fois : gardez-la côté serveur, dans une variable d’environnement.',
              'Tick only the scopes your code needs. The key (mba_…) is shown only once: keep it server-side, in an environment variable.',
            )}
          </li>
        </Liste>
        <Encadre sorte="attention">
          <p>
            {t(
              'Les appels sont réels : il n’y a pas d’espace de test. Un envoi part vraiment sur WhatsApp, et Meta peut le facturer à votre entreprise. Pour essayer, écrivez d’abord à votre propre téléphone.',
              'Calls are real: there is no test workspace. A send really goes out on WhatsApp, and Meta may bill it to your business. To try things out, write to your own phone first.',
            )}
          </p>
        </Encadre>
        {/* L'ancre englobe le titre ET le bloc : la vitrine y mène, et l'e2e y cherche le bloc et son bouton Copier. */}
        <div id="adresse" className="scroll-mt-20 space-y-4">
          <Sous>{t('Adresse de base', 'Base URL')}</Sous>
          <Bloc legende={t('Adresse de base', 'Base URL')}>{`${ADRESSE_API}/v1`}</Bloc>
        </div>
        <p className="text-sm text-ink-500">
          {t('Droits, débit et erreurs :', 'Scopes, rate limit and errors:')}{' '}
          <LienDoc page="reference">{t('Authentification, limites et erreurs', 'Authentication, limits and errors')}</LienDoc>.
        </p>
      </Section>

      <Section id="premier-appel" titre={t('Premier appel', 'First call')}>
        <p>
          {t(
            'Créer une fiche, ou la mettre à jour si elle existe. Rien ne part sur WhatsApp :',
            'Create a record, or update it if it exists. Nothing goes out on WhatsApp:',
          )}
        </p>
        <Bloc legende={t('Commande', 'Command')}>{curl('/v1/contacts', EXEMPLES_CORPS.contactCreer.corps)}</Bloc>
        <Bloc legende={t('Réponse 200', '200 response')}>{json(EXEMPLES_REPONSES.contactEcrit)}</Bloc>
        <p className="text-sm text-ink-500">
          {t('Détail :', 'Details:')} <LienDoc page="contacts" ancre="creer">POST /v1/contacts</LienDoc>.
        </p>
      </Section>

      <Section id="ensuite" titre={t('Ensuite', 'Next')}>
        <Liste>
          <li>
            <LienDoc page="quickstart">{t('Démarrer', 'Quickstart')}</LienDoc>
            {t(' : du numéro au premier message envoyé, étape par étape.', ': from the number to the first message sent, step by step.')}
          </li>
          <li>
            <LienDoc page="sdk">{t('Le SDK TypeScript', 'The TypeScript SDK')}</LienDoc>
            {t(' : des appels et des erreurs typés, la vérification des webhooks.', ': typed calls and errors, webhook verification.')}
          </li>
          <li>
            <LienDoc page="concepts">{t('Les concepts', 'The concepts')}</LienDoc>
            {t(
              ' : désigner une personne, le consentement et STOP, la fenêtre de 24 h, l’idempotence.',
              ': identifying a person, consent and STOP, the 24-hour window, idempotency.',
            )}
          </li>
          <li>
            <LienDoc page="errors">{t('Les erreurs', 'The errors')}</LienDoc>
            {t(' : chaque code, et quoi faire.', ': every code, and what to do.')}
          </li>
        </Liste>
      </Section>

      <Section id="openapi" titre={t('Utiliser le contrat dans votre outil', 'Use the contract in your tool')}>
        <p>
          {t(
            'Le contrat OpenAPI 3.1 de l’API, servi par l’API elle-même et donc toujours égal au code en production : chaque route, son droit, son corps, sa réponse, ses erreurs, et les événements des webhooks sortants.',
            'The OpenAPI 3.1 contract of the API, served by the API itself and therefore always equal to the code in production: every route, its scope, its body, its response, its errors, and the outgoing webhook events.',
          )}
        </p>
        <Bloc legende={t('Contrat', 'Contract')}>{`${ADRESSE_API}/openapi.json`}</Bloc>
        <p>
          {t(
            'Importez cette adresse, ou le fichier, dans Postman, Bruno ou Insomnia : chacun en fait une collection de requêtes, prête à essayer. Ajoutez-y l’en-tête Authorization avec votre clé.',
            'Import this address, or the file, into Postman, Bruno or Insomnia: each one turns it into a collection of requests, ready to try. Add the Authorization header with your key there.',
          )}
        </p>
        <p>
          <a href={`${ADRESSE_API}/openapi.json`} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
            {t('Ouvrir le contrat', 'Open the contract')}
          </a>
        </p>
        <p className="text-sm text-ink-500">
          {t('En TypeScript, le client généré depuis ce contrat :', 'In TypeScript, the client generated from this contract:')}{' '}
          <LienDoc page="sdk">{t('SDK TypeScript', 'TypeScript SDK')}</LienDoc>.
        </p>
      </Section>

      <Section id="endpoints" titre={t('Tous les endpoints', 'All endpoints')}>
        <IndexEndpoints />
      </Section>
    </>
  );
}
