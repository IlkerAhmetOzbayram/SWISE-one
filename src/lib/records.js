// Aktivite, masraf ve rapor modüllerinin ortak sorgu yardımcıları.
// Kayıtlar şirkete bağlıdır; proje isteğe bağlıdır.
const { one } = require('../db');
const { HttpError, bad } = require('./http');
const { date, num } = require('./validate');
const { isAdmin } = require('./auth');

// Tarih/müşteri/şirket/proje/kullanıcı filtresi. Çalışan yalnızca kendi kayıtlarını görür.
function buildFilter(req, alias) {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.from) { where.push(`${alias}.date >= ?`); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push(`${alias}.date <= ?`); params.push(date(q.to, 'Bitiş')); }
  if (q.project_id) { where.push(`${alias}.project_id = ?`); params.push(Number(q.project_id)); }
  if (q.company_id) { where.push(`${alias}.company_id = ?`); params.push(Number(q.company_id)); }
  if (q.customer_id) { where.push('co.customer_id = ?'); params.push(Number(q.customer_id)); }
  if (!isAdmin(req)) { where.push(`${alias}.user_id = ?`); params.push(req.user.id); }
  else if (q.user_id) { where.push(`${alias}.user_id = ?`); params.push(Number(q.user_id)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const JOINS = (alias) => `JOIN companies co ON co.id = ${alias}.company_id
  JOIN customers cu ON cu.id = co.customer_id
  LEFT JOIN projects p ON p.id = ${alias}.project_id
  JOIN users u ON u.id = ${alias}.user_id`;

// Listelerde her kayda eklenen müşteri/şirket/proje adları
const NAMES = `p.name project_name, co.name company_name, cu.id customer_id, cu.name customer_name, u.full_name user_name`;

// Kayıt sahibi veya yönetici değilse erişim yok
function ownRecord(req, table, id) {
  const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  if (!isAdmin(req) && row.user_id !== req.user.id) throw new HttpError(403, 'Bu kayıt size ait değil');
  return row;
}

// Gövdedeki şirket ve (varsa) projeyi doğrular. Pasif şirket/müşteri/projeye yalnızca
// yönetici veya kaydın zaten bağlı olduğu hedef için yazılabilir.
function resolveTarget(req, existing) {
  const b = req.body;
  const companyId = num(b.company_id, 'Müşteri / şirket');
  const projectId = b.project_id ? Number(b.project_id) : null;
  const co = one(`SELECT (co.active AND cu.active) usable FROM companies co JOIN customers cu ON cu.id = co.customer_id
                  WHERE co.id = ?`, companyId);
  if (!co) bad('Şirket bulunamadı');
  let usable = co.usable;
  if (projectId) {
    const p = one('SELECT company_id, active FROM projects WHERE id = ?', projectId);
    if (!p) bad('Proje bulunamadı');
    if (p.company_id !== companyId) bad('Proje seçilen şirkete ait değil');
    usable = usable && p.active;
  }
  const unchanged = existing && existing.company_id === companyId && existing.project_id === projectId;
  if (!usable && !unchanged && !isAdmin(req)) bad('Seçilen müşteri, şirket veya proje pasif');
  return { companyId, projectId };
}

// Yönetici başka bir kullanıcı adına kayıt girebilir; diğerleri her zaman kendi adına
const targetUserId = (req, existing) =>
  (isAdmin(req) && req.body.user_id ? Number(req.body.user_id) : (existing?.user_id ?? req.user.id));

module.exports = { buildFilter, JOINS, NAMES, ownRecord, resolveTarget, targetUserId };
