// ─── Shared Bot State ─────────────────────────────────────────────────────────
// Single source of truth for bot connection state.
// Status values: "starting" | "qr" | "connecting" | "connected" | "reconnecting" | "logged_out"

let botState = {
  status: "starting",
  qr: null,
  connected: false,
  botEnabled: true,
};

export function setBotState(update) {
  botState = { ...botState, ...update };
}

export function getBotState() {
  return botState;
}

export function isBotEnabled() {
  return botState.botEnabled;
}

export function setBotEnabled(val) {
  botState = { ...botState, botEnabled: val };
}
