// App shell: session, navigation by role and a small hash router.
import * as api from './api.js';
import { ROLE_LABELS } from './roles.js';
import { avatar, html, icon, loader, messagePage, notFound, toast } from './ui.js';
import { loginView, registerView } from './views/auth.js';
import { creatorDashboardView, creatorPaymentsView, creatorTournamentsView, creatorUsersView } from './views/creator.js';
import { catalogView } from './views/catalog.js';
import { notificationsView } from './views/notifications.js';
import { bracketPageView, teamFinderView } from './views/play.js';
import { guideView } from './views/guide.js';
import { homeView } from './views/home.js';
import { businessView, manageView, tournamentFormView } from './views/organizer.js';
import { tablesView } from './views/player.js';
import { joinView, tournamentView } from './views/tournament.js';
import { walletView } from './views/wallet.js';


const ROUTES = [
  ['/', homeView],
  ['/tournaments', catalogView],
  ['/guide', guideView],
  ['/t/:id', tournamentView],
  ['/t/:id/join', joinView],
  ['/login', loginView],
  ['/register', registerView],
  ['/organizer', manageView, ['organizer']],
  ['/organizer/new', tournamentFormView, ['organizer']],
  ['/organizer/t/:id/edit', tournamentFormView, ['organizer']],
  ['/organizer/business', businessView, ['organizer']],
  ['/wallet', walletView, ['organizer', 'creator']],
  ['/player', tablesView, ['participant']],
  ['/bracket', bracketPageView, ['participant']],
  ['/team-finder', teamFinderView, ['participant']],
  ['/notifications', notificationsView, ['organizer', 'participant', 'creator']],
  ['/creator', creatorDashboardView, ['creator']],
  ['/creator/tournaments', creatorTournamentsView, ['creator']],
  ['/creator/payments', creatorPaymentsView, ['creator']],
  ['/creator/users', creatorUsersView, ['creator']],
].map(([pattern, view, roles]) => {
  const names = [];
  const source = pattern.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; });
  return { regex: new RegExp(`^${source}/?$`), names, view, roles };
});

const NAV = {
  all: [['/tournaments', 'search', 'Tournaments', ['/tournaments', '/t/']]],
  last: [['/guide', 'book', 'Guide', ['/guide']]],
  organizer: [
    ['/organizer/new', 'plus', 'Create tournament', ['/organizer/new']],
    ['/organizer', 'table', 'My tournaments', ['/organizer', '/organizer/t/']],
    ['/organizer/business', 'pie', 'Business model', ['/organizer/business']],
    ['/wallet', 'wallet', 'Wallet', ['/wallet']],
  ],
  participant: [
    ['/player', 'table', 'My tables', ['/player']],
    ['/bracket', 'swords', 'Bracket', ['/bracket']],
    ['/team-finder', 'users', 'Find a team', ['/team-finder']],
  ],
  creator: [
    ['/creator', 'pie', 'Business model', ['/creator']],
    ['/creator/tournaments', 'shield', 'Manage', ['/creator/tournaments']],
    ['/wallet', 'wallet', 'Wallet', ['/wallet']],
    ['/creator/payments', 'receipt', 'Payments', ['/creator/payments']],
    ['/creator/users', 'users', 'Users', ['/creator/users']],
  ],
};

const state = { profile: null };
const app = document.getElementById('app');
let renderToken = 0;
let lastPath = null;

// ---------------------------------------------------------------- routing --

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = hash.split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

export function navigate(target, { replace = false } = {}) {
  const hash = target.startsWith('#') ? target : `#${target}`;
  if (replace || location.hash === hash) {
    history.replaceState(null, '', hash);
    render();
  } else {
    location.hash = hash;
  }
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const m = path.match(route.regex);
    if (m) {
      const params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
      return { ...route, params };
    }
  }
  return null;
}

async function render() {
  const token = ++renderToken;
  const { path, query } = parseHash();
  const match = matchRoute(path);
  closeMobileNav();
  renderNav(path);
  if (path !== lastPath) {
    window.scrollTo({ top: 0 });
    lastPath = path;
  }
  const loaderTimer = setTimeout(() => {
    if (token === renderToken) app.innerHTML = loader().toString();
  }, 120);

  let result;
  try {
    if (!match) {
      result = notFound();
    } else if (match.roles && !state.profile) {
      clearTimeout(loaderTimer);
      const next = encodeURIComponent(path + (query.toString() ? `?${query}` : ''));
      toast('Please sign in to continue.', 'info');
      navigate(`/login?next=${next}`, { replace: true });
      return;
    } else if (match.roles && !match.roles.includes(state.profile.role)) {
      result = messagePage(403, 'No access', 'This page is available to a different account type.');
    } else {
      result = await match.view({
        params: match.params, query, profile: state.profile, navigate, reload: render, refreshAuth,
      });
    }
  } catch (error) {
    console.error(error);
    result = messagePage('Oops', 'Something went wrong', error?.message || 'Please refresh the page and try again.');
  }
  clearTimeout(loaderTimer);
  if (token !== renderToken) return;
  if (result.redirect) {
    navigate(result.redirect, { replace: true });
    return;
  }
  document.title = `${result.title} · TurniRUM`;
  app.innerHTML = result.html.toString();
  result.mount?.(app);
  animate(app);
}

