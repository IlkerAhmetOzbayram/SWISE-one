// Aktivite, masraf ve rapor modüllerinin ortak sorgu yardımcıları
const { one } = require('../db');
const { HttpError, bad } = require('./http');
const { date } = require('./validate');
const { isAdmin } = require('./auth');

// Tarih/müşteri/proje/kullanıcı filtresi. Çalışan yalnızca kendi kayıtlarını görür.
function buildFilter(req, alias) {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.from) { where.push(`${alias}.date >= ?`); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push(`${alias}.date <= ?`); params.push(date(q.to, 'Bitiş')); }
  if (q.project_id) { where.push(`${alias}.project_id = ?`); params.push(Number(q.project_id)); }
  if (q.client_id) { where.push('p.client_id = ?'); params.push(Number(q.client_id)); }
  if (!isAdmin(req)) { where.push(`${alias}.user_id = ?`); params.push(req.user.id); }
  else if (q.user_id) { where.push(`${alias}.user_id = ?`); params.push(Number(q.user_id)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const JOINS = (alias) => `JOIN projects p ON p.id = ${alias}.project_id
  JOIN clients c ON c.id = p.client_id JOIN users u ON u.id = ${alias}.user_id`;

// Kayıt sahibi veya yönetici değilse erişim yok
function ownRecord(req, table, id) {
  const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  if (!isAdmin(req) && row.user_id !== req.user.id) throw new HttpError(403, 'Bu kayıt size ait değil');
  return row;
}

function checkProject(req, projectId, existingProjectId) {
  const p = one('SELECT active FROM projects WHERE id = ?', projectId);
  if (!p) bad('Proje bulunamadı');
  if (!p.active && projectId !== existingProjectId && !isAdmin(req)) bad('Bu proje pasif');
}

// Yönetici başka bir kullanıcı adına kayıt girebilir
const targetUserId = (req, existing) =>
  (isAdmin(req) && req.body.user_id ? Number(req.body.user_id) : (existing?.user_id ?? req.user.id));

module.exports = { buildFilter, JOINS, ownRecord, checkProject, targetUserId };
