// Uygulama girişi: oturum kontrolü, yetkiye göre menü ve sayfa yönlendirme
import { state, can, $, api, esc, loadRefs } from './core.js';
import { showLogin, showSetup, showSetupCommand, showPasswordLink } from './pages/auth.js';
import { pageActivities } from './pages/activities.js';
import { pageExpenses } from './pages/expenses.js';
import { pageReport } from './pages/report.js';
import { pageCustomers } from './pages/customers.js';
import { pagePersonnel } from './pages/personnel.js';
import { pageRoles } from './pages/roles.js';
import { pageApprovals } from './pages/approvals.js';
import { pageSettings } from './pages/settings.js';
import { pageAudit } from './pages/audit.js';
import { pageHome } from './pages/home.js';
import { pageEffort } from './pages/effort.js';
import { pageBudget } from './pages/budget.js';
import { pageOffers } from './pages/offers.js';
import { pageAccounting } from './pages/accounting.js';

// perm: menüde görünme ve erişim koşulu; allow: parametreli erişim (örn. kişinin kendi personel kartı)
const ROUTES = [
  { id: 'ana-sayfa', title: 'Ana Sayfa', render: pageHome },
  { id: 'aktiviteler', title: 'Aktivite Giriş', perm: () => can('activities.edit'), render: pageActivities },
  { id: 'efor', title: 'Aktivite Listesi', perm: () => can('activities.view'), render: pageEffort },
  { id: 'masraflar', title: 'Masraflar', perm: () => can('expenses.view'), render: pageExpenses },
  { id: 'teklifler', title: 'Teklifler', perm: () => can('offers.view'), render: pageOffers },
  { id: 'onaylar', title: 'Onaylar', perm: () => can('activities.approve') || can('expenses.approve') || can('offers.approve') || can('period.close') || can('period.reopen'), render: pageApprovals },
  { id: 'rapor', title: 'Raporlar', perm: () => can('reports.view') || can('effort_report.view'), render: pageReport },
  { id: 'muhasebe', title: 'Muhasebe', perm: () => can('accounting.view') || can('salary.view'), render: pageAccounting },
  { id: 'butce', title: 'Bütçe', perm: () => can('budget.view'), render: pageBudget },
  { id: 'musteriler', title: 'Müşteriler', perm: () => can('customers.view'), render: pageCustomers },
  { id: 'personel', title: 'Personel', perm: () => can('personnel.view'), allow: (p) => Number(p) === state.user.id, render: pagePersonnel },
  { id: 'roller', title: 'Roller', nav: false, perm: () => can('roles.edit'), render: pageRoles },
  { id: 'islem-kaydi', title: 'İşlem Kaydı', perm: () => can('audit.view'), render: pageAudit },
  { id: 'ayarlar', title: 'Ayarlar', render: pageSettings },
];

const permitted = (r, param) => !r.perm || r.perm() || (r.allow && r.allow(param));

function route() {
  if (!state.user) return;
  // #/sayfa veya #/sayfa/parametre (örn. #/musteriler/3)
  const [id, param, sub] = location.hash.replace(/^#\/?/, '').split('/');
  const target = ROUTES.find((r) => r.id === id);
  const current = target && permitted(target, param) ? target : ROUTES[0];
  const navActive = current.id === 'roller' ? 'personel' : current.id;
  $('#nav').innerHTML = ROUTES.filter((r) => r.nav !== false && (!r.perm || r.perm()))
    .map((r) => `<a href="#/${r.id}" class="${r.id === navActive ? 'active' : ''}">${r.title}</a>`).join('');
  document.title = `${current.title} · SWISE One`;
  current.render(current === target ? param : undefined, current === target ? sub : undefined);
}

async function boot() {
  // Davet / parola sıfırlama bağlantısı oturumdan bağımsız açılır
  const link = location.hash.match(/^#\/parola\/([A-Za-z0-9_-]+)$/);
  if (link) {
    state.user = null;
    return showPasswordLink(link[1], boot);
  }
  try {
    state.user = await api('GET', '/api/me');
  } catch {
    state.user = null;
    const { needsSetup, webSetup } = await api('GET', '/api/setup');
    if (needsSetup) return webSetup ? showSetup(boot) : showSetupCommand();
    return showLogin(boot);
  }
  await loadRefs();
  $('#topbar').hidden = false;
  $('#meName').innerHTML = `<a href="#/personel/${state.user.id}" class="me-link">${esc(state.user.full_name)}</a> · ${esc(state.user.role_name || '')}`;
  // Girişsiz geliştirme modunda çıkış anlamsız; uyarı gösterilir
  $('#logoutBtn').hidden = !!state.user.no_login;
  $('#devBanner').hidden = !state.user.no_login;
  route();
}

window.addEventListener('hashchange', () => (location.hash.startsWith('#/parola/') ? boot() : route()));
$('#logoutBtn').onclick = async () => {
  await api('POST', '/api/logout');
  state.user = null;
  location.hash = '';
  boot();
};
boot();
