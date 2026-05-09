// ─── Express Server ───────────────────────────────────────────────────────────

import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { startBot } from "./index.js";
import { getBotState } from "./state.js";
import { getLogs } from "./logger.js";
import { getRows, addRow, updateRow, deleteRow } from "./excelManager.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const DASHBOARD_KEY = process.env.DASHBOARD_KEY;
if (!DASHBOARD_KEY) throw new Error("Missing DASHBOARD_KEY in .env");

// ── Simple session store (in-memory) ─────────────────────────────────────────
// Maps token → expiry timestamp. Tokens expire after 8 hours.

const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();

function createSession() {
  const token  = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function isValidSession(token) {
  if (!token || !sessions.has(token)) return false;
  if (Date.now() > sessions.get(token)) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (isValidSession(req.cookies?.session)) return next();
  // API calls get 401, browser requests get redirected to login
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  res.redirect("/login");
}

// ── Login routes (public) ─────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  if (isValidSession(req.cookies?.session)) return res.redirect("/");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login — Bot Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=DM+Mono&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0f14;
      color: #e8eaf0;
      font-family: 'Syne', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .box {
      background: #13161e;
      border: 1px solid #1f2430;
      border-radius: 12px;
      padding: 40px;
      width: 340px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    h1 { font-size: 20px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
    p  { font-size: 13px; color: #5a607a; }
    input {
      width: 100%;
      background: #0d0f14;
      border: 1px solid #1f2430;
      border-radius: 6px;
      color: #e8eaf0;
      font-family: 'DM Mono', monospace;
      font-size: 14px;
      padding: 10px 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #00e5a0; }
    button {
      width: 100%;
      background: #00e5a0;
      color: #000;
      border: none;
      border-radius: 6px;
      font-family: 'Syne', sans-serif;
      font-size: 14px;
      font-weight: 700;
      padding: 11px;
      cursor: pointer;
      transition: filter 0.15s;
    }
    button:hover { filter: brightness(1.1); }
    .error {
      background: rgba(255,77,109,0.1);
      border: 1px solid #ff4d6d;
      border-radius: 6px;
      color: #ff4d6d;
      font-size: 13px;
      padding: 10px 14px;
      display: none;
    }
    .error.show { display: block; }
  </style>
</head>
<body>
  <div class="box">
    <h1>📦 Bot Dashboard</h1>
    <p>Enter your dashboard password to continue.</p>
    <div class="error ${req.query.err ? 'show' : ''}" id="err">Wrong password — try again.</div>
    <form method="POST" action="/login">
      <div style="display:flex;flex-direction:column;gap:12px">
        <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
        <button type="submit">Sign In →</button>
      </div>
    </form>
  </div>
</body>
</html>`);
});

app.post("/login", (req, res) => {
  if (req.body.password === DASHBOARD_KEY) {
    const token = createSession();
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge:   SESSION_TTL,
    });
    return res.redirect("/");
  }
  res.redirect("/login?err=1");
});

app.post("/logout", (req, res) => {
  sessions.delete(req.cookies?.session);
  res.clearCookie("session");
  res.redirect("/login");
});

// ── Protected routes ──────────────────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static("public"));

// ── Status & logs ─────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => res.json(getBotState()));
app.get("/api/logs",   (_req, res) => res.json(getLogs()));

// ── Excel CRUD ────────────────────────────────────────────────────────────────

app.get("/api/rows", (_req, res) => res.json(getRows()));

app.post("/api/rows", (req, res) => {
  const { vehicle_number, isAccepted } = req.body;
  if (!vehicle_number || typeof vehicle_number !== "string" || !vehicle_number.trim())
    return res.status(400).json({ error: "vehicle_number is required and must be a string" });
  if (isAccepted !== undefined && typeof isAccepted !== "boolean")
    return res.status(400).json({ error: "isAccepted must be a boolean" });
  try {
    addRow({ vehicle_number: vehicle_number.trim(), isAccepted: isAccepted ?? false });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function parseIndex(param, res) {
  const index = Number(param);
  if (!Number.isInteger(index) || index < 0) {
    res.status(400).json({ error: "Invalid row index" });
    return null;
  }
  return index;
}

app.patch("/api/rows/:index", (req, res) => {
  const index = parseIndex(req.params.index, res);
  if (index === null) return;
  const allowed = ["vehicle_number", "isAccepted"];
  const fields  = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (!Object.keys(fields).length)
    return res.status(400).json({ error: "No valid fields provided" });
  if (fields.vehicle_number !== undefined && typeof fields.vehicle_number !== "string")
    return res.status(400).json({ error: "vehicle_number must be a string" });
  if (fields.isAccepted !== undefined && typeof fields.isAccepted !== "boolean")
    return res.status(400).json({ error: "isAccepted must be a boolean" });
  try {
    updateRow(index, fields);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/rows/:index", (req, res) => {
  const index = parseIndex(req.params.index, res);
  if (index === null) return;
  try {
    deleteRow(index);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Fallback to index.html (SPA) ─────────────────────────────────────────────

app.get(/.*/, (_req, res) => res.sendFile(process.cwd() + "/public/index.html"));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(3000, () => console.log("🌐 Dashboard → http://localhost:3000"));

console.log("🚀 Starting bot...");
startBot();