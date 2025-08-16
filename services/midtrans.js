// services/midtrans.js
import midtransClient from "midtrans-client";
import { pool } from "../db/pool.js";

export async function getCoreApiFromSettings() {
  const [rows] = await pool.query(
    "SELECT key_name, value FROM settings WHERE key_name IN ('midtrans_server_key','midtrans_client_key','midtrans_is_production')"
  );
  const map = {};
  rows.forEach(r => map[r.key_name] = r.value);
  const isProd = (map.midtrans_is_production === 'true');
  const serverKey = map.midtrans_server_key || '';
  const clientKey = map.midtrans_client_key || '';
  const core = new midtransClient.CoreApi({ isProduction: isProd, serverKey, clientKey });
  return { core, serverKey, clientKey };
}
