'use client';

import { CadreDoc } from '@/components/doc-api/CadreDoc';
import {
  Bloc, C, Encadre, EnTetePage, Erreurs, LienDoc, Liste, Route, Section, Sous, SurCettePage, Tableau, curl, curlDelete, curlGet, json,
} from '@/components/doc-api/elements';
import { useT } from '@/lib/i18n';
import { EXEMPLES_CORPS, EXEMPLES_REPONSES } from '@/lib/api-exemples';

/**
 * LES SCÉNARIOS PAR L'API (spec 2026-11-02-scenarios-api) : une recette, compilée en scénario et publiée aussitôt. La
 * liste des scénarios publiés reste au catalogue (`catalogs`) ; leur envoi passe par `sends`.
 */
export default function ApiScenariosPage() {
  return <CadreDoc page="scenarios">{() => <Scenarios />}</CadreDoc>;
}

const ID = '/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b';

function Scenarios() {
  const t = useT();
  const commande = t('Commande', 'Command');
  const erreurs = t('Erreurs', 'Errors');

  return (
    <>
      <EnTetePage page="scenarios">
        <p>
          {t(
            'Créer un scénario simple sans ouvrir la console, avec le droit scenarios:write : un template et ses boutons, des messages à réponses rapides avec un fichier, un agent IA, l’équipe. Toute écriture le publie aussitôt ; il part ensuite par',
            'Create a simple scenario without opening the console, with the scenarios:write right: a template and its buttons, quick-reply messages with a file, an AI agent, the team. Every write publishes it at once; it then goes out through',
          )}{' '}
          <LienDoc page="sends">{t('Envois', 'Sends')}</LienDoc>.
        </p>
      </EnTetePage>
      <SurCettePage page="scenarios" />

      <Section id="recette" titre={t('La recette', 'The recipe')}>
        <p>
          {t(
            'Un scénario se décrit par une arborescence d’étapes, sans identifiant ni position. Chaque étape est exactement une de ces quatre formes :',
            'A scenario is described as a tree of steps, with no id or position. Each step is exactly one of these four forms:',
          )}
        </p>
        <Tableau
          entetes={[t('Étape', 'Step'), t('Sens', 'Meaning')]}
          lignes={[
            { cle: 'template', cellules: [<C key="c">template</C>, t('Envoie un template APPROUVÉ (nom, langue, variables). boutons : une suite par réponse rapide, nommée par son texte exact ; chacune en demande une. autre_reponse : le contact écrit au lieu de cliquer. Sans réponse rapide, le template termine le parcours.', 'Sends an APPROVED template (name, language, variables). boutons: one next step per quick reply, named by its exact text; each one needs one. autre_reponse: the contact writes instead of tapping. Without quick replies, the template ends the scenario.')] },
            { cle: 'message', cellules: [<C key="c">message</C>, t('Un message libre dans la fenêtre de 24 h, avec un fichier facultatif (image JPEG, PNG ou GIF, vidéo MP4, PDF). reponses : 3 réponses rapides au plus, 20 caractères chacune. Sans réponse rapide, il n’attend pas : suite est l’étape d’après.', 'A free message within the 24-hour window, with an optional file (JPEG, PNG or GIF image, MP4 video, PDF). reponses: 3 quick replies at most, 20 characters each. Without quick replies, it does not wait: suite is the next step.')] },
            { cle: 'agent', cellules: [<C key="c">agent</C>, t('Confie la conversation à un agent IA actif de l’espace. Il termine le parcours.', 'Hands the conversation to an active AI agent of the workspace. It ends the scenario.')] },
            { cle: 'humain', cellules: [<C key="c">humain</C>, t('Passe la conversation à l’équipe (À traiter). Il termine le parcours.', 'Hands the conversation to the team (To handle). It ends the scenario.')] },
          ]}
        />
        <Liste>
          <li>{t('variables : pour chaque position du template ({{1}} s’écrit 1), un champ de la fiche (champ), un texte fixe (texte), ou le nom ou le numéro du contact (attribut : name ou phone). Absent : les associations posées dans la console.', 'variables: for each template position ({{1}} is written 1), a record field (champ), a fixed text (texte), or the contact’s name or number (attribut: name or phone). Absent: the associations set in the console.')}</li>
          <li>{t('Le fichier se lit à chaque envoi par son adresse https : il est vérifié une fois à l’écriture, jamais copié. S’il change sur le site, les envois suivants changent.', 'The file is read at each send from its https address: it is checked once at write time, never copied. If it changes on the site, later sends change.')}</li>
          <li>{t('Un template doit être approuvé par Meta avant d’entrer dans une recette : créez-le d’abord par', 'A template must be approved by Meta before it goes into a recipe: create it first with')} <LienDoc page="templates" ancre="creer">POST /v1/templates</LienDoc>.</li>
        </Liste>
      </Section>

      <Route ep="POST /v1/scenarios">
        <p>{t('Compile la recette, publie le scénario et rend la recette relue, son empreinte et son ouverture.', 'Compiles the recipe, publishes the scenario and returns the recipe read back, its fingerprint and its opening.')}</p>
        <Bloc legende={commande}>{curl('/v1/scenarios', EXEMPLES_CORPS.recetteScenario.corps)}</Bloc>
        <Sous>{t('Réponse 201', '201 response')}</Sous>
        <Bloc legende="JSON">{json(EXEMPLES_REPONSES.scenarioCree)}</Bloc>
        <Sous>{erreurs}</Sous>
        <Erreurs
          lignes={[
            ['invalid_body', t('Recette hors de la forme : chemin dit où.', 'Recipe outside the shape: chemin says where.')],
            ['plan_feature_unavailable', t('Les scénarios ne sont pas dans l’offre de l’espace.', 'Scenarios are not in the workspace plan.')],
            ['template_not_found', t('Aucun template de ce nom dans cette langue.', 'No template with this name in this language.')],
            ['template_not_approved', t('Le template n’est pas encore approuvé : rien n’est enregistré.', 'The template is not approved yet: nothing is saved.')],
            ['template_button_unknown', t('Un texte de bouton n’est pas une réponse rapide du template.', 'A button text is not a quick reply of the template.')],
            ['quick_reply_unwired', t('Une réponse rapide du template n’a pas de suite.', 'A quick reply of the template has no next step.')],
            ['agent_unavailable', t('L’agent n’existe pas dans l’espace, ou il est inactif.', 'The agent does not exist in the workspace, or it is inactive.')],
            ['field_unknown', t('Un champ cité n’existe pas.', 'A quoted field does not exist.')],
            ['file_refused', t('Le fichier n’a pas pu être lu, ou WhatsApp ne l’accepte pas.', 'The file could not be read, or WhatsApp does not accept it.')],
            ['unsendable_target', t('Le scénario ne pourrait pas partir (par exemple, il ouvre sur l’équipe).', 'The scenario could not go out (for example, it opens on the team).')],
            ['scenario_name_taken', t('Le nom est pris : id donne le scénario existant.', 'The name is taken: id gives the existing scenario.')],
          ]}
        />
        <Encadre sorte="attention">
          <p>{t('Pas de brouillon : le scénario est en ligne dès la réponse. Il n’écrit à personne tant qu’aucun envoi ni déclencheur ne le lance.', 'No draft: the scenario is live as soon as the response arrives. It writes to nobody until a send or a trigger starts it.')}</p>
        </Encadre>
      </Route>

      <Route ep="GET /v1/scenarios/{scenarioId}">
        <p>{t('Rend le scénario sous forme de recette, par son id ou son code scn_, avec l’empreinte à renvoyer pour le remplacer.', 'Returns the scenario as a recipe, by its id or its scn_ code, with the fingerprint to send back to replace it.')}</p>
        <Bloc legende={commande}>{curlGet(ID)}</Bloc>
        <Sous>{erreurs}</Sous>
        <Erreurs
          lignes={[
            ['scenario_not_found', t('Aucun scénario de ce nom dans l’espace.', 'No such scenario in the workspace.')],
            ['scenario_not_describable', t('Modifié dans la console au-delà de ce qu’une recette sait dire.', 'Edited in the console beyond what a recipe can describe.')],
          ]}
        />
      </Route>

      <Route ep="PUT /v1/scenarios/{scenarioId}">
        <p>{t('Remplace tout le scénario et le publie. L’empreinte lue passe dans If-Match (ou dans empreinte, dans le corps) : si le scénario a changé entre-temps, l’appel est refusé au lieu d’écraser.', 'Replaces the whole scenario and publishes it. The fingerprint read goes in If-Match (or in empreinte, in the body): if the scenario changed in the meantime, the call is refused instead of overwriting.')}</p>
        <Bloc legende={commande}>{curl(ID, { ...EXEMPLES_CORPS.recetteScenario.corps, empreinte: EXEMPLES_REPONSES.scenarioCree.empreinte }, 'PUT')}</Bloc>
        <Liste>
          <li>{t('Seuls les scénarios créés par l’API se remplacent. Un bloc resté au même endroit garde son identifiant : un contact en cours de parcours reprend où il était.', 'Only scenarios created through the API can be replaced. A step left in the same place keeps its id: a contact in the middle of the scenario resumes where they were.')}</li>
        </Liste>
        <Sous>{erreurs}</Sous>
        <Erreurs
          lignes={[
            ['precondition_required', t('L’empreinte manque.', 'The fingerprint is missing.')],
            ['scenario_managed_in_console', t('Le scénario a été créé dans la console.', 'The scenario was created in the console.')],
            ['scenario_changed', t('Il a changé depuis votre lecture, ou une modification de la console attend d’être publiée.', 'It changed since you read it, or a console change is waiting to be published.')],
            ['scenario_not_describable', t('Modifié dans la console au-delà de ce qu’une recette sait dire.', 'Edited in the console beyond what a recipe can describe.')],
          ]}
        />
        <p>{t('Et les erreurs de la création.', 'And the errors of creation.')}</p>
      </Route>

      <Route ep="DELETE /v1/scenarios/{scenarioId}">
        <p>{t('Supprime un scénario créé par l’API, si plus rien ne l’utilise.', 'Deletes a scenario created through the API, if nothing uses it any more.')}</p>
        <Bloc legende={commande}>{curlDelete(ID)}</Bloc>
        <Sous>{erreurs}</Sous>
        <Erreurs
          lignes={[
            ['scenario_managed_in_console', t('Le scénario a été créé dans la console.', 'The scenario was created in the console.')],
            ['scenario_in_use', t('Une automation, le répondeur, une campagne, une publicité, un widget ou un « Aller à » l’utilise : le message dit lequel.', 'An automation, the responder, a campaign, an ad, a widget or a “Go to” uses it: the message says which.')],
          ]}
        />
      </Route>
    </>
  );
}
