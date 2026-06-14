// ─── Excel Manager ────────────────────────────────────────────────────────────

import XLSX from "xlsx";
import chokidar from "chokidar";
import fs from "fs";

// ── Active file ───────────────────────────────────────────────────────────────
let FILE = "./vehicle_list.xlsx";

export function setActiveFile(phone) {
  const newFile = `./vehicle_list_${phone}.xlsx`;

  if (!fs.existsSync(newFile)) {
    const workbook = XLSX.utils.book_new();
    const sheet    = XLSX.utils.json_to_sheet([], {
      header: ["vehicle_number", "isAccepted", "Priority", "Remarks"]
    });
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, newFile);
    console.log(`✅ Created new Excel file: ${newFile}`);
  } else {
    console.log(`✅ Using existing Excel file: ${newFile}`);
  }

  FILE = newFile;
  _attachWatcher();
  loadRows();
}

export function getActiveFile() {
  return FILE;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

let rows = [];
let nextVehicleIndex = null;

// ── Pre-compute next vehicle ──────────────────────────────────────────────────
// FIX (priority): fall back to Infinity so rows with missing Priority sort last,
// not first (Number(undefined)||0 made them all priority-0 and sort was random).

function refreshNextVehicle() {
  const available = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const val = r.isAccepted;
      // Cover boolean false AND string "FALSE" / "false" from Excel re-reads
      return val === false || val === 0 || String(val).trim().toUpperCase() === "FALSE";
    })
    .sort((a, b) => {
      const pa = Number(a.r.Priority) || Infinity;
      const pb = Number(b.r.Priority) || Infinity;
      return pa - pb;
    });

  nextVehicleIndex = available.length ? available[0].i : null;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadRows() {
  try {
    const workbook = XLSX.readFile(FILE);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // defval:"" keeps empty cells from disappearing; raw:false converts types safely
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
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
// FIX (watcher loop): suppress the watcher while we are writing so our own
// write does not trigger a reload that clobbers in-memory state.

let _writePending = false;
let _suppressWatcher = false;

function _scheduleWrite() {
  if (_writePending) return;
  _writePending = true;
  setImmediate(() => {
    _writePending = false;
    _suppressWatcher = true;           // ← tell watcher to ignore next event
    try {
      // FIX: Build workbook directly from in-memory rows instead of re-reading
      // the file from disk. This avoids a cold disk read on every write and
      // eliminates a race condition where a stale file could overwrite newer
      // in-memory state if two writes were queued close together.
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows, {
        header: ["vehicle_number", "isAccepted", "Priority", "Remarks"]
      });
      XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
      XLSX.writeFile(workbook, FILE);
    } catch (err) {
      console.error("❌ Failed to write Excel:", err.message);
    } finally {
      // Un-suppress after a short delay (longer than chokidar debounce)
      setTimeout(() => { _suppressWatcher = false; }, 600);
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

  // Mark accepted in memory immediately (no disk round-trip before reply)
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
    // FIX (watcher loop): ignore changes we wrote ourselves
    if (_suppressWatcher) return;
    clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(() => {
      console.log(`🔄 ${FILE} changed on disk — reloading...`);
      loadRows();
    }, 300);
  });
}

// NOTE: _attachWatcher() and loadRows() are intentionally NOT called here.
// setActiveFile() is the sole entry point — it attaches the watcher and loads
// rows once the real per-phone file is known (after "connection open").
// This avoids a double cold-read on first link and keeps rows consistent.