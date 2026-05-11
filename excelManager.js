// ─── Excel Manager ────────────────────────────────────────────────────────────

import XLSX from "xlsx";
import chokidar from "chokidar";
import fs from "fs";

// ── Active file ───────────────────────────────────────────────────────────────
// Set dynamically after WhatsApp login based on the connected phone number.
// Falls back to vehicle_list.xlsx until a phone number is known.

let FILE = "./vehicle_list.xlsx";

export function setActiveFile(phone) {
  const newFile = `./vehicle_list_${phone}.xlsx`;

  // Create file with headers if it doesn't exist
  if (!fs.existsSync(newFile)) {
    const workbook = XLSX.utils.book_new();
    const sheet    = XLSX.utils.json_to_sheet([], {
      header: ["vehicle_number", "isAccepted", "Priority"]
    });
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, newFile);
    console.log(`✅ Created new Excel file: ${newFile}`);
  } else {
    console.log(`✅ Using existing Excel file: ${newFile}`);
  }

  FILE = newFile;

  // Re-attach file watcher to new file
  _attachWatcher();

  // Load the new file into cache
  loadRows();
}

export function getActiveFile() {
  return FILE;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

let rows = [];
let nextVehicleIndex = null;

// ── Pre-compute next vehicle ──────────────────────────────────────────────────

function refreshNextVehicle() {
  const available = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const val = r.isAccepted;
      return val === false || String(val).trim().toUpperCase() === "FALSE";
    })
    .sort((a, b) => (Number(a.r.Priority) || 0) - (Number(b.r.Priority) || 0));

  nextVehicleIndex = available.length ? available[0].i : null;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadRows() {
  try {
    const workbook = XLSX.readFile(FILE);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`✅ Excel loaded: ${rows.length} rows from ${FILE}`);
  } catch (err) {
    console.error("❌ Failed to load Excel:", err.message);
    rows = [];
  }
  refreshNextVehicle();
  return rows;
}

export function getRows() {
  return rows;
}

// ── Background disk writer ────────────────────────────────────────────────────

let _writePending = false;

function _scheduleWrite() {
  if (_writePending) return;
  _writePending = true;
  setImmediate(() => {
    _writePending = false;
    try {
      const workbook  = XLSX.readFile(FILE);
      const sheetName = workbook.SheetNames[0];
      workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(rows);
      XLSX.writeFile(workbook, FILE);
    } catch (err) {
      console.error("❌ Failed to write Excel:", err.message);
    }
  });
}

// ── Write operations ──────────────────────────────────────────────────────────

export function addRow(row) {
  rows.push(row);
  refreshNextVehicle();
  _scheduleWrite();
}

export function updateRow(index, updatedRow) {
  if (index < 0 || index >= rows.length) throw new Error("Row index out of bounds");
  rows[index] = { ...rows[index], ...updatedRow };
  refreshNextVehicle();
  _scheduleWrite();
}

export function deleteRow(index) {
  if (index < 0 || index >= rows.length) throw new Error("Row index out of bounds");
  rows.splice(index, 1);
  refreshNextVehicle();
  _scheduleWrite();
}

// ── Bot dispatch ──────────────────────────────────────────────────────────────

export function getFirstAvailableVehicle() {
  if (nextVehicleIndex === null) return null;

  const index   = nextVehicleIndex;
  const vehicle = String(rows[index].vehicle_number);

  updateRow(index, { isAccepted: true });

  return vehicle;
}

// ── File watcher ──────────────────────────────────────────────────────────────

let _watcher     = null;
let _reloadTimer = null;

function _attachWatcher() {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
  _watcher = chokidar.watch(FILE).on("change", () => {
    clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(() => {
      console.log(`🔄 ${FILE} changed on disk — reloading...`);
      loadRows();
    }, 300);
  });
}

// Initial setup
_attachWatcher();
loadRows();