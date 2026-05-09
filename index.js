// ─── WhatsApp Bot ─────────────────────────────────────────────────────────────

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import P from "pino";
import { isDeliveryMessage } from "./parser.js";
import { loadRows, getFirstAvailableVehicle } from "./excelManager.js";
import { ALLOWED_GROUPS, ADMIN } from "./config.js";
import { logEvent } from "./logger.js";
import { setBotState, isBotEnabled, setBotEnabled } from "./state.js";

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  // ── Connection state machine ─────────────────────────────────────────────

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr, isOnline } = update;

    if (qr) {
      setBotState({ status: "qr", qr });
      console.log("📱 QR code generated — scan with WhatsApp");
    }

    if (connection === "connecting") {
      setBotState({ status: "connecting" });
    }

    if (connection === "open") {
      setBotState({ status: "connected", qr: null, connected: true });
      console.log("✅ Bot connected");
    }

    if (isOnline) {
      setBotState({ status: "online", connected: true });
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      setBotState({
        status: shouldReconnect ? "reconnecting" : "logged_out",
        qr: null,
        connected: false,
      });

      console.log(`🔴 Connection closed (${shouldReconnect ? "reconnecting" : "logged out"})`);

      if (shouldReconnect) {
        setTimeout(startBot, 3000); // brief delay before reconnect
      }
    }
  });

  // ── Message handler ──────────────────────────────────────────────────────

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid    = msg.key.remoteJid;
    const sender = msg.key.participant || jid;
    const message = msg.message;

    const text =
      message?.conversation ||
      message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption ||
      message?.videoMessage?.caption ||
      message?.buttonsResponseMessage?.selectedButtonId ||
      message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      "";

    if (!text) return;

    // ── Admin commands ─────────────────────────────────────────────────────
    if (sender === ADMIN && text.startsWith("/")) {
      await handleAdminCommand(sock, jid, msg, text.toLowerCase());
      return;
    }
console.log("GROUP JID:", jid);
    if (!isBotEnabled()) return;
    if (!ALLOWED_GROUPS.has(jid)) return;
    if (!isDeliveryMessage(text)) return;

    // ── Dispatch vehicle ───────────────────────────────────────────────────
    const vehicle = getFirstAvailableVehicle();
    console.log("🚚 Vehicle dispatched:", vehicle ?? "none available");

    if (vehicle) {
      await sock.sendMessage(jid, { text: vehicle }, { quoted: msg });
      logEvent({ vehicle, group: jid, sender });
    } else {
      await sock.sendMessage(
        jid,
        { text: "No vehicle available right now." },
        { quoted: msg }
      );
      logEvent({ vehicle: null, group: jid, sender, note: "none available" });
    }
  });
}

// ── Admin command handler ──────────────────────────────────────────────────────

async function handleAdminCommand(sock, jid, msg, cmd) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

  if (cmd === "/status") {
    return reply(`Bot: ${isBotEnabled() ? "ON ✅" : "OFF ❌"}`);
  }
  if (cmd === "/pause") {
    setBotEnabled(false);
    return reply("Bot paused ❌");
  }
  if (cmd === "/resume") {
    setBotEnabled(true);
    return reply("Bot resumed ✅");
  }
  if (cmd === "/reload") {
    loadRows();
    return reply("Excel reloaded 🔄");
  }
}
