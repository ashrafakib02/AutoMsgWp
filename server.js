// ─── Express Server ───────────────────────────────────────────────────────────
// Single server entry point. Replaces the old app.js / server.js / dashboard.js split.
// Serves the frontend from /public and exposes REST APIs for the dashboard.

import express from "express";
import { startBot } from "./index.js";
import { getBotState } from "./state.js";
import { getLogs } from "./logger.js";
import { getRows, addRow, updateRow, deleteRow } from "./excelManager.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ── Status & logs ─────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => res.json(getBotState()));
app.get("/api/logs",   (_req, res) => res.json(getLogs()));

// ── Excel CRUD ────────────────────────────────────────────────────────────────

// GET all rows
app.get("/api/rows", (_req, res) => res.json(getRows()));

// POST add a new row  — body: { vehicle_number, isAccepted }
app.post("/api/rows", (req, res) => {
  try {
    addRow(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH update a row by index  — body: partial row fields
app.patch("/api/rows/:index", (req, res) => {
  try {
    updateRow(Number(req.params.index), req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a row by index
app.delete("/api/rows/:index", (req, res) => {
  try {
    deleteRow(Number(req.params.index));
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
