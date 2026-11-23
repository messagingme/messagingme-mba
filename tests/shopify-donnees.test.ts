import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { verifierSignatureShopify } from '../src/shopify/signature';
import {
  LIGNES_MAX, classementDeCommande, donneesDeCommande, donneesDExpedition, lignesDeCommande, montantAffiche, montantBoutique,
  numeroDeCommandeDExpedition, schemaCheckout, schemaCommande, schemaExpedition, telephoneDeCheckout, telephoneDeCommande,
  telephoneDExpedition, telephoneE164, valeurDeVariable,
} from '../src/shopify/donnees';
import { domaineShopify, lienInstallation, verifierBoutique } from '../src/shopify/connexion';

/**
 * LE CONNECTEUR SHOPIFY, SES PIÈCES PURES (plan 2026-10-21, lot 1) : la signature, la lecture des corps mesurés au lot 0,
 * la vérification d'une connexion. Les corps ci-dessous reprennent la forme des vrais webhooks reçus le 2026-10-21.
 */

const SECRET = randomBytes(16).toString('hex');
const signer = (corps: Buffer, secret = SECRET) => createHmac('sha256', secret).update(corps).digest('base64');

describe('la signature d’un webhook Shopify', () => {
  const corps = Buffer.from(JSON.stringify({ id: 1, name: '#1001' }));

  it('accepte le HMAC base64 du corps brut avec le secret de la boutique', () => {
    expect(verifierSignatureShopify(corps, signer(corps), SECRET)).toBe(true);
  });

  it('🔴 refuse un autre secret, un corps changé d’un octet, un en-tête absent ou mal formé, un secret vide', () => {
    expect(verifierSignatureShopify(corps, signer(corps, 'autre'), SECRET)).toBe(false);
    expect(verifierSignatureShopify(Buffer.from(JSON.stringify({ id: 2, name: '#1001' })), signer(corps), SECRET)).toBe(false);
    expect(verifierSignatureShopify(corps, undefined, SECRET)).toBe(false);
    expect(verifierSignatureShopify(corps, 'pas-du-base64', SECRET)).toBe(false);
    expect(verifierSignatureShopify(corps, signer(corps, ''), '')).toBe(false);
  });
});

/** Une commande payée telle que reçue le 2026-10-21 (sans client), réduite à ce que le connecteur lit. */
const commande = (over: Record<string, unknown> = {}) => ({
  id: 6786850717755, name: '#1002', checkout_token: 'jeton-du-checkout', customer: null, phone: null,
  order_status_url: 'https://messaging-me-essai.myshopify.com/70386155579/orders/3d23/authenticate?key=b325',
  shipping_address: { first_name: 'Julien', phone: '+33633921577', country_code: 'FR' }, billing_address: null,
  total_price: '12.00', presentment_currency: 'EUR', total_price_set: { presentment_money: { amount: '12.00', currency_code: 'EUR' } },
  ...over,
});

