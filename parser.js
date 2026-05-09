// ─── Message Parser ───────────────────────────────────────────────────────────

// Returns true if a WhatsApp message looks like a delivery request.
// Uses a simple keyword-score approach — adjust THRESHOLD to tune strictness.
const KEYWORDS = ["date", "dealer", "code", "id", "bag", "pcc", "zone", "delivery", "detail"];
const THRESHOLD = 3;

export function isDeliveryMessage(text = "") {
  const t = text.toLowerCase();
  const score = KEYWORDS.reduce((acc, kw) => acc + (t.includes(kw) ? 1 : 0), 0);
  return score >= THRESHOLD;
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function extractAfterColon(line) {
  const idx = line.indexOf(":");
  return idx === -1 ? "" : line.slice(idx + 1).replace(/\*/g, "").trim();
}

function extractField(lines, patterns) {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (patterns.some((p) => p.test(lower))) return extractAfterColon(line);
  }
  return "";
}

function extractZone(lines) {
  for (const line of lines) {
    const match = line.toLowerCase().replace(/\*/g, "").match(/zone[\s\-:]+(\d+)/);
    if (match) return match[1];
  }
  return "";
}

// ── Full parser ───────────────────────────────────────────────────────────────

export function parseMessage(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    dealer:     extractField(lines, [/dealer\s*:/]).toLowerCase(),
    zone:       extractZone(lines),
    retailCode: extractField(lines, [/retail\s*code\s*:/]),
    quantity:   extractField(lines, [/qu?antity\s*:/]),
  };
}
