// routes/admin.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { startWALogin, getCurrentQrDataUrl, onWAEvent, isWAReady, sendText } from "../services/whatsapp.js";
import { v4 as uuidv4 } from "uuid";
import { getCoreApiFromSettings } from "../services/midtrans.js";

const admin = Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/adm/login');
  next();
}

// --- Auth ---
admin.get('/adm/login', (req, res) => res.render('adm_login', { error: null }));
admin.post('/adm/login', async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await pool.query("SELECT * FROM users WHERE username=?", [username]);
  if (!rows.length) return res.render('adm_login', { error: 'User tidak ditemukan' });
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render('adm_login', { error: 'Password salah' });
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect('/adm');
});
admin.get('/adm/logout', (req, res) => { req.session.destroy(() => res.redirect('/adm/login')); });

// --- Dashboard ---
admin.get('/adm', requireAdmin, (req, res) => res.render('adm_dashboard', { user: req.session.user }));

admin.get('/adm/api/dashboard-stats', requireAdmin, async (req, res) => {
  const [[incRow]] = await pool.query("SELECT COALESCE(SUM(gross_amount),0) as income FROM orders WHERE status='PAID'");
  const [[orderCountRow]] = await pool.query("SELECT COUNT(*) as cnt FROM orders");
  const [[storeNameRow]] = await pool.query("SELECT value FROM settings WHERE key_name='store_name'");
  const [[expRow]] = await pool.query("SELECT value FROM settings WHERE key_name='expense_total'");
  res.json({
    income: incRow.income || 0,
    expense: expRow ? parseInt(expRow.value || '0', 10) : 0,
    orders: orderCountRow.cnt || 0,
    store_name: storeNameRow ? storeNameRow.value : 'TOKO'
  });
});

// --- Settings page ---
admin.get('/adm/settings', requireAdmin, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM settings");
  const settings = {};
  rows.forEach(r => settings[r.key_name] = r.value);
  res.render('adm_settings', { settings });
});

admin.post('/adm/settings', requireAdmin, async (req, res) => {
  const data = req.body;
  for (const [k, v] of Object.entries(data)) {
    await pool.query("INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?", [k, v, v]);
  }
  res.redirect('/adm/settings');
});

// --- WA Login ---
// --- WA Login ---
admin.get('/adm/wa/login', requireAdmin, async (req, res) => {
  try {
    // kalau sudah ready, balikin status langsung
    if (isWAReady()) {
      return res.json({ ok: true, ready: true, message: "WhatsApp sudah terhubung" });
    }

    // mulai login
    await startWALogin();

    // kalau ada QR tersimpan, kirim langsung
    const qr = getCurrentQrDataUrl();
    if (qr) {
      return res.json({ ok: true, qr });
    }

    // kalau belum ada, tunggu sampai ada event QR
    const qrPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("QR timeout")), 20000);

      const handler = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };

      // ✅ pakai once biar nggak numpuk listener
      onWAEvent("qr", handler);
    });

    const dataUrl = await qrPromise;
    return res.json({ ok: true, qr: dataUrl });

  } catch (e) {
    console.error("WA Login Error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// --- WA Status ---
admin.get("/adm/wa/status", requireAdmin, (req, res) => {
  return res.json({
    ok: true,
    ready: isWAReady(),
    qr: getCurrentQrDataUrl() || null
  });
});

// --- Products SPA (DataTables server-side) ---
admin.get('/adm/products', requireAdmin, (req, res) => res.render('adm_products'));

admin.post('/adm/api/products', requireAdmin, async (req, res) => {
  const { draw, start = 0, length = 10, search = {} } = req.body;
  const searchValue = (search && search.value) ? search.value : '';
  const order = req.body.order || [];
  let orderStr = 'id DESC';
  if (order.length) {
    const col = req.body.columns[order[0].column].data;
    const dir = order[0].dir === 'asc' ? 'ASC' : 'DESC';
    if (['id', 'sku', 'name', 'price', 'stock', 'active'].includes(col)) orderStr = `${col} ${dir}`;
  }
  const params = [];
  let where = '';
  if (searchValue) {
    where = "WHERE (sku LIKE ? OR name LIKE ?)";
    params.push(`%${searchValue}%`, `%${searchValue}%`);
  }
  const [countRows] = await pool.query(`SELECT COUNT(*) as c FROM products ${where}`, params);
  const recordsTotal = countRows[0].c;
  const [rows] = await pool.query(`SELECT * FROM products ${where} ORDER BY ${orderStr} LIMIT ?,?`, [...params, parseInt(start, 10), parseInt(length, 10)]);
  res.json({ draw: parseInt(draw || 1, 10), recordsTotal, recordsFiltered: recordsTotal, data: rows });
});

admin.post('/adm/api/products/create', requireAdmin, async (req, res) => {
  const { sku, name, price, stock } = req.body;
  try {
    await pool.query("INSERT INTO products (sku,name,price,stock) VALUES (?,?,?,?)", [sku || ('SKU' + uuidv4().slice(0, 6)), name, parseInt(price || 0, 10), parseInt(stock || 0, 10)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

admin.post('/adm/api/products/update', requireAdmin, async (req, res) => {
  const { id, sku, name, price, stock, active } = req.body;
  try {
    await pool.query("UPDATE products SET sku=?, name=?, price=?, stock=?, active=? WHERE id=?", [sku, name, parseInt(price || 0, 10), parseInt(stock || 0, 10), active ? 1 : 0, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

admin.post('/adm/api/products/delete', requireAdmin, async (req, res) => {
  const { id } = req.body;
  try { await pool.query("DELETE FROM products WHERE id=?", [id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- Users management (CRUD) ---
admin.get('/adm/users', requireAdmin, (req, res) => res.render('adm_users'));

admin.post('/adm/api/users', requireAdmin, async (req, res) => {
  const { draw, start = 0, length = 10, search = {} } = req.body;
  const searchValue = (search && search.value) ? search.value : '';
  let where = '';
  const params = [];
  if (searchValue) {
    where = "WHERE (username LIKE ?)";
    params.push(`%${searchValue}%`);
  }
  const [countRows] = await pool.query(`SELECT COUNT(*) as c FROM users ${where}`, params);
  const recordsTotal = countRows[0].c;
  const [rows] = await pool.query(`SELECT id,username,role,created_at FROM users ${where} ORDER BY id DESC LIMIT ?,?`, [...params, parseInt(start, 10), parseInt(length, 10)]);
  res.json({ draw: parseInt(draw || 1, 10), recordsTotal, recordsFiltered: recordsTotal, data: rows });
});

admin.post('/adm/api/users/create', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username,password_hash,role) VALUES (?,?,?)", [username, hash, role || 'admin']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

admin.post('/adm/api/users/update', requireAdmin, async (req, res) => {
  const { id, username, password, role } = req.body;
  try {
    if (password && password.length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query("UPDATE users SET username=?, password_hash=?, role=? WHERE id=?", [username, hash, role || 'admin', id]);
    } else {
      await pool.query("UPDATE users SET username=?, role=? WHERE id=?", [username, role || 'admin', id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

admin.post('/adm/api/users/delete', requireAdmin, async (req, res) => {
  const { id } = req.body;
  try { await pool.query("DELETE FROM users WHERE id=?", [id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- Expose midtrans test endpoint to check config (optional) ---
admin.get('/adm/test-midtrans', requireAdmin, async (req, res) => {
  try {
    const { core } = await getCoreApiFromSettings();
    // call API minimal (get charge example not necessary). Just return client key presence
    res.json({ ok: true, msg: 'Midtrans client available' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default admin;
