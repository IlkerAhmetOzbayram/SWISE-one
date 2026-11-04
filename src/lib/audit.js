// İşlem kaydı: her ekleme/güncelleme/silme ve giriş olayı audit_log tablosuna yazılır.
// Güncellemelerde yalnızca değişen alanlar [eski, yeni] olarak saklanır.
const { one, run } = require('../db');

const HIDDEN = new Set(['password_hash']);

const clean = (row) => Object.fromEntries(Object.entries(row || {}).filter(([k]) => !HIDDEN.has(k)));
const snapshot = (table, id) => one(`SELECT * FROM ${table} WHERE id = ?`, id);

function changes(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (HIDDEN.has(k)) continue;
    if (before?.[k] !== after[k]) out[k] = [before?.[k] ?? null, after[k]];
  }
  return out;
}

function record(req, action, entity, entityId = null, details = {}, userId) {
  run('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    userId ?? req.user?.id ?? null, action, entity, entityId, JSON.stringify(details), req.ip || '');
}

const logCreate = (req, table, id) => record(req, 'create', table, id, clean(snapshot(table, id)));

function logUpdate(req, table, before) {
  const diff = changes(before, snapshot(table, before.id));
  if (Object.keys(diff).length) record(req, 'update', table, before.id, diff);
}

const logDelete = (req, table, before) => record(req, 'delete', table, before.id, clean(before));

module.exports = { record, logCreate, logUpdate, logDelete, snapshot };
