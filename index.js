// ─── WhatsApp Bot ─────────────────────────────────────────────────────────────

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import P from "pino";
import { isDeliveryMessage } from "./parser.js";
import {
  loadRows,
  getFirstAvailableVehicle,
  setActiveFile,
} from "./excelManager.js";
import { ALLOWED_GROUPS, ADMIN } from "./config.js";
import { logEvent } from "./logger.js";
import { setBotState, isBotEnabled, setBotEnabled } from "./state.js";

// ── Single socket instance ────────────────────────────────────────────────────
let currentSock = null;
let _isStarting = false;
let _rowsReady  = false; // true once setActiveFile() has finished loading rows
let _senderKeyReady = false; // true once group sender-key pre-warm completes

export async function startBot() {
  if (_isStarting) {
    console.log("⚠️  startBot already in progress — skipping");
    return;
  }
  _isStarting = true;

  _rowsReady = false;
  _senderKeyReady = false;

  if (currentSock) {
    try { currentSock.end(); } catch (_) {}
    currentSock = null;
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: "silent" }),
    });
    currentSock = sock;
    _isStarting = false;

    sock.ev.on("creds.update", saveCreds);

    // ── Connection state machine ───────────────────────────────────────────

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

        try {
          const phone =
            sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0];
          if (phone) {
            console.log(`📱 Connected as: ${phone}`);
            setActiveFile(phone); // synchronous — rows are ready before we return
            _rowsReady = true;
          }
        } catch (err) {
          console.error("❌ Could not get phone number:", err.message);
        }

        // Pre-warm the group sender-key so first real sendMessage doesn't pay
        // the ~1s key-fetch + encrypt cost. We send a real text message then
        // immediately delete it — this is the only Baileys call that actually
        // triggers the full sender-key negotiation with WA servers.
        _prewarmGroups(sock);
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

        console.log(
          `🔴 Connection closed (${shouldReconnect ? "reconnecting" : "logged out"})`,
        );

        if (shouldReconnect && sock === currentSock) {
          currentSock = null;
          setTimeout(startBot, 3000);
        }
      }
    });

    // ── Message handler ────────────────────────────────────────────────────

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;
      if (!_rowsReady) return; // rows not loaded yet — skip replayed startup messages

      // FIX (messageTime): capture message arrival time before any async work
      const messageTime = new Date().toISOString();

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

      // ── Admin commands ───────────────────────────────────────────────────
      if (sender === ADMIN && text.startsWith("/")) {
        await handleAdminCommand(sock, jid, msg, text.toLowerCase());
        return;
      }

      if (!isBotEnabled()) return;
      if (!ALLOWED_GROUPS.has(jid)) return;
      if (!isDeliveryMessage(text)) return;

      // ── Dispatch vehicle ─────────────────────────────────────────────────

      // If pre-warm hasn't finished yet, wait for it so this message gets the
      // same fast path as all subsequent ones. Cap the wait at 2s max.
      if (!_senderKeyReady) {
        await _waitForSenderKey(2000);
      }

      const vehicle = getFirstAvailableVehicle();
      console.log("🚚 Vehicle dispatched:", vehicle ?? "none available");

      if (vehicle) {
        await sock.sendMessage(jid, { text: vehicle }, { quoted: msg });
        logEvent({ vehicle, group: jid, sender, messageTime });
      } else {
        logEvent({ vehicle: null, group: jid, sender, messageTime, note: "none available" });
      }
    });
  } catch (err) {
    console.error("❌ startBot error:", err.message);
    _isStarting = false;
    currentSock = null;
    setTimeout(startBot, 5000);
  }
}

// ── Sender-key pre-warmer ─────────────────────────────────────────────────────
// Sends a message to each allowed group then immediately deletes it.
// This forces Baileys to complete the full sender-key negotiation with WA
// servers in the background so the first real reply is as fast as all others.

async function _prewarmGroups(sock) {
  for (const groupJid of ALLOWED_GROUPS) {
    try {
      const sent = await sock.sendMessage(groupJid, { text: "\u200b" }); // zero-width space
      if (sent?.key) {
        await sock.sendMessage(groupJid, { delete: sent.key });
      }
      console.log(`🔑 Sender-key pre-warmed for ${groupJid}`);
    } catch (err) {
      console.warn(`⚠️  Pre-warm failed for ${groupJid}:`, err.message);
    }
  }
  _senderKeyReady = true;
}

// Waits until _senderKeyReady is true or the timeout elapses.
function _waitForSenderKey(timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (_senderKeyReady || Date.now() >= deadline) return resolve();
      setTimeout(check, 50);
    };
    check();
  });
}

// ── Admin command handler ──────────────────────────────────────────────────────

async function handleAdminCommand(sock, jid, msg, cmd) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

  if (cmd === "/status")
    return reply(`Bot: ${isBotEnabled() ? "ON ✅" : "OFF ❌"}`);
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