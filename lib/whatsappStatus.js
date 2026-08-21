/**
 * lib/whatsappStatus.js — WhatsApp-Web (wwebjs) connection state.
 *
 * Previously two plain module-level `let`s inside server.js. Pulled out so
 * controllers/systemHealth.js can read the current state without importing
 * server.js itself (server.js already imports FROM systemHealth.js to
 * register its routes — importing back would be circular). Matches the
 * get*Status() convention every other Phase E subsystem already uses.
 */
let status = 'disconnected';
let latestQr = null;

export function getWhatsappStatus() {
  return status;
}

export function setWhatsappStatus(newStatus) {
  status = newStatus;
}

export function getLatestQr() {
  return latestQr;
}

export function setLatestQr(qr) {
  latestQr = qr;
}
