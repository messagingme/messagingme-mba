import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { AnnotationsMcp, DepsMcp, OutilMcp, PersonneMcp } from './outils';
import { RefusOutil, entierBorne, familleDuRefus, refusDuCoeur, refusDuPlafond, valeurOuRefus } from './saisie';
import { journaliser } from '../lib/journal';
import { messageDeForme } from '../api/forme';
import { BORNES_MODELE, schemaModeleMeta, versModeleConsole } from '../api/modele-meta';
import { creerModeleDepuisMeta, estNomDeModele, refusDeMeta, statutsDuModele, type DepsCreationModele } from '../api/creer-modele';
import { modifierUnModele, supprimerUnModele, type RefusGestionModele } from '../templates/gestion';
import { codeDuLienTrace } from '../links/rewrite';
import type { TemplateSummary } from '../meta/templates';
import { VALEUR_ACCEPTEE } from '../api/modele-envoi';
import { LOURDE, ecriture, personneRequise, plafondCouteux, signataire } from './outils-agent';
import { proposer, type DemandeAction } from '../mise-en-ligne/mise-en-ligne';
import type { PersonneDEnvoi } from '../mise-en-ligne/envois';
import { boutonDuOui } from './outils-mise-en-ligne';
import { e164DepuisSaisie } from '../crm/phone';
import type { GrilleMeta } from '../credit-whatsapp/grille';
import { categorieDePrix, prixMetaFrance, type PrixMeta } from './prix-meta';
import { LISTES } from './ecran';

/**
 * LES MODÈLES DEPUIS CLAUDE (lot 13, domaine 3, spec § 5) : créer un modèle au format de Meta, suivre sa validation,
 * lister ceux de l'espace, et en envoyer un à UN contact (livraison B, par le cœur de `POST /v1/sends`). Les MÊMES fonctions que `POST /v1/templates` et `GET /v1/templates/{name}`
 * (`src/api/creer-modele.ts`), elles-mêmes passées par la création de l'écran Modèles. Un seul contrôle propre ici :
 * la correction refuse ce que son format perdrait (`ceQueCeFormatPerdrait`). Ouverts à toutes les offres, comme l'écran
 * Modèles.
 */
export interface DepsModelesMcp extends DepsCreationModele {
  /** Les modèles du compte WhatsApp de l'espace, la MÊME lecture (en cache une minute) que le catalogue `/v1/templates`. */
  lister(tenantId: string): Promise<TemplateSummary[]>;
  /** Oublie cette liste en cache pour l'espace : après une création, une correction ou une suppression par Claude. */
  oublier(tenantId: string): Promise<void>;
  /**
   * La grille de Meta en vigueur (`PgCreditWhatsappReglagesStore.grilleEnVigueur`, celle du Crédit WhatsApp), d'où Claude
   * tire le prix d'un message (`prixMetaFrance`, plan 2026-11-06). `null` : aucune grille chargée.
   */
  grilleMeta(): Promise<GrilleMeta | null>;
}

/**
 * Les tarifs de Meta pour la France, ou `null` : une grille absente ou illisible ne fait échouer ni la liste ni la
 * création d'un modèle (le prix est une aide, pas une condition), et le journal le dit.
 */