// ------------------------------------------------------------------- auth --

export async function refreshAuth() {
  const userId = await api.currentUserId();
  state.profile = userId ? await api.fetchProfile(userId) : null;
  if (userId && !state.profile) await api.signOut(); // account without a TurniRUM profile
  renderNav(parseHash().path);
  return state.profile;
}

async function logout() {
  await api.signOut();
  state.profile = null;
  toast('You have signed out.', 'info');
  navigate('/');
}

// ------------------------------------------------------------------- nav --

function isActive(path, prefixes) {
  return prefixes.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

function renderNav(path) {
  const role = state.profile?.role;
  const links = [...NAV.all, ...(NAV[role] ?? []), ...NAV.last];
  document.querySelector('[data-nav-links]').innerHTML = links.map(([href, ic, label, prefixes]) => html`
    <a href="#${href}" class="nav-link ${isActive(path, prefixes) ? 'active' : ''}">${icon(ic, 16)} ${label}</a>`).join('');

  const user = state.profile;
  document.querySelector('[data-nav-user]').innerHTML = (user
    ? html`
      <div class="user-chip">
        ${avatar(user.full_name, user.username)}
        <span class="user-meta">
          <b>${user.full_name}</b>
          <small class="role-tag role-${user.role}">${user.role === 'creator' ? icon('crown', 12) : ''}${ROLE_LABELS[user.role]}</small>
        </span>
      </div>
      <a class="icon-btn bell" href="#/notifications" title="Notifications" aria-label="Notifications">${icon('bell', 18)}<span class="bell-count" data-bell-count hidden></span></a>
      <button class="icon-btn" type="button" data-logout title="Sign out" aria-label="Sign out">${icon('logout', 18)}</button>`
    : html`
      <a class="btn btn-ghost btn-sm" href="#/login">${icon('login', 16)} Sign in</a>
      <a class="btn btn-primary btn-sm" href="#/register">Sign up</a>`).toString();
  document.querySelector('[data-logout]')?.addEventListener('click', logout);
  if (user) updateBell();
}

// Unread notifications in the bell.
async function updateBell() {
  try {
    const count = await api.unreadCount();
    const badge = document.querySelector('[data-bell-count]');
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count > 9 ? '9+' : String(count);
  } catch (error) {
    console.warn('notifications', error);
  }
}
window.addEventListener('turnirum:notifications', updateBell);

function closeMobileNav() {
  document.querySelector('[data-nav]')?.classList.remove('is-open');
  document.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
}

// ------------------------------------------------------------- animation --

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' })
  : null;

function animate(root) {
  root.querySelectorAll('.reveal').forEach((el, i) => {
    if (!revealObserver) return el.classList.add('in');
    el.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`;
    revealObserver.observe(el);
  });
  if (reducedMotion) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target <= 0) return;
    const format = el.dataset.format === 'money'
      ? (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
      : (n) => new Intl.NumberFormat('en-US').format(n);
    const final = el.textContent;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 1100);
      el.textContent = p < 1 ? format(Math.round(target * (1 - (1 - p) ** 3))) : final;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ------------------------------------------------------------------ boot --

document.querySelector('[data-nav-toggle]')?.addEventListener('click', (event) => {
  const panel = document.querySelector('[data-nav]');
  const open = panel.classList.toggle('is-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

api.onAuthChange((event) => {
  // Keeps the UI in sync when the session ends in another tab or expires.
  if (event === 'SIGNED_OUT' && state.profile) {
    state.profile = null;
    render();
  }
});

// A field's error disappears as soon as the user starts fixing it.
document.addEventListener('input', (event) => {
  const field = event.target.closest?.('[data-field].has-error');
  if (!field) return;
  field.classList.remove('has-error');
  field.querySelector('.field-error')?.remove();
});

window.addEventListener('hashchange', render);

(async () => {
  try {
    await refreshAuth();
  } catch (error) {
    console.error(error);
  }
  render();
})();
