'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Modale } from './Modale';
import { MbaTabs } from './MbaTabs';
import { Bloc, Etapes } from './doc-api/elements';
import { useT } from '@/lib/i18n';
import { API_PUBLIQUE, COMMANDES_PLUGIN, COMMANDE_DEMARRAGE, SERVEUR_PLUGIN_MCP } from '@/lib/demarrer';

/**
 * « UTILISER AVEC CLAUDE / CHATGPT » (demande de Julien, 2026-11-19) : l'entrée posée en bas de la barre, au-dessus de
 * Paramètres, et sa fenêtre qui dit comment piloter l'espace depuis Claude, ChatGPT ou Claude Code.
 *
 * 🔴 AUCUNE CLÉ D'API : les trois chemins passent par l'autorisation OAuth de `/mcp`, sur l'API publique (jamais le domaine
 * de la console, où `/mcp` rend 404). Une clé ouvrirait MOINS d'outils (ceux qui agissent au nom d'une personne exigent
 * OAuth) : la proposer ici serait le mauvais conseil. Le détail et le chemin à clé restent sur Developers > Serveur MCP.
 *
 * ⚠️ RÉSERVÉE AUX ADMINS par l'appelant (décision de Julien) : seul un administrateur peut autoriser la connexion.
 *
 * ⚠️ Les menus de Claude et de ChatGPT sont ceux de leurs aides au 2026-11-19 (Anthropic : Personnaliser > Connecteurs ;
 * OpenAI : la page des plugins, « Add custom MCP server »). Ils bougent : à relire quand un client ne les trouve pas.
 */

type Onglet = 'claude' | 'chatgpt' | 'claude-code';

export const ADRESSE_MCP = `${API_PUBLIQUE}/mcp`;