async function prixMeta(deps: DepsMcp, tenantId: string): Promise<PrixMeta | null> {
  try {
    return prixMetaFrance(await deps.modeles.grilleMeta());
  } catch (err) {
    journaliser('warn', 'mcp_prix_meta_illisible', { tenantId, erreur: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Après un changement fait par Claude, la liste en cache (une minute) montrerait l'ancien état, et Claude croirait le geste
 * raté (vu à l'essai réel du 2026-10-23 : un modèle supprimé encore listé « approuvé »). Un raté de l'oubli ne fait rien
 * échouer : la liste se rafraîchit au plus une minute plus tard, et le journal le dit. ⚠️ Le cache vit dans UNE copie de
 * l'API (`cacheCourt`) : avec plusieurs copies, une autre peut montrer l'ancien état jusqu'à une minute ; un changement fait
 * dans l'écran Modèles ne l'oublie pas non plus.
 */
async function oublierLaListe(deps: DepsMcp, tenantId: string): Promise<void> {
  try {
    await deps.modeles.oublier(tenantId);
  } catch (err) {
    journaliser('warn', 'mcp_modeles_liste_non_oubliee', { tenantId, erreur: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 🔴 Une correction par `update_template` REMPLACE les composants, et son format ne porte que des boutons « réponse
 * rapide » et « lien » sans variable (`schemaModeleMeta`) : le bouton Flow d'un modèle, que la console sait garder, et le
 * lien dont une variable vient d'un scénario ou de Shopify (son panier) disparaîtraient en silence. Jugé sur le modèle tel
 * que Meta le rend, lu une fois par `modifierUnModele` (jamais le cache d'une minute de `lister`). Nos liens tracés
 * (`/r/<code>/{{1}}`, sous tout hôte, `codeDuLienTrace`) se retracent à la correction : ils passent, mais seulement si
 * leur code est l'un des nôtres pour CET espace (`notreCode`) : une adresse du client de la même forme reste un lien à
 * variable (relectures des lots 4 et 5). Rien n'est lu en base pour un modèle sans lien de cette forme.
 */
async function ceQueCeFormatPerdrait(
  existant: TemplateSummary,
  notreCode: (code: string) => Promise<boolean>,
): Promise<string | null> {
  if (existant.buttons?.some((b) => b.type === 'FLOW')) {
    return 'ce modèle porte un bouton Flow, que ce format ne sait pas renvoyer : la correction le supprimerait. Il ne se '
      + 'corrige pas depuis Claude';
  }
  for (const b of existant.buttons ?? []) {
    if (b.type !== 'URL' || !/\{\{\s*\d+\s*\}\}/.test(b.url ?? '')) continue;
    const code = codeDuLienTrace(b.url ?? '');
    if (code !== null && await notreCode(code)) continue;
    return 'ce modèle porte un bouton de lien qui prend une variable ({{1}}), que ce format ne sait pas renvoyer : la '
      + 'correction le changerait, et les envois qui la remplissent échoueraient. Il ne se corrige pas depuis Claude';
  }
  return null;
}

/**
 * UN envoi à UNE personne par Claude (`send_template_to_contact`, `send_scenario_to_contact`), AU OUI depuis B8 (lot 1 du
 * CSM virtuel, décisions de Julien du 2026-11-26) : l'outil prépare et rend le bouton, un admin clique dans la console, et
 * le clic envoie par le cycle de `POST /v1/sends`, sous une clé tirée du oui (`src/mise-en-ligne/envois.ts`). La personne
 * par `phone` OU `contact_id`, et `values` en sources littérales, positions 1..N.
 * 🔴 L'ACCORD DE LA PERSONNE EST DÉCLARÉ PAR LE CLIENT (décision de Julien du 2026-10-25 : « si je demande d'envoyer à
 * tel numéro, c'est le choix du client », sa responsabilité, pas la nôtre), au nom de la personne qui prépare, et le
 * récapitulatif du bouton le dit à l'admin qui clique. Le chemin partagé de `POST /v1/sends` l'écrit sur la fiche au clic
 * et refuse d'y lever un STOP (`appliquerConsentement`) ; une personne qui a dit STOP est refusée dès la préparation.
 * Le plafond des opérations coûteuses se compte ici, à la préparation ; le clic ne compte ni lui ni le quota du jour de
 * l'API : c'est un envoi de la console.
 */
export async function preparerEnvoiIndividuel(
  deps: DepsMcp, tenantId: string, args: Record<string, unknown>, personne: PersonneMcp | null,
  cible: { type: 'modele'; modele: string; langue: string } | { type: 'envoi_scenario'; scenario: string },
): Promise<Record<string, unknown>> {
  const qui = personneRequise(personne);
  const saisi = typeof args.phone === 'string' ? args.phone : undefined;
  const contactId = typeof args.contact_id === 'string' ? args.contact_id : undefined;
  if ((saisi === undefined) === (contactId === undefined)) throw new RefusOutil('désignez la personne par phone OU par contact_id, pas les deux', 'invalid_args');
  // Ramené au format de la fiche, comme `get_contact` : la recherche de la fiche (STOP, bloquée) se fait sur le numéro exact.
  const phone = saisi === undefined ? undefined : e164DepuisSaisie(saisi);
  if (phone === null) throw new RefusOutil('numéro illisible : donnez-le au format international (+33612345678)', 'invalid_args');
  const values = Array.isArray(args.values) ? args.values : [];
  if (values.some((v) => typeof v !== 'string' || v === '')) throw new RefusOutil('values : une chaîne non vide par variable', 'invalid_args');
  if (values.some((v) => !VALEUR_ACCEPTEE.test(v as string))) {
    throw new RefusOutil('values : ni retour à la ligne, ni tabulation, ni plus de quatre espaces de suite (Meta refuserait le message)', 'invalid_args');
  }
  await plafondCouteux(deps, tenantId);
  const destinataire: PersonneDEnvoi = phone !== undefined ? { telephone: phone } : { contact: contactId as string };
  const commun = { valeurs: values as string[], declarePar: qui.userId, ...destinataire };
  const demande: DemandeAction = cible.type === 'modele' ? { ...cible, ...commun } : { ...cible, ...commun };
  const oui = valeurOuRefus(await proposer(deps.misesEnLigne, tenantId, qui, [demande]));
  return {
    recapitulatif: oui.recapitulatif,
    go_live: boutonDuOui(oui),
    a_savoir: 'Rien n’est parti. Montre le récapitulatif à la personne, puis le lien : un administrateur clique « '
      + `${oui.libelle} » dans la console, et le message part à ce clic, une seule fois. Après le clic, get_go_live avec `
      + 'go_live_id rend send_id (resultat.envoi de l’action).',
  };
}

const NOM = { type: 'string' as const, minLength: 1, maxLength: BORNES_MODELE.nom, pattern: '^[a-z0-9_]+$', description: 'The template name (lowercase letters, digits and _).' };
const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });

/** Un refus de l'écran Modèles, avec les campagnes actives nommées : la personne sait quoi arrêter d'abord. */
function phraseDuRefus(r: RefusGestionModele): string {
  const campagnes = r.campaigns?.map((c) => `« ${c.name} »`).join(', ');
  return campagnes ? `${r.error} : ${campagnes}` : r.error;
}

/**
 * Une erreur de Meta connue devient un refus lisible (`refusDeMeta`, le classement de l'API), une panne remonte. La route
 * de la console laisse ces erreurs en 500 ; un modèle ne doit pas faire croire à une panne là où Meta a dit pourquoi.
 */
async function ouRefusDeMeta<T>(appel: () => Promise<T>): Promise<T> {
  try {
    return await appel();
  } catch (err) {
    const r = refusDeMeta(err);
    if (r === null) throw err;
    throw refusDuCoeur(r);
  }
}

export const OUTILS_MODELES: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_templates'),
    fonction: null,
    description:
      'The workspace\'s WhatsApp templates, each with its language, its category (utility, marketing...) and its '
      + 'status at Meta (approved, pending, rejected, paused...). Only an approved template can be sent. The reason for '
      + 'a rejection: get_template_status.',
    annotations: lecture('List templates'),
    entree: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Number of templates (1 to 500, default 100).' },
      },
    },
    async executer(deps: DepsMcp, tenantId, args) {
      const limit = entierBorne(args, 'limit', 100, 1, 500);
      const [tous, prix] = await Promise.all([deps.modeles.lister(tenantId), prixMeta(deps, tenantId)]);
      return {
        templates: tous.slice(0, limit).map((t) => ({
          name: t.name, language: t.language, category: t.category.toLowerCase(), status: t.status.toLowerCase(),
        })),
        tronque: tous.length > limit,
        // Ce que Meta facture par message livré en France, par catégorie, d'après sa grille en vigueur (plan 2026-11-06).
        prix_meta: prix,
      };
    },
  },
  {
    ...ficheOutilMcp('get_template_status'),
    fonction: null,
    description:
      'A template\'s status at Meta, language by language (approved, pending, rejected...), with the reason for a '
      + 'rejection (rejectedReason, null without a reason). It follows up create_template: Meta\'s review takes from a '
      + 'few minutes to a few hours.',
    annotations: lecture('Read a template status'),
    entree: {
      type: 'object',
      properties: {
        name: NOM,
        language: { type: 'string', minLength: 2, maxLength: 20, description: 'A single language (fr, en_US...). Absent: all.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args) {
      const name = typeof args.name === 'string' ? args.name : '';
      const language = typeof args.language === 'string' ? args.language : undefined;
      const r = await statutsDuModele(deps.modeles, tenantId, name, language);
      if ('refus' in r) throw refusDuCoeur(r.refus);
      return r;
    },
  },
  {
    ...ficheOutilMcp('create_template'),
    fonction: null,
    description:
      'Creates a WhatsApp template and submits it to Meta\'s review, in META\'S FORMAT: { name (lowercase letters, '
      + 'digits and _, 512 at most), language (fr, en_US...), category (UTILITY or MARKETING), components }. Each '
      + 'component at most once. HEADER: format TEXT with text (60 characters, no variable), or IMAGE, VIDEO, DOCUMENT '
      + 'with example.header_url: ["https://..."] (2,000 characters, no redirect; JPEG or PNG image of 5 MB, MP4 video '
      + 'or PDF document of 16 MB; the file is downloaded and uploaded to Meta). BODY required (1,024 characters; '
      + 'variables {{1}}, {{2}}... contiguous, with example.body_text: [[one value per variable, 200 characters]]). '
      + 'FOOTER (60 characters, no variable). BUTTONS (10 at most, text of 25 characters): QUICK_REPLY, or URL (2 at '
      + 'most, https address without {{1}}, tracked by us). Returns the initial status (often pending), which '
      + 'get_template_status follows up. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : le modèle part chez Meta et y reste (le supprimer est un autre geste, depuis la console).
    // Destructrice pour la règle du répertoire de Claude (voir `AnnotationsMcp`).
    annotations: { title: 'Create a template', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        template: {
          type: 'object',
          description: 'Meta\'s body, for example { "name": "order_ready", "language": "en", "category": "UTILITY", '
            + '"components": [{ "type": "BODY", "text": "Hello {{1}}, your order is ready.", "example": '
            + '{ "body_text": [["Marie"]] } }] }. An unknown field is refused.',
        },
      },
      required: ['template'],
      additionalProperties: false,
    },
    ecran: () => LISTES.modeles,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const lu = schemaModeleMeta.safeParse(args.template);
      if (!lu.success) throw new RefusOutil(`modèle invalide : ${messageDeForme(lu.error)}`, 'invalid_args');
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      const r = await creerModeleDepuisMeta(deps.modeles, tenantId, lu.data);
      if ('refus' in r) throw refusDuCoeur(r.refus);
      await oublierLaListe(deps, tenantId);
      journaliser('info', 'mcp_modele_cree', { tenantId, userId: personne?.userId ?? null, nom: r.modele.name, langue: r.modele.language });
      // Le prix de SA catégorie, celle qui a été demandée : Meta peut la changer à sa revue, et le prix suit (list_templates).
      const prix = await prixMeta(deps, tenantId);
      const categorie = categorieDePrix(lu.data.category);
      const parMessage = prix && categorie ? prix.par_message_livre[categorie] : undefined;
      return {
        ...r.modele,
        prix_meta: prix && categorie && parMessage !== undefined
          ? { categorie, par_message_livre: parMessage, marche: prix.marche, grille_du: prix.grille_du, devise: prix.devise, hors_taxes: true }
          : null,
      };
    },
  },
  {
    ...ficheOutilMcp('send_template_to_contact'),
    fonction: null,
    description:
      'Prepares sending an APPROVED WhatsApp template to ONE person, even outside the 24-hour window, and returns its '
      + 'summary (recapitulatif) and go_live, the button of its yes: the link of the console page where an administrator '
      + 'of the workspace clicks its send button. NOTHING IS SENT BEFORE THAT CLICK, which Claude cannot give: show '
      + 'the summary, then give the link. The click sends once, through the same path as POST /v1/sends: STOP, number '
      + 'unlinked or suspended, the plan\'s monthly templates. A template that is not approved, or a missing variable, is '
      + 'refused here, before the button. The click declares, on the user\'s behalf and under their responsibility, that '
      + 'the person agreed to receive their messages: the record becomes opted in (marketing included), with who declared '
      + 'it; consent is not a parameter. A person who sent STOP is refused. The person is designated by phone (with the '
      + 'country code: +33612345678) or contact_id; an unknown number creates its contact record at the click. values: one '
      + 'value per variable {{1}}, {{2}}... of the body, in order. After the click, get_go_live with go_live_id returns '
      + 'send_id. It does not take a conversation escalated to the team out of "To handle": once the person has answered, '
      + `control_conversation (hand_back) does. ${LOURDE}`,
    // Rien ne part avant le clic d'un admin ; chaque appel prépare un nouveau oui : pas idempotente, rien chez un tiers.
    // Destructrice pour la règle du répertoire de Claude (une écriture du scope `mcp:write`, voir `AnnotationsMcp`).
    annotations: ecriture('Send a template to a contact', false, false),
    entree: {
      type: 'object',
      properties: {
        name: NOM,
        language: { type: 'string', minLength: 2, maxLength: 20, description: 'The template language (fr, en_US...).' },
        phone: { type: 'string', pattern: '^\\+[1-9][0-9]{7,14}$', description: 'The number with the country code. Or contact_id.' },
        contact_id: { type: 'string', format: 'uuid', minLength: 36, maxLength: 36, description: 'The id of a contact record. Or phone.' },
        values: {
          type: 'array', maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 1024, pattern: VALEUR_ACCEPTEE.source },
          description: 'One value per body variable, in order ({{1}} then {{2}}...), without line breaks, tabs or more '
            + 'than four spaces in a row (Meta refuses them). Empty if the body has none.',
        },
      },
      required: ['name', 'language'],
      additionalProperties: false,
    },
    ecran: () => LISTES.inbox,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const modele = typeof args.name === 'string' ? args.name : '';
      const langue = typeof args.language === 'string' ? args.language : '';
      if (!estNomDeModele(modele) || langue.length < 2 || langue.length > 20) throw new RefusOutil('name et language : le nom et la langue d’un modèle (list_templates)', 'invalid_args');
      return preparerEnvoiIndividuel(deps, tenantId, args, personne, { type: 'modele', modele, langue });
    },
  },
  /*
   * La marche arrière (plan du 2026-10-22, tâche 3) : corriger un modèle refusé sous le même nom, et supprimer un modèle,
   * par l'édition et la suppression de l'écran Modèles (`modifierUnModele`, `supprimerUnModele`). Une garde de plus pour
   * la correction : ce que son format perdrait (`ceQueCeFormatPerdrait`, lots 3 et 4). La Free n'a plus cet écran. Les règles de Meta citées sont celles de sa page « Template management » (lue le 2026-10-22).
   */
  {
    ...ficheOutilMcp('update_template'),
    fonction: null,
    description:
      'Edits ONE language of a template already submitted, in META\'S FORMAT, the same as create_template: name and '
      + 'language designate it, and the components REPLACE the current ones (send them all). Only a template made of a '
      + 'BODY, with BUTTONS, a FOOTER or a TEXT HEADER, can be edited; an image, video or document header can be neither '
      + 'added nor kept: create a new template instead. A template with a Flow button, or with a link button that takes a '
      + 'variable ({{1}}, filled by a scenario or Shopify), is refused too: this format cannot send that button back, and '
      + 'the edit would remove or change it. Meta\'s rules: an APPROVED template can be edited '
      + 'once in 24 hours and 10 times in 30 days, and its category cannot change; a REJECTED or PAUSED one without limit. The '
      + 'template goes back to review (pending), which get_template_status follows. Refused while an active campaign uses '
      + 'it. ' + LOURDE,
    // Monde ouvert : le modèle repart chez Meta. Pas idempotente : chaque édition d'un modèle approuvé use une des dix du
    // mois. Destructrice pour la règle du répertoire de Claude (voir `AnnotationsMcp`).
    annotations: { title: 'Edit a template', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        template: {
          type: 'object',
          description: 'Meta\'s body, as for create_template, for example { "name": "order_ready", "language": "en", '
            + '"category": "UTILITY", "components": [{ "type": "BODY", "text": "Hello {{1}}, your order is ready.", '
            + '"example": { "body_text": [["Marie"]] } }] }. An unknown field is refused.',
        },
      },
      required: ['template'],
      additionalProperties: false,
    },
    ecran: () => LISTES.modeles,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const lu = schemaModeleMeta.safeParse(args.template);
      if (!lu.success) throw new RefusOutil(`modèle invalide : ${messageDeForme(lu.error)}`, 'invalid_args');
      const { input, enteteMedia } = versModeleConsole(lu.data);
      // L'écran ne refait pas un en-tête média (il faudrait le redéposer) : le garder ou l'ajouter le perdrait en silence.
      if (enteteMedia) {
        throw new RefusOutil('un en-tête image, vidéo ou document ne se met pas par une correction : créez un nouveau modèle (create_template)', 'unsupported');
      }
      await plafondCouteux(deps, tenantId);
      const { name, language, ...champs } = input;
      // Un code de nos liens tracés, confirmé ou non : une confirmation ou une restauration ratée laisse la ligne non
      // confirmée, et le lien reste le nôtre. Son espace le dit (`getByCode`, la lecture de la redirection publique).
      // Une panne de la base est un refus lisible, jamais un « lien à variable » qui serait faux.
      const notreCode = async (code: string): Promise<boolean> => {
        try {
          return (await deps.modeles.modeles.tracking.liens.getByCode(code))?.tenantId === tenantId;
        } catch (err) {
          journaliser('error', 'mcp_modele_lien_illisible', { tenantId, nom: name, erreur: err instanceof Error ? err.message : String(err) });
          throw new RefusOutil('les liens tracés de ce modèle n’ont pas pu être relus : réessayez dans un instant', 'unavailable');
        }
      };
      await ouRefusDeMeta(async () => {
        const issue = await modifierUnModele(deps.modeles.modeles, tenantId, name, language, champs, undefined,
          (existant) => ceQueCeFormatPerdrait(existant, notreCode));
        if ('refus' in issue) throw new RefusOutil(phraseDuRefus(issue.refus), familleDuRefus(issue.refus.statut));
      });
      await oublierLaListe(deps, tenantId);
      journaliser('info', 'mcp_modele_modifie', { tenantId, userId: personne?.userId ?? null, nom: name, langue: language });
      return { name, language, status: 'pending' };
    },
  },
  {
    ...ficheOutilMcp('delete_template'),
    fonction: null,
    description:
      'Deletes a template, ALL its languages, at Meta and in the workspace. Refused while an active campaign uses it. '
      + 'Before deleting, check that nothing else sends it: a Shopify automation (get_shopify_state) or a published scenario '
      + 'that uses it would then fail without warning. If the template was APPROVED, Meta forbids creating a new one '
      + 'with the same name for 30 days. ' + LOURDE,
    // Monde ouvert : la suppression se fait chez Meta. Supprimer deux fois ne supprime rien de plus.
    annotations: { title: 'Delete a template', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: { name: NOM },
      required: ['name'],
      additionalProperties: false,
    },
    ecran: () => LISTES.modeles,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const name = typeof args.name === 'string' ? args.name : '';
      if (!estNomDeModele(name)) throw new RefusOutil('name : un nom de modèle, en lettres minuscules, chiffres et _', 'invalid_args');
      await plafondCouteux(deps, tenantId);
      await ouRefusDeMeta(async () => {
        const issue = await supprimerUnModele(deps.modeles.modeles, tenantId, name);
        if ('refus' in issue) throw new RefusOutil(phraseDuRefus(issue.refus), familleDuRefus(issue.refus.statut));
        if (!issue.res.success) throw new RefusOutil('Meta n’a pas confirmé la suppression : vérifiez avec get_template_status avant de réessayer', 'unavailable');
      });
      await oublierLaListe(deps, tenantId);
      journaliser('info', 'mcp_modele_supprime', { tenantId, userId: personne?.userId ?? null, nom: name });
      return { supprime: true, name };
    },
  },
];
