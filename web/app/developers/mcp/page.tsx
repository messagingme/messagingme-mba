'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CadreDoc } from '@/components/doc-api/CadreDoc';
import { ApiOuMcp, Bloc, C, Encadre, EnTetePage, Etapes, Liste, Section, Sous, Tableau } from '@/components/doc-api/elements';
import { useT } from '@/lib/i18n';
import { OUTILS_MCP } from '@/lib/mcp-outils';
import { FAMILLES_OUTILS } from '@/lib/partage/familles-outils';
import { listApiKeys } from '@/lib/api';
import { BASE } from '@/lib/http';
import { COMMANDE_DEMARRAGE, COMMANDES_PLUGIN, SERVEUR_PLUGIN_MCP } from '@/lib/demarrer';
import type { Session } from '@/lib/session';

/**
 * L'espace a-t-il une clé UTILISABLE pour MCP ?
 *
 * `null` = on ne sait pas encore, ou la liste n'a pas pu être lue. Les deux se traitent pareil, et c'est
 * volontaire : une vérification qui échoue ne doit surtout pas afficher « vous n'avez aucune clé », qui
 * enverrait quelqu'un en créer une seconde alors qu'il en a déjà une. Ne rien dire vaut mieux que dire faux.
 */
type EtatCle = null | 'aucune' | 'ok';

/** La fiche de chaque outil, par son nom : la page les range par famille (`FAMILLES_OUTILS`), pas dans l'ordre du catalogue. */
const FICHE = new Map(OUTILS_MCP.map((o) => [o.nom, o]));

/**
 * L'écran d'où part un intégrateur, en trois chemins numérotés (audit du 2026-10-31) : le plugin Claude Code, un autre
 * client par OAuth, une connexion à la main avec une clé ; puis ce que le serveur ne fait volontairement PAS, comment
 * retirer l'accès, et chaque outil, rangé par famille, à son ancre (son nom, que la vitrine vise).
 *
 * Le catalogue vient de `lib/mcp-outils.ts` et non d'un appel réseau : ce n'est pas un état du client,
 * c'est une documentation, et la lire exigerait déjà une clé, que cette page sert justement à créer. Un
 * test du serveur (`tests/mcp-doc-parite.test.ts`) garde cette liste alignée sur le catalogue réel, et
 * `tests/plugin-readme.test.ts` range chaque outil dans une famille, une seule.
 *
 * 🔴 ELLE EST PUBLIQUE (décision de Julien du 2026-09-25), comme la documentation de l'API, et elle en prend le
 * cadre (`CadreDoc`, refonte du 2026-09-25) : qui peut ouvrir cet écran de la console l'a dans la console, tout
 * autre visiteur la lit dans `CadrePublic`. Sans session, la vérification des clés ne tourne pas : elle lit une
 * donnée d'espace, et il n'y a pas d'espace. Son adresse est publiée sur la vitrine : elle ne bouge pas.
 */
export default function McpPage() {
  return <CadreDoc page="mcp">{(session) => <McpInner session={session} />}</CadreDoc>;
}

