// ponytail-config — shared mode vocabulary for ponytail plugins/commands.
const MODES = ['lite', 'full', 'ultra', 'off'];

function getDefaultMode() {
  return 'full';
}

function normalizePersistedMode(mode) {
  if (!mode) return null;
  const normalized = mode.trim().toLowerCase();
  return MODES.includes(normalized) ? normalized : null;
}

module.exports = { getDefaultMode, normalizePersistedMode };
