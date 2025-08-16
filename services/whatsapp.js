// services/whatsapp.js
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
import qrcode from "qrcode";
import { EventEmitter } from "events";

const waEvents = new EventEmitter();
let sock = null;
let ready = false;
let currentQr = null;

export async function startWALogin() {
  const { state, saveCreds } = await useMultiFileAuthState("./.wa-auth");
  sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: { level: 'silent' } });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    if (update.qr) {
      currentQr = await qrcode.toDataURL(update.qr);
      waEvents.emit('qr', currentQr);
    }
    if (update.connection === 'open') {
      ready = true;
      currentQr = null;
      waEvents.emit('ready', true);
    }
    if (update.connection === 'close') {
      ready = false;
      waEvents.emit('ready', false);
    }
  });
  return { ok: true };
}

export function onWAEvent(name, cb) { waEvents.on(name, cb); }
export function getCurrentQrDataUrl() { return currentQr; }
export function isWAReady() { return ready; }

function normalizeIndoNumber(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/[^\d+]/g, '');
  if (s.startsWith('+62')) s = '62' + s.slice(3);
  if (s.startsWith('08')) s = '62' + s.slice(1);
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (s.startsWith('8')) s = '62' + s;
  if (!/^62\d{8,13}$/.test(s)) return null;
  return s + "@s.whatsapp.net";
}

export async function sendText(to, text) {
  if (!sock || !ready) throw new Error('WA not ready');
  const jid = normalizeIndoNumber(to);
  if (!jid) throw new Error('Invalid number');
  await sock.sendMessage(jid, { text });
}