function McpInner({ session }: { session: Session | null }) {
  const t = useT();
  const [etatCle, setEtatCle] = useState<EtatCle>(null);
  const tenantId = session?.tenantId;

  // La commande à clé ne peut pas marcher sans une clé portant un droit `mcp:*`. La copier puis se heurter à un
  // 401 est un aller-retour de support garanti, alors que la réponse tient en une phrase. Sans espace (lecture
  // publique), on se tait : cf. EtatCle.
  useEffect(() => {
    if (!tenantId) return;
    let vivant = true;
    listApiKeys(tenantId)
      .then(({ keys }) => {
        if (!vivant) return;
        // Une clé RÉVOQUÉE reste dans la liste : elle ne compte pas. Sans ce filtre, l'avertissement se
        // tairait pour un espace dont la seule clé MCP vient justement d'être coupée.
        const utilisable = keys.some((k) => k.revokedAt === null && k.scopes.some((s) => s.startsWith('mcp:')));
        setEtatCle(utilisable ? 'ok' : 'aucune');
      })
      .catch(() => { /* on ne sait pas : on se tait, cf. EtatCle */ });
    return () => { vivant = false; };
  }, [tenantId]);
  // 🔴 L'ADRESSE EST CELLE DE L'API PUBLIQUE (`BASE`, la même source que la documentation de l'API), parce
  // que c'est l'API qui sert `/mcp`, pas la console. Elle suivait le domaine de la console : sur la console
  // hébergée chez Vercel, `/mcp` rend 404 (mesuré le 2026-09-25, quand `api.` et `mba.` rendent 401), donc
  // la commande copiée depuis `engageme.` était morte. Repli sur le domaine de la page quand `BASE` est
  // relative (le serveur local des tests, dont le relais sert `/mcp`), et sur l'API quand rien ne la donne.
  const origine = BASE.startsWith('http') ? BASE : typeof window !== 'undefined' ? window.location.origin : 'https://api.messagingme.app';
  const commande = `claude mcp add --transport http mba ${origine}/mcp --header "Authorization: Bearer VOTRE_CLE"`;
  // La vérification commune aux trois chemins : une lecture, qui ne change rien à l'espace.
  const verifier = t(
    'Vérifier, sans rien changer : demandez « Où en est mon espace ? ». L’assistant lit l’état de l’espace (get_setup_state) et dit l’étape suivante.',
    'Check, without changing anything: ask “Where does my workspace stand?”. The assistant reads the workspace state (get_setup_state) and tells the next step.',
  );

  return (
    <>
      <EnTetePage page="mcp">
        <p>
          {t(
            'Brancher un assistant (Claude, ou tout client compatible MCP) sur l’espace, sans intégration à développer.',
            'Connect an assistant (Claude, or any MCP-compatible client) to the workspace, with no integration to build.',
          )}
        </p>
      </EnTetePage>

      <Section id="api-ou-mcp" titre={t('API ou MCP ?', 'API or MCP?')}>
        <ApiOuMcp />
      </Section>

      {/* Le plugin d'abord (lot 10, B) : pour Claude Code, il branche ce serveur sans clé à copier et apporte la mise en
          service. La commande à clé (chemin 3) reste pour qui ne veut que le serveur. */}
      <Section id="plugin" titre={t('Chemin 1 : Claude Code, avec le plugin (recommandé)', 'Path 1: Claude Code, with the plugin (recommended)')}>
        <p>
          {t(
            'Le plus simple dans Claude Code. Aucune clé à copier : tous les outils, et la mise en service pas à pas (numéro, agent IA, bulle, essai).',
            'The simplest way in Claude Code. No key to copy: every tool, and the step-by-step setup (number, AI agent, bubble, test).',
          )}
        </p>
        <Etapes>
          <li className="space-y-2">
            <p>{t('Installez le plugin, une commande après l’autre :', 'Install the plugin, one command after the other:')}</p>
            {COMMANDES_PLUGIN.map((c, i) => (
              <Bloc key={c} legende={t(`Commande ${i + 1}`, `Command ${i + 1}`)} testid={`mcp-plugin-${i + 1}`}>{c}</Bloc>
            ))}
          </li>
          <li>
            {t('Autorisez : ', 'Authorize: ')}<C>/mcp</C>{t(', choisissez ', ', pick ')}<C>{SERVEUR_PLUGIN_MCP}</C>
            {t(', puis ', ', then ')}<C>Authenticate</C>
            {t(
              '. Notre page d’autorisation s’ouvre ; un administrateur se connecte et choisit l’espace. Pas encore de compte ? L’espace se crée à ce moment-là.',
              '. Our authorization page opens; an administrator signs in and picks the workspace. No account yet? The workspace is created at that moment.',
            )}
          </li>
          <li className="space-y-2">
            <p>{t('Lancez la mise en service :', 'Start the setup:')}</p>
            <Bloc legende={t('Puis, dans Claude Code', 'Then, in Claude Code')} testid="mcp-plugin-demarrage">{COMMANDE_DEMARRAGE}</Bloc>
          </li>
        </Etapes>
        <p className="text-sm text-ink-500">{verifier}</p>
      </Section>

      <Section id="oauth" titre={t('Chemin 2 : un autre client, par OAuth (ChatGPT, Cursor, VS Code, Lovable)', 'Path 2: another client, through OAuth (ChatGPT, Cursor, VS Code, Lovable)')}>
        <p>
          {t(
            'Sans clé à copier : l’autorisation OAuth. Les mêmes outils qu’avec le plugin, au nom de l’administrateur qui a autorisé ; la mise en service guidée est propre au plugin.',
            'No key to copy: OAuth authorization. The same tools as with the plugin, on behalf of the administrator who authorized; the guided setup is specific to the plugin.',
          )}
        </p>
        <Etapes>
          <li className="space-y-2">
            <p>{t('Ajoutez un serveur MCP distant (ou un connecteur) à cette adresse :', 'Add a remote MCP server (or a connector) at this address:')}</p>
            <Bloc legende={t('Adresse', 'Endpoint')} testid="mcp-adresse">{`${origine}/mcp`}</Bloc>
          </li>
          <li data-testid="mcp-autres-clients">
            {t(
              'Choisissez l’authentification OAuth. Le client ouvre notre page d’autorisation, où un administrateur de l’espace se connecte et choisit l’espace.',
              'Choose OAuth authentication. The client opens our authorization page, where a workspace administrator signs in and picks the workspace.',
            )}
          </li>
          <li>{verifier}</li>
        </Etapes>
        <Liste>
          <li>
            {t(
              'La page d’autorisation dit d’où vient le nom du client : vérifié pour Claude, publié par son domaine pour un client qui a une fiche d’identité (ChatGPT), non vérifié pour un client qui s’enregistre (Cursor, VS Code).',
              'The authorization page says where the client’s name comes from: verified for Claude, published by its domain for a client with an identity document (ChatGPT), unverified for a client that registers itself (Cursor, VS Code).',
            )}
          </li>
          <li>
            {t(
              'Le client reçoit son code sur une adresse https, ou sur localhost et 127.0.0.1 : un retour par un schéma d’application (cursor://) est refusé.',
              'The client receives its code on an https address, or on localhost and 127.0.0.1: a return through an app scheme (cursor://) is refused.',
            )}
          </li>
        </Liste>
      </Section>

      <Section id="cle" titre={t('Chemin 3 : à la main, avec une clé d’API', 'Path 3: by hand, with an API key')}>
        <p>
          {t(
            'Pour un client qui ne sait pas faire OAuth, ou un script.',
            'For a client that cannot do OAuth, or a script.',
          )}
        </p>
        <Etapes>
          <li>
            {t('Créez une clé d’API avec le droit ', 'Create an API key with the ')}<C>mcp:read</C>
            {t(', et ', ' scope, and ')}<C>mcp:write</C>
            {t(' pour agir. ', ' to act. ')}
            <Link href="/developers/keys" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
              {t('Créer une clé', 'Create a key')}
            </Link>
          </li>
          <li className="space-y-2">
            <p>{t('Remplacez VOTRE_CLE par cette clé, puis lancez :', 'Replace VOTRE_CLE with that key, then run:')}</p>
            <Bloc legende={t('Commande à copier', 'Command to copy')} testidCopier="mcp-copier">{commande}</Bloc>
          </li>
          <li>{verifier}</li>
        </Etapes>

        {/* L'avertissement ne s'affiche QUE sur une certitude (`aucune`). Tant qu'on ne sait pas, ou si la
            liste n'a pas pu être lue, on se tait : annoncer « aucune clé » à quelqu'un qui en a une l'enverrait
            en créer une seconde, et ce serait notre faute. */}
        {etatCle === 'aucune' && (
          <div data-testid="mcp-sans-cle" className="rounded-controle border border-alerte-300 bg-alerte-50 px-3 py-2 text-sm text-alerte-900">
            {t(
              'Cet espace n’a aucune clé d’API avec un droit MCP : branchée avec une autre clé, la commande ci-dessus ne verrait aucun outil.',
              'This workspace has no API key with an MCP scope: connected with another key, the command above would see no tool.',
            )}{' '}
            <Link href="/developers/keys" className="font-semibold underline underline-offset-2">
              {t('Créer une clé avec « MCP : lire »', 'Create a key with "MCP: read"')}
            </Link>
          </div>
        )}
        {/* 🔴 Les outils de l'agent IA et du crédit agissent au nom d'une personne (lot 8a) : une clé d'API ne les voit
            pas, même avec le droit d'écrire. Le dire évite qu'un intégrateur cherche un outil que sa clé ne listera jamais. */}
        <Encadre sorte="attention">
          <p>
            {t(
              'Une clé n’ouvre pas les outils qui agissent au nom d’une personne, c’est-à-dire la plupart des écritures (modèles, webhooks, campagnes, agent IA, crédit, suppression de contacts) : la colonne « Droit » plus bas les marque « connexion OAuth requise ». Une clé en lecture seule ne voit pas ceux qui écrivent. Avec le plugin, n’ajoutez pas aussi cette commande : Claude Code garderait ce serveur-là, qui n’ouvre pas les outils de mise en service.',
              'A key does not open the tools that act on behalf of a person, that is most writes (templates, webhooks, campaigns, AI agent, credit, contact deletion): the “Scope” column below marks them “OAuth connection required”. A read-only key does not see the ones that write. With the plugin, do not also add this command: Claude Code would keep that server, which does not open the setup tools.',
            )}
          </p>
        </Encadre>
      </Section>

      <Section id="limites" titre={t('Ce qu’il ne fait pas', 'What it does not do')}>
        <Liste>
          <li>
            <strong className="text-ink-900">{t('Pas de campagne sans votre oui.', 'No campaign without your yes.')}</strong>{' '}
            {t('En formule Pro, il prépare une campagne et vous en montre le récapitulatif ; il ne la lance qu’avec le code de ce récapitulatif, après votre oui. Hors de la formule Pro, il envoie un modèle à une personne à la fois.', 'On Pro, it prepares a campaign and shows you its summary; it only launches it with the code of that summary, after your yes. Outside Pro, it sends a template to one person at a time.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Hors de la fenêtre de 24 h, seul un modèle approuvé part.', 'Outside the 24 h window, only an approved template goes out.')}</strong>{' '}
            {t('Un message libre est refusé, avec la raison ; un modèle approuvé part par send_template_to_contact.', 'A free-form message is refused, with the reason; an approved template goes out through send_template_to_contact.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Numéro WhatsApp délié, rien ne part.', 'WhatsApp number unlinked, nothing is sent.')}</strong>{' '}
            {t('L’outil refuse, avec la raison, jusqu’à ce qu’un administrateur relie le numéro depuis l’Accueil.', 'The tool refuses, with the reason, until an admin relinks the number from the Home page.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Les automations ne se déclenchent pas.', 'Automations are not triggered.')}</strong>{' '}
            {t('Un tag posé par l’assistant classe le contact, sans réveiller les automations qui écoutent ce tag.', 'A tag set by the assistant classifies the contact, without waking the automations listening for that tag.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Activer un agent IA ne le fait pas répondre.', 'Activating an AI agent does not make it answer.')}</strong>{' '}
            {t('Créé et activé par l’assistant, il parle aux clients dans un scénario publié qui le contient, ou une fois choisi pour répondre au client (set_default_responder, mode « agent ») : il répond alors à tout message que personne ne tient, et l’agent de Meta, s’il est allumé, reste en veille.', 'Created and activated by the assistant, it talks to customers inside a published scenario that contains it, or once chosen to answer the customer (set_default_responder, “agent” mode): it then answers every message nobody handles, and Meta’s agent, if on, stays on standby.')}
          </li>
        </Liste>
      </Section>

      <Section id="acces" titre={t('Retirer l’accès, et si ça ne marche pas', 'Removing access, and if it does not work')}>
        <Liste>
          <li>
            <strong className="text-ink-900">{t('Couper un assistant.', 'Cutting an assistant off.')}</strong>{' '}
            {t('Une clé comme une connexion OAuth porte l’espace et les droits : révoquez l’une ou l’autre dans Developers > Clés d’API.', 'A key, like an OAuth connection, carries the workspace and the scopes: revoke either one under Developers > API keys.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Un refus 401.', 'A 401 refusal.')}</strong>{' '}
            {t('La clé est révoquée ou mal copiée ; avec OAuth, autorisez de nouveau (dans Claude Code : /mcp, puis Authenticate).', 'The key is revoked or miscopied; with OAuth, authorize again (in Claude Code: /mcp, then Authenticate).')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Connecté, mais aucun outil.', 'Connected, but no tool.')}</strong>{' '}
            {t('La clé n’a pas de droit MCP : donnez-lui ', 'The key has no MCP scope: give it ')}<C>mcp:read</C>
            {t(', et ', ', and ')}<C>mcp:write</C>{t(' pour agir.', ' to act.')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Les outils de mise en service manquent dans Claude Code.', 'The setup tools are missing in Claude Code.')}</strong>{' '}
            {t('Un serveur ajouté à la main avec une clé masque celui du plugin : retirez-le (', 'A server added by hand with a key hides the plugin’s one: remove it (')}
            <C>claude mcp remove mba</C>
            {t(', ou le nom que vous lui avez donné).', ', or the name you gave it).')}
          </li>
          <li>
            <strong className="text-ink-900">{t('Le plugin ne se met pas à jour tout seul.', 'The plugin does not update itself.')}</strong>{' '}
            {t('Dans Claude Code : /plugin, onglet Marketplaces, messagingme, « Update marketplace ».', 'In Claude Code: /plugin, Marketplaces tab, messagingme, “Update marketplace”.')}
          </li>
        </Liste>
      </Section>

      <Section id="outils" titre={t('Ce que l’assistant peut faire', 'What the assistant can do')}>
        <p>
          {t(
            'Les outils marqués « connexion OAuth requise » agissent au nom d’une personne : une clé d’API ne les voit pas. Ils s’ouvrent quand l’assistant se connecte à l’espace avec l’accord d’un administrateur, qui signe ce qu’ils font.',
            'Tools marked "OAuth connection required" act on behalf of a person: an API key does not see them. They open when the assistant connects to the workspace with an administrator’s consent, who signs what they do.',
          )}
        </p>
        {FAMILLES_OUTILS.map((f) => (
          <div key={f.titre} className="space-y-3">
            <Sous>{t(f.titreFr, f.titre)}</Sous>
            {/* Les noms d'outils, en police fixe, ne se coupent pas : sur mobile, le tableau défile dans son cadre
                plutôt que de faire déborder la page entière (vu par l'e2e de la CI, 16 px). */}
            <Tableau
              entetes={[t('Outil', 'Tool'), t('Droit', 'Scope'), t('Ce qu’il fait', 'What it does')]}
              lignes={f.outils.flatMap((nom) => {
                const o = FICHE.get(nom);
                if (!o) return [];
                return [{
                  cle: o.nom,
                  cellules: [
                    // L'ancre de l'outil (`PAGES_DOC`, mcp) : la vitrine y mène ; `scroll-mt` laisse passer l'entête collante.
                    <span key="n" id={o.nom} className="scroll-mt-20 whitespace-nowrap font-mono text-ink-900">{o.nom}</span>,
                    <span key="s" className="flex flex-col items-start gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${o.scope === 'mcp:write' ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>{o.scope}</span>
                      {o.oauth && <span className="whitespace-nowrap text-xs text-ink-500">{t('connexion OAuth requise', 'OAuth connection required')}</span>}
                    </span>,
                    t(...o.quoi),
                  ],
                }];
              })}
            />
          </div>
        ))}
      </Section>
    </>
  );
}
