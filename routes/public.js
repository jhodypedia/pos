// routes/public.js
import { Router } from "express";
import { pool } from "../db/pool.js";
import { getCoreApiFromSettings } from "../services/midtrans.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.get('/', async (req, res) => {
  const [products] = await pool.query("SELECT * FROM products WHERE active=1 ORDER BY name ASC");
  res.render('index', { products });
});

router.post('/order/create', async (req, res) => {
  try {
    const { items, customer_name, customer_phone } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Keranjang kosong' });

    const ids = items.map(i => i.product_id);
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
    const map = Object.fromEntries(rows.map(r => [String(r.id), r]));
    const detail = items.map(i => {
      const p = map[String(i.product_id)];
      if (!p) throw new Error('Produk tidak ditemukan');
      return { product: p, qty: Math.max(1, parseInt(i.qty, 10)) };
    });

    const gross_amount = detail.reduce((s, d) => s + d.product.price * d.qty, 0);
    const order_id = "ORD-" + uuidv4().slice(0, 8).toUpperCase();

    const [ins] = await pool.query("INSERT INTO orders (order_id, customer_name, customer_phone, gross_amount) VALUES (?,?,?,?)",
      [order_id, customer_name || null, customer_phone || null, gross_amount]);

    for (const d of detail) {
      await pool.query("INSERT INTO order_items (order_id_ref, product_id, qty, price) VALUES (?,?,?,?)",
        [ins.insertId, d.product.id, d.qty, d.product.price]);
    }

    const { core } = await getCoreApiFromSettings();
    const chargePayload = {
      payment_type: "qris",
      transaction_details: { order_id, gross_amount },
      item_details: detail.map(d => ({ id: String(d.product.id), price: d.product.price, quantity: d.qty, name: d.product.name })),
      customer_details: { first_name: customer_name || 'Pelanggan' }
    };

    const charge = await core.charge(chargePayload);
    await pool.query("INSERT INTO payments (order_id, payment_type, transaction_status, transaction_id, fraud_status, raw_json) VALUES (?,?,?,?,?,?)",
      [order_id, 'qris', charge.transaction_status || 'pending', charge.transaction_id || null, charge.fraud_status || null, JSON.stringify(charge)]);

    let qrUrl = charge.qr_url || null;
    if (!qrUrl && Array.isArray(charge.actions)) {
      const a = charge.actions.find(x => /qr|qris/i.test(x.name || ''));
      qrUrl = a?.url || null;
    }

    res.json({ ok: true, order_id, gross_amount, qrUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// public order view
router.get('/o/:order_id', async (req, res) => {
  const order_id = req.params.order_id;
  const [[order]] = await pool.query("SELECT * FROM orders WHERE order_id=?", [order_id]);
  if (!order) return res.status(404).send('Order tidak ditemukan');
  const [items] = await pool.query("SELECT oi.*, p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE order_id_ref=?", [order.id]);
  res.render('order_view', { order, items });
});

// status endpoint for polling
router.get('/o/status/:order_id', async (req, res) => {
  const order_id = req.params.order_id;
  const [[order]] = await pool.query("SELECT status FROM orders WHERE order_id=?", [order_id]);
  if (!order) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, status: order.status });
});

export default router;
