// ─── Excel Manager ────────────────────────────────────────────────────────────
// Single module for all answers.xlsx operations.
// Replaces the old excel.js + excelManager.js split.

import XLSX from "xlsx";
import chokidar from "chokidar";

const FILE = "./vehicle_list.xlsx";

// In-memory cache of rows
let rows = [];

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadRows() {
  try {
    const workbook = XLSX.readFile(FILE);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`✅ Excel loaded: ${rows.length} rows`);
  } catch (err) {
    console.error("❌ Failed to load Excel:", err.message);
    rows = [];
  }
  return rows;
}

export function getRows() {
  return rows;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function addRow(row) {
  const workbook = XLSX.readFile(FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  data.push(row);
  workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(data);
  XLSX.writeFile(workbook, FILE);
  loadRows(); // refresh cache
}

export function updateRow(index, updatedRow) {
  const workbook = XLSX.readFile(FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  if (index < 0 || index >= data.length) throw new Error("Row index out of bounds");
  data[index] = { ...data[index], ...updatedRow };
  workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(data);
  XLSX.writeFile(workbook, FILE);
  loadRows(); // refresh cache
}

export function deleteRow(index) {
  const workbook = XLSX.readFile(FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  if (index < 0 || index >= data.length) throw new Error("Row index out of bounds");
  data.splice(index, 1);
  workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(data);
  XLSX.writeFile(workbook, FILE);
  loadRows(); // refresh cache
}

// ── Bot helper ────────────────────────────────────────────────────────────────

export function getFirstAvailableVehicle() {
  const row = rows.find((r) => {
    const val = r.isAccepted;
    return val === false || String(val).trim().toUpperCase() === "FALSE";
  });
  return row ? String(row.vehicle_number) : null;
}

// ── Hot-reload watcher ────────────────────────────────────────────────────────
// Auto-reloads the cache if the file changes on disk (e.g. manual edit).

chokidar.watch(FILE).on("change", () => {
  console.log("🔄 answers.xlsx changed on disk — reloading...");
  loadRows();
});

// Initial load on import
loadRows();