describe('la lecture des corps mesurés', () => {
  it('une commande : téléphone de livraison d’abord, puis facturation, client, commande', () => {
    const c = schemaCommande.parse(commande());
    expect(telephoneDeCommande(c, 'US')).toBe('+33633921577');
    const sansLivraison = schemaCommande.parse(commande({ shipping_address: null, billing_address: { phone: '06 12 34 56 78', country_code: 'FR' } }));
    expect(telephoneDeCommande(sansLivraison, 'US')).toBe('+33612345678');
    const client = schemaCommande.parse(commande({ shipping_address: null, customer: { id: 9, phone: '+33611111111' } }));
    expect(telephoneDeCommande(client, null)).toBe('+33611111111');
    expect(telephoneDeCommande(schemaCommande.parse(commande({ shipping_address: null })), null)).toBeNull();
  });

  it('un numéro national se lit au pays de SON adresse, à défaut à celui de la boutique', () => {
    const c = schemaCommande.parse(commande({ shipping_address: { phone: '0612345678', country_code: null } }));
    expect(telephoneDeCommande(c, 'FR')).toBe('+33612345678');
    const be = schemaCommande.parse(commande({ shipping_address: { phone: '0470123456', country_code: 'BE' } }));
    expect(telephoneDeCommande(be, 'FR')).toBe('+32470123456');
  });

  it('les données d’une commande : prénom, numéro, montant payé dans la devise du client, lien', () => {
    const d = donneesDeCommande(schemaCommande.parse(commande()));
    expect(d.first_name).toBe('Julien');
    expect(d.order_number).toBe('#1002');
    expect(d.order_status_url).toContain('/authenticate?key=');
    expect(d.order_total).toMatch(/12,00\s€/);
  });

  it('🔴 le montant est celui que le client a payé (presentment_money), pas celui de la boutique', () => {
    const c = schemaCommande.parse(commande({
      total_price: '12.00', presentment_currency: 'USD',
      total_price_set: { presentment_money: { amount: '11.04', currency_code: 'EUR' } },
    }));
    expect(montantAffiche(c)).toMatch(/11,04\s€/);
  });

  it('une expédition : téléphone de destination, suivi, numéro de commande sans le suffixe', () => {
    const f = schemaExpedition.parse({
      id: 6247859585083, order_id: 6786850717755, name: '#1002.1', tracking_company: 'Colissimo',
      tracking_number: '6A12345678901', tracking_url: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901',
      destination: { first_name: 'Julien', phone: '+33633921577', country_code: 'FR' },
    });
    expect(telephoneDExpedition(f, 'US')).toBe('+33633921577');
    expect(donneesDExpedition(f)).toEqual({
      first_name: 'Julien', order_number: '#1002', carrier: 'Colissimo', tracking_number: '6A12345678901',
      tracking_url: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901',
    });
    expect(numeroDeCommandeDExpedition('#1002')).toBe('#1002');
  });

  it('une valeur part sur une ligne, sans tabulation ni suite d’espaces, et vide vaut absente', () => {
    expect(valeurDeVariable('  Jean\n\tPierre    Martin ')).toBe('Jean Pierre Martin');
    expect(valeurDeVariable('   ')).toBeNull();
    expect(valeurDeVariable(null)).toBeNull();
    expect(donneesDExpedition(schemaExpedition.parse({ id: 1, order_id: 2, name: '#1.1', tracking_url: null, destination: null }))).toEqual({ order_number: '#1' });
  });

  it('un corps qui n’a pas la forme attendue est refusé, sans lever', () => {
    expect(schemaCommande.safeParse({ name: '#1' }).success).toBe(false);
    expect(schemaCommande.safeParse(commande({ id: 'abc' })).success).toBe(false);
  });
});

/** Le montant d'une vente attribuée (plan 2026-10-28, tâche 3) : la devise de la BOUTIQUE, pour que les ventes s'additionnent. */
describe('le montant d’une vente attribuée', () => {
  it('montantBoutique lit shop_money, pas ce que le client a vu', () => {
    const c = schemaCommande.parse(commande({
      total_price: '12.00', presentment_currency: 'USD',
      total_price_set: { presentment_money: { amount: '13.10', currency_code: 'USD' }, shop_money: { amount: '12.00', currency_code: 'EUR' } },
    }));
    expect(montantBoutique(c, 'GBP')).toEqual({ montant: '12.00', devise: 'EUR' });
    expect(montantAffiche(c)).toMatch(/13,10\s\$/);
  });

  it('sans shop_money, repli sur total_price et la devise de la boutique', () => {
    const c = schemaCommande.parse(commande({ total_price: '30.5', total_price_set: null }));
    expect(montantBoutique(c, 'EUR')).toEqual({ montant: '30.5', devise: 'EUR' });
  });

  it('un montant ou une devise illisible ne donne rien', () => {
    expect(montantBoutique(schemaCommande.parse(commande({ total_price: '12,00', total_price_set: null })), 'EUR')).toBeNull();
    expect(montantBoutique(schemaCommande.parse(commande({ total_price: '12.00', total_price_set: null })), null)).toBeNull();
    expect(montantBoutique(schemaCommande.parse(commande({ total_price: '12.00', total_price_set: null })), 'euro')).toBeNull();
    expect(montantBoutique(schemaCommande.parse(commande({
      total_price: null, total_price_set: { shop_money: { amount: '-1', currency_code: 'EUR' } },
    })), 'EUR')).toBeNull();
  });

  it('montantAffiche lit toujours presentment_money, et se passe de lui', () => {
    const sansPresentment = schemaCommande.parse(commande({
      total_price: '9.00', presentment_currency: 'EUR', total_price_set: { shop_money: { amount: '9.00', currency_code: 'EUR' } },
    }));
    expect(montantAffiche(sansPresentment)).toMatch(/9,00\s€/);
  });

  it('🔴 une forme inattendue des champs de l’attribution ne fait jamais refuser la commande (sinon sa confirmation ne partirait pas)', () => {
    const c = schemaCommande.safeParse(commande({
      test: 'oui', processed_at: 12, landing_site: { chemin: '/' },
      total_price_set: { presentment_money: { amount: '12.00', currency_code: 'EUR' }, shop_money: { amount: 12, currency_code: 'EUR' } },
    }));
    expect(c.success).toBe(true);
    expect(c.success && [c.data.test, c.data.processed_at, c.data.landing_site, c.data.total_price_set?.shop_money]).toEqual([null, null, null, null]);
    expect(c.success && montantAffiche(c.data)).toMatch(/12,00\s€/);
  });

  it('le drapeau test et la page d’arrivée se lisent, absents ou non', () => {
    const c = schemaCommande.parse(commande({ test: true, landing_site: '/?utm_source=whatsapp' }));
    expect([c.test, c.landing_site]).toEqual([true, '/?utm_source=whatsapp']);
    expect(schemaCommande.parse(commande()).test ?? false).toBe(false);
  });
});

