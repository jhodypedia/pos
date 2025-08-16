// routes/webhook.js
import { Router } from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { getCoreApiFromSettings } from "../services/midtrans.js";
import { printReceipt } from "../services/printer.js";
import { sendText } from "../services/whatsapp.js";
import dotenv from "dotenv";
dotenv.config();

const router = Router();

router.post('/midtrans/notification', async (req, res) => {
  try {
    const b = req.body;
    const { serverKey } = await getCoreApiFromSettings();
    const raw = b.order_id + b.status_code + b.gross_amount + serverKey;
    const expected = crypto.createHash('sha512').update(raw).digest('hex');
    if (expected !== b.signature_key) {
      console.warn('Invalid signature', b.order_id);
      return res.status(403).send('Invalid signature');
    }

    await pool.query("INSERT INTO payments (order_id, payment_type, transaction_status, transaction_id, fraud_status, raw_json) VALUES (?,?,?,?,?,?)",
      [b.order_id, b.payment_type, b.transaction_status, b.transaction_id, b.fraud_status, JSON.stringify(b)]);

    const paidStatuses = new Set(['settlement', 'capture', 'success']);
    if (paidStatuses.has(b.transaction_status)) {
      await pool.query("UPDATE orders SET status='PAID', paid_at=NOW() WHERE order_id=?", [b.order_id]);
      const [[order]] = await pool.query("SELECT * FROM orders WHERE order_id=?", [b.order_id]);
      const [items] = await pool.query("SELECT oi.*, p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE order_id_ref=?", [order.id]);

      try {
        await printReceipt({
          shop: { name: 'TOKO CONTOH', address: 'Jl. Mawar No.1', phone: '0812-0000-0000' },
          order: { order_id: b.order_id, gross_amount: order.gross_amount },
          items: items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
          pay: { payment_type: b.payment_type, transaction_id: b.transaction_id }
        });
      } catch (e) {
        console.warn('Print error', e?.message || e);
      }

      const [rows] = await pool.query("SELECT value FROM settings WHERE key_name='wa_admin_numbers'");
      let adminNums = [];
      if (rows.length) adminNums = (rows[0].value || '').split(',').map(s => s.trim()).filter(Boolean);

      const recipients = [...adminNums];
      if (order.customer_phone) recipients.push(order.customer_phone);

      const textLines = [`Pembayaran SUKSES ✅`, `Order: ${b.order_id}`, `Total: Rp ${order.gross_amount.toLocaleString('id-ID')}`, `Detail:`];
      items.forEach(i => textLines.push(`• ${i.name} x${i.qty} = Rp ${(i.price * i.qty).toLocaleString('id-ID')}`));
      textLines.push(`${process.env.APP_URL}/o/${b.order_id}`);
      const text = textLines.join('\n');

      for (const r of recipients) {
        try { await sendText(r, text); } catch (e) { console.warn('WA send fail', r, e?.message || e); }
      }
    }

    res.send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('ERROR');
  }
});

export default router;
