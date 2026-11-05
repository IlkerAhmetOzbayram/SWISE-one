// Yetki kataloğu. Bir rolün yetkileri { "modül.işlem": değer } biçiminde saklanır.
// Değer: true (izinli) veya kapsam ('own' = yalnızca kendi kayıtları,
// 'assigned' = sorumlusu olduğu müşteriler + kendi kayıtları, 'all' = tümü). Anahtar yoksa izin yok.

const SCOPES = ['own', 'assigned', 'all'];

const CATALOG = [
  { module: 'activities', label: 'Aktivite', actions: { view: SCOPES, edit: ['own', 'all'], approve: true } },
  { module: 'expenses', label: 'Masraf', actions: { view: SCOPES, edit: ['own', 'all'], approve: true } },
  { module: 'customers', label: 'Müşteriler', actions: { view: true, edit: true } },
  { module: 'offers', label: 'Teklifler', actions: { view: SCOPES, edit: ['own', 'all'], approve: true } },
  { module: 'rates', label: 'Ücret ve tutarlar', actions: { view: true } },
  { module: 'reports', label: 'Muhasebe raporu', actions: { view: true } },
  { module: 'effort_report', label: 'Müşteri efor raporu', actions: { view: ['assigned', 'all'] } },
  { module: 'budget', label: 'Bütçe ve plan', actions: { view: true, edit: true } },
  { module: 'personnel', label: 'Personel', actions: { view: true, edit: true } },
  { module: 'salary', label: 'Maaş ve hassas bilgiler', actions: { view: true, edit: true } },
  { module: 'period', label: 'Ay kapanışı', actions: { close: true, reopen: true } },
  { module: 'roles', label: 'Roller ve yetkiler', actions: { edit: true } },
  { module: 'settings', label: 'Ayarlar, tatiller, yedekler', actions: { edit: true } },
  { module: 'audit', label: 'İşlem kaydı', actions: { view: true } },
];

const ACTION_LABELS = { view: 'Görme', edit: 'Ekleme / düzenleme', delete: 'Silme', approve: 'Onaylama', close: 'Kapatma', reopen: 'Yeniden açma' };
const SCOPE_LABELS = { own: 'Kendi', assigned: 'Sorumlu olduğu', all: 'Tümü' };

// Kilitli (Yönetici) rol: katalogdaki her yetkinin en geniş hali
function fullPermissions() {
  const out = {};
  for (const m of CATALOG) {
    for (const [action, spec] of Object.entries(m.actions)) out[`${m.module}.${action}`] = Array.isArray(spec) ? 'all' : true;
  }
  return out;
}

// Gelen yetki nesnesini kataloğa göre temizler; bilinmeyen anahtar/değer atılır
function normalize(input = {}) {
  const out = {};
  for (const m of CATALOG) {
    for (const [action, spec] of Object.entries(m.actions)) {
      const key = `${m.module}.${action}`;
      const v = input[key];
      if (Array.isArray(spec)) { if (spec.includes(v)) out[key] = v; }
      else if (v === true || v === 1 || v === '1') out[key] = true;
    }
  }
  return out;
}

module.exports = { CATALOG, SCOPES, ACTION_LABELS, SCOPE_LABELS, fullPermissions, normalize };