export function UtiliserAvecIA() {
  const t = useT();
  const [ouverte, setOuverte] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>('claude');

  return (
    <>
      <button
        type="button"
        data-testid="utiliser-avec-ia"
        onClick={() => setOuverte(true)}
        className="mb-1 flex w-full items-center gap-2.5 rounded-controle px-3 py-2 text-left text-sm leading-snug text-ink-500 transition-colors duration-150 hover:bg-ink-100 hover:text-ink-900"
      >
        {/* Décoratifs : le libellé dit déjà les deux noms (`alt` vide, comme `logoDuModele`). Deux PNG de 16 px servis
            tels quels, comme les logos des modèles : `next/image` n'y gagnerait rien. */}
        <span className="flex shrink-0 items-center -space-x-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/llm/anthropic.png" alt="" className="h-4 w-4 rounded-full bg-white ring-1 ring-white" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/llm/openai.png" alt="" className="h-4 w-4 rounded-full bg-white ring-1 ring-white" />
        </span>
        {t('Utiliser avec Claude / ChatGPT', 'Use with Claude / ChatGPT')}
      </button>

      {/* 🔴 PAR UN PORTAIL : le bouton vit dans la barre, dont le conteneur `sticky` crée son propre plan d'empilement. Rendue
          sur place, la fenêtre restait sous les interrupteurs de la page (vu à l'écran le 2026-11-19). */}
      {ouverte && createPortal(
        <Modale
          titre={t('Piloter votre espace depuis Claude ou ChatGPT', 'Run your workspace from Claude or ChatGPT')}
          sousTitre={t(
            'L’assistant agit dans votre espace par nos outils : il lit les conversations, crée un modèle, prépare une campagne, règle l’agent IA. Aucune clé à copier.',
            'The assistant acts in your workspace through our tools: it reads conversations, creates a template, prepares a campaign, sets up the AI agent. No key to copy.',
          )}
          testId="fenetre-utiliser-avec-ia"
          onClose={() => setOuverte(false)}
        >
          <div className="space-y-4">
            <MbaTabs
              tabs={[
                { key: 'claude', label: 'Claude' },
                { key: 'chatgpt', label: 'ChatGPT' },
                { key: 'claude-code', label: 'Claude Code' },
              ]}
              active={onglet}
              onSelect={(k) => setOnglet(k as Onglet)}
            />

            <div className="space-y-3 text-sm leading-relaxed text-ink-700" data-testid={`ia-onglet-${onglet}`}>
              {onglet === 'claude' && (
                <Etapes>
                  <li>
                    {t('Dans Claude (site ou application) : ', 'In Claude (web or app): ')}
                    <strong className="text-ink-900">{t('Personnaliser > Connecteurs', 'Customize > Connectors')}</strong>
                    {t(', puis « + » et « Ajouter un connecteur personnalisé ».', ', then “+” and “Add custom connector”.')}
                  </li>
                  <li className="space-y-2">
                    <p>{t('Nom : Messaging Me. Adresse du serveur :', 'Name: Messaging Me. Server URL:')}</p>
                    <Bloc legende={t('Adresse', 'URL')} testid="ia-adresse-claude">{ADRESSE_MCP}</Bloc>
                  </li>
                  <li>
                    {t(
                      'Cliquez « Ajouter », puis « Se connecter ». Notre page d’autorisation s’ouvre : connectez-vous et choisissez cet espace.',
                      'Click “Add”, then “Connect”. Our authorization page opens: sign in and pick this workspace.',
                    )}
                  </li>
                  <li>{t('Essayez : « Où en est mon espace Messaging Me ? »', 'Try: “Where does my Messaging Me workspace stand?”')}</li>
                </Etapes>
              )}

              {onglet === 'chatgpt' && (
                <Etapes>
                  <li>
                    {t('Sur chatgpt.com, ouvrez ', 'On chatgpt.com, open ')}
                    <strong className="text-ink-900">{t('Plugins', 'Plugins')}</strong>
                    {t(', puis « + » et « Add custom MCP server ».', ', then “+” and “Add custom MCP server”.')}
                  </li>
                  <li className="space-y-2">
                    <p>{t('Nom : Messaging Me. Server URL :', 'Name: Messaging Me. Server URL:')}</p>
                    <Bloc legende={t('Adresse', 'URL')} testid="ia-adresse-chatgpt">{ADRESSE_MCP}</Bloc>
                  </li>
                  <li>
                    {t(
                      'Authentification : OAuth. Acceptez l’avertissement, « Create as a plugin », puis installez-le. Notre page d’autorisation s’ouvre : connectez-vous et choisissez cet espace.',
                      'Authentication: OAuth. Accept the warning, “Create as a plugin”, then install it. Our authorization page opens: sign in and pick this workspace.',
                    )}
                  </li>
                  <li>
                    {t(
                      'Dans une conversation, tapez « @ », choisissez Messaging Me et demandez : « Où en est mon espace ? ». ChatGPT vous demande votre accord avant chaque action qui écrit.',
                      'In a chat, type “@”, pick Messaging Me and ask: “Where does my workspace stand?”. ChatGPT asks for your approval before each action that writes.',
                    )}
                  </li>
                </Etapes>
              )}

              {onglet === 'claude-code' && (
                <Etapes>
                  <li className="space-y-2">
                    <p>{t('Installez le plugin, une commande après l’autre :', 'Install the plugin, one command after the other:')}</p>
                    {COMMANDES_PLUGIN.map((c, i) => (
                      <Bloc key={c} legende={t(`Commande ${i + 1}`, `Command ${i + 1}`)}>{c}</Bloc>
                    ))}
                  </li>
                  <li>
                    {t('Autorisez : ', 'Authorize: ')}<code className="font-mono text-ink-900">/mcp</code>
                    {t(', choisissez ', ', pick ')}<code className="font-mono text-ink-900">{SERVEUR_PLUGIN_MCP}</code>
                    {t(', puis « Authenticate », et choisissez cet espace.', ', then “Authenticate”, and pick this workspace.')}
                  </li>
                  <li className="space-y-2">
                    <p>{t('Lancez la mise en service guidée :', 'Start the guided setup:')}</p>
                    <Bloc legende={t('Commande', 'Command')}>{COMMANDE_DEMARRAGE}</Bloc>
                  </li>
                </Etapes>
              )}
            </div>

            <p className="border-t border-ink-100 pt-3 text-xs text-ink-500">
              {t(
                'Seul un administrateur de l’espace peut autoriser la connexion. Retirer l’accès : Developers > Clés d’API. Cursor, VS Code et les autres clients : ',
                'Only a workspace administrator can authorize the connection. To remove access: Developers > API keys. Cursor, VS Code and other clients: ',
              )}
              <Link href="/developers/mcp" onClick={() => setOuverte(false)} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
                {t('Serveur MCP', 'MCP server')}
              </Link>
              .
            </p>
          </div>
        </Modale>,
        document.body,
      )}
    </>
  );
}
