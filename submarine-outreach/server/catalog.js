// Pen options and brochures that get matched to each business and shown in its email.
import { randomBytes } from 'node:crypto';

// Starting catalog from Submarine's public range. No prices are invented — fill them in on the Catalog page.
const STARTER_PRODUCTS = [
  {
    name: 'Coffee Aroma Collection',
    description: 'Metal pens with a real coffee scent — Americano, Cappuccino, Mocha, Espresso, Latte and Macchiato.',
    best_for: 'coffee,gift_shop,stationery,bookstore,corporate_gifting,promo_distributor,hotel,events',
  },
  {
    name: 'Space Series',
    description: 'Space-themed metal pens inspired by ISRO and NASA missions.',
    best_for: 'museum_shop,university,gift_shop,bookstore,corporate_gifting,stationery',
  },
  {
    name: 'Custom-logo metal ballpoints',
    description: 'Solid metal ballpoints with your logo laser-engraved or printed, factory-direct with low minimums.',
    best_for: 'promo_distributor,corporate_gifting,real_estate,law_firm,insurance_finance,events,hotel,university,corporate,office_supply,coffee',
  },
  {
    name: 'Crystal Series',
    description: 'Metal pens with crystal detailing, gift-boxed — popular for appreciation and closing gifts.',
    best_for: 'gift_shop,real_estate,events,corporate_gifting,hotel',
  },
  {
    name: 'Fountain Pen Series',
    description: 'Metal fountain pens for everyday writing and gifting.',
    best_for: 'stationery,bookstore,law_firm,corporate_gifting,gift_shop,university',
  },
  {
    name: 'Doctor-clip pens',
    description: 'Pens with a secure clip designed for coat and scrub pockets.',
    best_for: 'medical_dental,insurance_finance,promo_distributor',
  },
  {
    name: 'Engrave-ready gift sets',
    description: 'Metal pen blanks and presentation boxes ready for personalisation.',
    best_for: 'engraving,corporate_gifting,real_estate,law_firm,promo_distributor',
  },
  {
    name: 'Pen-drive pens',
    description: 'Metal pens with a built-in USB drive — handy for conferences and onboarding kits.',
    best_for: 'corporate,events,law_firm,promo_distributor,university',
  },
  {
    name: 'Mini pens',
    description: 'Compact metal pens for planners, wallets and welcome kits.',
    best_for: 'events,hotel,gift_shop,promo_distributor,stationery',
  },
];

export function makeCatalog(db, config) {
  if (!db.prepare('SELECT COUNT(*) AS n FROM products').get().n) {
    const ins = db.prepare('INSERT INTO products(name, description, best_for, sort) VALUES (?,?,?,?)');
    STARTER_PRODUCTS.forEach((p, i) => ins.run(p.name, p.description, p.best_for, i));
  }

  const brochureUrl = (b) => (b ? `${config.publicUrl}/b/${b.token}` : null);
  const BROCHURE_COLS = 'id, token, title, filename, mime, size, created_at';

  function listBrochures() {
    return db.prepare(`SELECT ${BROCHURE_COLS} FROM brochures ORDER BY id DESC`).all().map((b) => ({ ...b, url: brochureUrl(b) }));
  }

  function addBrochure({ title, filename, mime, data }) {
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length) throw new Error('empty file');
    if (buf.length > 15 * 1024 * 1024) throw new Error('brochure must be under 15 MB');
    const safeName = String(filename || 'brochure.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const info = db.prepare('INSERT INTO brochures(token, title, filename, mime, size, data) VALUES (?,?,?,?,?,?)')
      .run(randomBytes(12).toString('base64url'), String(title || safeName), safeName, String(mime || 'application/pdf'), buf.length, buf);
    return listBrochures().find((b) => b.id === Number(info.lastInsertRowid));
  }

  const getBrochureByToken = (token) => db.prepare('SELECT * FROM brochures WHERE token = ?').get(String(token));
  const getBrochures = (ids) => (ids?.length ? db.prepare(`SELECT * FROM brochures WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids.map(Number)) : []);

  function listProducts({ activeOnly = false } = {}) {
    const brochures = new Map(listBrochures().map((b) => [b.id, b]));
    return db.prepare(`SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`).all()
      .map((p) => ({ ...p, best_for: (p.best_for || '').split(',').filter(Boolean), brochure: brochures.get(p.brochure_id) || null }));
  }

  function saveProduct(p) {
    const vals = [
      String(p.name || '').trim(), p.description || null,
      Array.isArray(p.best_for) ? p.best_for.join(',') : p.best_for || null,
      p.price_note || null, p.link || null, p.brochure_id ? Number(p.brochure_id) : null, p.active === false || p.active === 0 ? 0 : 1,
    ];
    if (!vals[0]) throw new Error('product name required');
    if (p.id) {
      db.prepare('UPDATE products SET name=?, description=?, best_for=?, price_note=?, link=?, brochure_id=?, active=? WHERE id=?').run(...vals, Number(p.id));
      return Number(p.id);
    }
    return Number(db.prepare('INSERT INTO products(name, description, best_for, price_note, link, brochure_id, active, sort) VALUES (?,?,?,?,?,?,?, 999)').run(...vals).lastInsertRowid);
  }

  /** The products that best suit a segment (segment matches first), for templates and as AI hints. */
  function productsFor(segment, limit = 3) {
    const all = listProducts({ activeOnly: true });
    const matched = all.filter((p) => segment && p.best_for.includes(segment));
    return (matched.length ? matched : all).slice(0, limit);
  }

  /** One-line-per-product text a person might type, e.g. "- Coffee Aroma Collection: ... (brochure: url)". */
  function productLines(products) {
    return products.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ''}${p.price_note ? ` (${p.price_note})` : ''}`).join('\n');
  }

  /** Default brochure: the first chosen product's, else the most recent upload. */
  function brochureFor(products) {
    const own = products.find((p) => p.brochure)?.brochure;
    return own || listBrochures()[0] || null;
  }

  return {
    listBrochures, addBrochure, getBrochureByToken, getBrochures, brochureUrl,
    deleteBrochure: (id) => db.prepare('DELETE FROM brochures WHERE id = ?').run(Number(id)),
    listProducts, saveProduct, productsFor, productLines, brochureFor,
    deleteProduct: (id) => db.prepare('DELETE FROM products WHERE id = ?').run(Number(id)),
  };
}