describe('le domaine d’une boutique', () => {
  it('accepte le domaine, l’adresse complète ou le nom nu, et rien d’autre', () => {
    expect(domaineShopify('Ma-Boutique.myshopify.com')).toBe('ma-boutique.myshopify.com');
    expect(domaineShopify('https://ma-boutique.myshopify.com/admin')).toBe('ma-boutique.myshopify.com');
    expect(domaineShopify('ma-boutique')).toBe('ma-boutique.myshopify.com');
    // L'adresse de l'admin, que le marchand de la console a sous les yeux.
    expect(domaineShopify('https://admin.shopify.com/store/ma-boutique/settings/apps')).toBe('ma-boutique.myshopify.com');
    expect(domaineShopify('admin.shopify.com/store/ma-boutique')).toBe('ma-boutique.myshopify.com');
    expect(domaineShopify('https://admin.shopify.com/store/')).toBeNull();
    expect(domaineShopify('admin.shopify.com')).toBeNull();
    for (const faux of ['ma-boutique.com', 'evil.com/x.myshopify.com', '127.0.0.1', 'a.myshopify.com.evil.com', '', '-x.myshopify.com', 42]) {
      expect(domaineShopify(faux)).toBeNull();
    }
  });

  it('le lien d’installation est celui mesuré', () => {
    expect(lienInstallation('ma-boutique.myshopify.com', 'abc123')).toBe('https://admin.shopify.com/store/ma-boutique/oauth/install?client_id=abc123');
  });
});

describe('la vérification d’une connexion', () => {
  const reponse = (status: number, corps: unknown) => new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status });

  function faux(...reponses: Array<Response | Error>) {
    const appels: Array<{ url: string; init: RequestInit | undefined }> = [];
    const appeler = (async (url: string, init?: RequestInit) => {
      appels.push({ url, init });
      const r = reponses.shift();
      if (!r) throw new Error('appel non prévu');
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    return { appeler, appels };
  }

  it('demande un jeton en client_credentials, en JSON, puis lit la boutique ; le jeton n’est pas rendu', async () => {
    const f = faux(reponse(200, { access_token: 'shpat_x', scope: 'read_orders', expires_in: 86399 }), reponse(200, { shop: { name: 'Essai', country_code: 'FR', currency: 'EUR' } }));
    const r = await verifierBoutique('b.myshopify.com', 'cid', 'sec', f.appeler);
    expect(r).toEqual({ ok: true, nom: 'Essai', pays: 'FR', devise: 'EUR' });
    expect(f.appels[0]!.url).toBe('https://b.myshopify.com/admin/oauth/access_token');
    expect((f.appels[0]!.init!.headers as Record<string, string>).accept).toBe('application/json');
    expect(String(f.appels[0]!.init!.body)).toContain('grant_type=client_credentials');
    expect(f.appels[1]!.url).toBe('https://b.myshopify.com/admin/api/2026-10/shop.json');
    expect((f.appels[1]!.init!.headers as Record<string, string>)['x-shopify-access-token']).toBe('shpat_x');
  });

  it('chaque refus mesuré rend le geste qui le règle', async () => {
    const pasInstallee = await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(400, { error: 'app_not_installed' })).appeler);
    expect(pasInstallee).toMatchObject({ ok: false, code: 'app_non_installee' });
    expect(pasInstallee.ok === false && pasInstallee.message).toContain('https://admin.shopify.com/store/b/oauth/install?client_id=cid');
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(400, { error: 'shop_not_permitted' })).appeler)).toMatchObject({ ok: false, code: 'hors_organisation' });
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(401, { error: 'invalid_client' })).appeler)).toMatchObject({ ok: false, code: 'identifiants' });
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(404, '<!DOCTYPE html>')).appeler)).toMatchObject({ ok: false, code: 'boutique_inconnue' });
  });

  it('une panne de Shopify ou du réseau est passagère, jamais une connexion refusée', async () => {
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(503, 'indisponible')).appeler)).toMatchObject({ ok: false, code: 'passager' });
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(new Error('ECONNRESET')).appeler)).toMatchObject({ ok: false, code: 'passager' });
    expect(await verifierBoutique('b.myshopify.com', 'cid', 'sec', faux(reponse(200, { access_token: 'x' }), reponse(500, '')).appeler)).toMatchObject({ ok: false, code: 'passager' });
  });
});

