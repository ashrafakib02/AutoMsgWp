// ─── In-memory Event Logger ───────────────────────────────────────────────────
// Keeps the last 100 log entries in memory. No persistence between restarts.

const logs = [];

// messageTime: ISO timestamp of when the incoming WhatsApp message arrived
// time:        ISO timestamp of when the vehicle was dispatched
export function logEvent(data) {
  logs.push({ time: new Date().toISOString(), ...data });
  if (logs.length > 100) logs.shift();
}

export function getLogs() {
  return [...logs].reverse(); // newest first
}