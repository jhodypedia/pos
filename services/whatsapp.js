// services/whatsapp.js
import baileys, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
const { makeWASocket } = baileys;
import pino from "pino";
import qrcode from "qrcode";
import { EventEmitter } from "events";

const waEvents = new EventEmitter();
let sock = null;
let ready = false;
let currentQr = null;

export async function startWALogin() {
  const { state, saveCreds } = await useMultiFileAuthState("./.wa-auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" })
  });

  // simpan creds
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = await qrcode.toDataURL(qr);
      waEvents.emit("qr", currentQr);
    }

    if (connection === "open") {
      ready = true;
      currentQr = null;
      waEvents.emit("ready", true);
    }

    if (connection === "close") {
      ready = false;
      waEvents.emit("ready", false);

      // cek apakah harus reconnect
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("🔄 Reconnecting WA...");
        setTimeout(() => startWALogin(), 3000); // auto reconnect 3 detik
      } else {
        console.log("❌ Logged out from WhatsApp, please scan again.");
      }
    }
  });

  return { ok: true };
}

export function onWAEvent(name, cb) {
  waEvents.on(name, cb);
}

export function getCurrentQrDataUrl() {
  return currentQr;
}

export function isWAReady() {
  return ready;
}

function normalizeIndoNumber(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+62")) s = "62" + s.slice(3);
  if (s.startsWith("08")) s = "62" + s.slice(1);
  if (s.startsWith("0")) s = "62" + s.slice(1);
  if (s.startsWith("8")) s = "62" + s;
  if (!/^62\d{8,13}$/.test(s)) return null;
  return s + "@s.whatsapp.net";
}

export async function sendText(to, text) {
  if (!sock || !ready) throw new Error("WA not ready");
  const jid = normalizeIndoNumber(to);
  if (!jid) throw new Error("Invalid number");
  await sock.sendMessage(jid, { text });
}