/**
 * 🔴 UN FIXE NE FONDE PAS UNE FICHE (segments Shopify enrichis, lot 2a ; décision de Julien du 2026-11-23). Un fixe envoyé
 * à Meta échoue en 131026 après avoir créé une fiche qui remplit la limite de contacts : les trois chemins d'un MESSAGE le
 * sautent et essaient le candidat suivant. L'effacement de `customers/redact` et l'import des abonnés, non.
 */
describe('🔴 un fixe est sauté au profit du candidat suivant', () => {
  const FIXE = '01 42 68 53 00';
  const MOBILE = '06 12 34 56 78';

  it('commande : un fixe de livraison ne masque plus le mobile du client', () => {
    const c = schemaCommande.parse(commande({ shipping_address: { phone: FIXE, country_code: 'FR' }, customer: { id: 9, phone: MOBILE } }));
    expect(telephoneDeCommande(c, 'FR')).toBe('+33612345678');
  });

  it('commande : rien que des numéros que WhatsApp ne porte pas (fixe, VOIP française, gratuit) = aucun numéro', () => {
    const c = schemaCommande.parse(commande({
      shipping_address: { phone: FIXE, country_code: 'FR' }, billing_address: { phone: '09 70 80 90 10', country_code: 'FR' },
      customer: { id: 9, phone: '0800 123 456' }, phone: null,
    }));
    expect(telephoneDeCommande(c, 'FR')).toBeNull();
  });

  it('expédition : un fixe de destination n’est pas un numéro', () => {
    const f = schemaExpedition.parse({ id: 1, order_id: 2, name: '#1.1', tracking_url: null, destination: { phone: FIXE, country_code: 'FR' } });
    expect(telephoneDExpedition(f, 'FR')).toBeNull();
  });

  it('panier : un fixe de l’acheteur est sauté, le mobile de la livraison gagne', () => {
    const c = schemaCheckout.parse({ token: 'jeton', phone: FIXE, shipping_address: { phone: MOBILE, country_code: 'FR' } });
    expect(telephoneDeCheckout(c, 'FR')).toBe('+33612345678');
  });

  it('⚠️ sans l’option, un fixe reste un numéro (l’effacement doit retrouver sa fiche)', () => {
    expect(telephoneE164([{ brut: FIXE, pays: 'FR' }], null)).toBe('+33142685300');
    expect(telephoneE164([{ brut: FIXE, pays: 'FR' }], null, { sauterFixes: true })).toBeNull();
  });
});

/**
 * LE CLASSEMENT D'UNE COMMANDE POUR LA CARTE « JOIGNABILITÉ WHATSAPP » (segments Shopify enrichis, lot 2b) : les mêmes
 * candidats que le message, sans garder le numéro. Les trois issues, et une commande « utilisable » est exactement une
 * commande dont le message a un numéro.
 */
describe('🔴 le classement d’une commande, sans garder le numéro', () => {
  it('aucun texte dans les quatre candidats : sans numéro', () => {
    const c = schemaCommande.parse(commande({ shipping_address: null, billing_address: null, customer: null, phone: '  ' }));
    expect(classementDeCommande(c, 'FR')).toBe('sans_numero');
  });

  it('du texte mais aucun numéro que WhatsApp porte (illisible, fixe) : invalide', () => {
    const illisible = schemaCommande.parse(commande({ shipping_address: { phone: 'pas un numéro', country_code: 'FR' } }));
    expect(classementDeCommande(illisible, 'FR')).toBe('invalide');
    const fixe = schemaCommande.parse(commande({ shipping_address: { phone: '01 42 68 53 00', country_code: 'FR' } }));
    expect(classementDeCommande(fixe, 'FR')).toBe('invalide');
  });

  it('un mobile quelque part : utilisable, et c’est le numéro du message', () => {
    const c = schemaCommande.parse(commande({ shipping_address: { phone: '01 42 68 53 00', country_code: 'FR' }, customer: { id: 9, phone: '06 12 34 56 78' } }));
    expect(classementDeCommande(c, 'FR')).toBe('utilisable');
    expect(telephoneDeCommande(c, 'FR')).not.toBeNull();
  });
});

