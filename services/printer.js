// services/printer.js
import escpos from "escpos";
import escposNetwork from "escpos-network";
import { pool } from "../db/pool.js";

escpos.Network = escposNetwork;

export async function printReceipt({ shop, order, items, pay }) {
  // read printer settings from DB
  const [rows] = await pool.query("SELECT key_name, value FROM settings WHERE key_name IN ('printer_enabled','printer_host','printer_port')");
  const map = {};
  rows.forEach(r => map[r.key_name] = r.value);
  if (!map.printer_enabled || map.printer_enabled !== 'true') return;
  const host = map.printer_host;
  const port = parseInt(map.printer_port || "9100", 10);
  if (!host) return;

  const device = new escpos.Network(host, port);
  const options = { encoding: "GB18030" };
  const printer = new escpos.Printer(device, options);

  return new Promise((resolve, reject) => {
    device.open((err) => {
      if (err) return reject(err);
      try {
        printer.align('ct').style('b').size(1,1).text(shop.name || '')
          .style('normal').text(shop.address || '').text(shop.phone || '').drawLine()
          .align('lt').text(`Order : ${order.order_id}`).text(`Tanggal: ${new Date().toLocaleString('id-ID')}`).drawLine();

        items.forEach(i => {
          const left = `${i.name} x${i.qty}`;
          const right = `Rp ${(i.price*i.qty).toLocaleString('id-ID')}`;
          printer.tableCustom([{ text: left, align: 'LEFT', width: 0.6 }, { text: right, align: 'RIGHT', width: 0.4 }]);
        });

        printer.drawLine();
        printer.tableCustom([{ text: 'TOTAL', align: 'LEFT', width: 0.6, style: 'B' }, { text: `Rp ${order.gross_amount.toLocaleString('id-ID')}`, align: 'RIGHT', width: 0.4, style: 'B' }]);
        printer.text(`Pembayaran: ${pay.payment_type || 'QRIS'}`);
        if (pay.transaction_id) printer.text(`TX: ${pay.transaction_id}`);
        printer.drawLine().align('ct').text('Terima kasih 🙏').text('Simpan struk ini sebagai bukti.').cut().close(() => resolve(true));
      } catch (e) {
        reject(e);
      }
    });
  });
}
