// Uygulama girişi: oturum kontrolü, menü ve sayfa yönlendirme
import { state, isAdmin, $, api, loadRefs } from './core.js';
import { showLogin, showSetup } from './pages/auth.js';
import { pageActivities } from './pages/activities.js';
import { pageExpenses } from './pages/expenses.js';
import { pageReport } from './pages/report.js';
import { pageCustomers } from './pages/customers.js';
import { pageUsers } from './pages/users.js';
import { pageSettings } from './pages/settings.js';
import { pageAudit } from './pages/audit.js';
import { pageHome } from './pages/home.js';
import { pageEffort } from './pages/effort.js';
import { pageBudget } from './pages/budget.js';

const ROUTES = [
  { id: 'ana-sayfa', title: 'Ana Sayfa', render: pageHome },
  { id: 'aktiviteler', title: 'Aktivite Giriş', render: pageActivities },
  { id: 'efor', title: 'Aktivite Listesi', render: pageEffort },
  { id: 'masraflar', title: 'Masraflar', render: pageExpenses },
  { id: 'rapor', title: 'Raporlar', admin: true, render: pageReport },
  { id: 'butce', title: 'Bütçe', admin: true, render: pageBudget },
  { id: 'musteriler', title: 'Müşteriler', admin: true, render: pageCustomers },
  { id: 'kullanicilar', title: 'Kullanıcılar', admin: true, render: pageUsers },
  { id: 'islem-kaydi', title: 'İşlem Kaydı', admin: true, render: pageAudit },
  { id: 'ayarlar', title: 'Ayarlar', render: pageSettings },
];

function route() {
  if (!state.user) return;
  const visible = ROUTES.filter((r) => !r.admin || isAdmin());
  // #/sayfa veya #/sayfa/parametre (örn. #/musteriler/3)
  const [id, param] = location.hash.replace(/^#\/?/, '').split('/');
  const current = visible.find((r) => r.id === id) || visible[0];
  $('#nav').innerHTML = visible.map((r) => `<a href="#/${r.id}" class="${r === current ? 'active' : ''}">${r.title}</a>`).join('');
  document.title = `${current.title} · SWISE One`;
  current.render(param);
}

async function boot() {
  try {
    state.user = await api('GET', '/api/me');
  } catch {
    state.user = null;
    const { needsSetup } = await api('GET', '/api/setup');
    return needsSetup ? showSetup(boot) : showLogin(boot);
  }
  await loadRefs();
  $('#topbar').hidden = false;
  $('#meName').textContent = `${state.user.full_name}${isAdmin() ? ' · Yönetici' : ''}`;
  // Girişsiz geliştirme modunda çıkış anlamsız; uyarı gösterilir
  $('#logoutBtn').hidden = !!state.user.no_login;
  $('#devBanner').hidden = !state.user.no_login;
  route();
}

window.addEventListener('hashchange', route);
$('#logoutBtn').onclick = async () => {
  await api('POST', '/api/logout');
  state.user = null;
  location.hash = '';
  boot();
};
boot();