/**
 * LES LIGNES D'UNE COMMANDE PAYÉE (segments Shopify enrichis, lot 3), dans la forme REST de `line_items` que décrit la
 * doc de Shopify. 🔴 Une ligne illisible s'écarte seule : jamais la commande, ni sa confirmation avec elle.
 */
describe('🔴 les lignes d’une commande payée', () => {
  const ligne = (over: Record<string, unknown> = {}) => ({
    id: 13741, product_id: 8801, variant_id: 4601, sku: 'SER-30', title: 'Sérum vitamine C', variant_title: '30 ml',
    name: 'Sérum vitamine C - 30 ml', quantity: 2, price: '24.00', gift_card: false, ...over,
  });

  it('se lisent sans prix, identifiants en texte, dans l’ordre du corps', () => {
    const c = schemaCommande.parse(commande({ line_items: [ligne(), ligne({ id: 13742, product_id: null, sku: '', title: 'Pourboire', variant_title: null, quantity: 1 })] }));
    expect(lignesDeCommande(c)).toEqual({
      tronquees: false,
      lignes: [
        { ligneId: '13741', produitId: '8801', varianteId: '4601', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', quantite: 2, carteCadeau: false },
        // Une ligne sur mesure : sans produit, son SKU vide ramené à nul, gardée par son titre.
        { ligneId: '13742', produitId: null, varianteId: '4601', sku: null, titre: 'Pourboire', varianteTitre: null, quantite: 1, carteCadeau: false },
      ],
    });
  });

  it('🔴 une ligne illisible (quantité, identifiant, titre) s’écarte seule ; la commande et les autres lignes restent', () => {
    const corps = commande({ line_items: [ligne({ quantity: 0 }), ligne({ id: null }), ligne({ title: ' ', name: '' }), 'pas une ligne', ligne({ id: 13745 })] });
    const c = schemaCommande.safeParse(corps);
    expect(c.success).toBe(true);
    expect(lignesDeCommande(c.data!).lignes.map((l) => l.ligneId)).toEqual(['13745']);
    // Une liste qui n'en est pas une se lit comme aucune ligne, la commande toujours acceptée.
    const etrange = schemaCommande.safeParse(commande({ line_items: { id: 1 } }));
    expect(etrange.success).toBe(true);
    expect(lignesDeCommande(etrange.data!)).toEqual({ lignes: [], tronquees: false });
  });

  it('la carte cadeau est gardée, marquée ; le titre se replie sur `name` ; une ligne en double ne compte qu’une fois', () => {
    const c = schemaCommande.parse(commande({ line_items: [ligne({ gift_card: true, title: null }), ligne()] }));
    expect(lignesDeCommande(c).lignes).toEqual([
      { ligneId: '13741', produitId: '8801', varianteId: '4601', sku: 'SER-30', titre: 'Sérum vitamine C - 30 ml', varianteTitre: '30 ml', quantite: 2, carteCadeau: true },
    ]);
  });

  it(`🔴 ${LIGNES_MAX} lignes au plus, les premières du corps, et la commande dit qu’elle est tronquée`, () => {
    const lignes = Array.from({ length: LIGNES_MAX + 3 }, (_, i) => ligne({ id: 20000 + i }));
    const lu = lignesDeCommande(schemaCommande.parse(commande({ line_items: lignes })));
    expect([lu.lignes.length, lu.tronquees, lu.lignes[0]!.ligneId, lu.lignes.at(-1)!.ligneId]).toEqual([LIGNES_MAX, true, '20000', String(20000 + LIGNES_MAX - 1)]);
    const pile = lignesDeCommande(schemaCommande.parse(commande({ line_items: lignes.slice(0, LIGNES_MAX) })));
    expect([pile.lignes.length, pile.tronquees]).toEqual([LIGNES_MAX, false]);
  });

  it('un titre trop long se coupe à 200 caractères, la ligne gardée ; sans `line_items`, aucune ligne', () => {
    const c = schemaCommande.parse(commande({ line_items: [ligne({ title: 'x'.repeat(250) })] }));
    expect(lignesDeCommande(c).lignes[0]!.titre).toHaveLength(200);
    expect(lignesDeCommande(schemaCommande.parse(commande()))).toEqual({ lignes: [], tronquees: false });
  });
});
