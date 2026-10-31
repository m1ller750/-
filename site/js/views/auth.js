import * as api from '../api.js';
import { PLATFORM_FEE } from '../config.js';
import { busy, formValues, html, icon, showFieldErrors, toast } from '../ui.js';

const HOME_FOR = { organizer: '/organizer', creator: '/creator', participant: '/tournaments' };
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function safeNext(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

async function afterSignIn({ refreshAuth, navigate }, next, welcome) {
  const profile = await refreshAuth();
  if (!profile) {
    toast('This account has no TurniRUM profile. Please sign up first.', 'error');
    return;
  }
  toast(profile.role === 'creator' ? 'Welcome, platform creator! Your dashboard is ready.' : welcome(profile), 'success');
  navigate(safeNext(next) ?? HOME_FOR[profile.role]);
}

export function loginView(ctx) {
  if (ctx.profile) return { redirect: HOME_FOR[ctx.profile.role] };
  const next = ctx.query.get('next');
  return {
    title: 'Sign in',
    html: html`
      <section class="container auth-wrap">
        <aside class="auth-art auth-art-login">
          <div class="auth-art-inner">
            <span class="eyebrow eyebrow-light">${icon('zap', 14)} Welcome back</span>
            <h1>Standings are waiting<br>for <span class="grad-text">new wins</span></h1>
            <p>Sign in to manage tournaments, follow the standings and register your teams.</p>
            <div class="auth-trophy">${icon('trophy', 120)}</div>
          </div>
          <div class="auth-art-glow"></div>
        </aside>
        <div class="card auth-card">
          <h2>Sign in to TurniRUM</h2>
          <p class="muted">No account yet? <a class="link" href="#/register">Sign up</a></p>
          <form class="form" novalidate data-login>
            <label class="field" data-field="email">
              <span class="label">Email</span>
              <span class="input-icon">${icon('mail', 17)}<input class="input" type="email" name="email" autocomplete="email" placeholder="you@example.com" required autofocus></span>
            </label>
            <label class="field" data-field="password">
              <span class="label">Password</span>
              <span class="input-icon">${icon('lock', 17)}<input class="input" type="password" name="password" autocomplete="current-password" placeholder="••••••••" required></span>
            </label>
            <div class="alert alert-error" data-error hidden></div>
            <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in ${icon('arrow', 18)}</button>
          </form>
        </div>
      </section>`,
    mount(root) {
      const form = root.querySelector('[data-login]');
      const errorBox = root.querySelector('[data-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const errors = {};
        if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Enter your email address.';
        if (!values.password) errors.password = 'Enter your password.';
        showFieldErrors(form, errors);
        errorBox.hidden = true;
        if (Object.keys(errors).length) return;
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            await api.signIn(values.email, values.password);
            await afterSignIn(ctx, next, (p) => `Welcome back, ${p.full_name}!`);
          } catch (error) {
            errorBox.innerHTML = html`${icon('alert', 18)} ${error.message}`.toString();
            errorBox.hidden = false;
          }
        });
      });
    },
  };
}

export function registerView(ctx) {
  if (ctx.profile) return { redirect: HOME_FOR[ctx.profile.role] };
  const role = ctx.query.get('role') === 'organizer' ? 'organizer' : 'participant';
  return {
    title: 'Sign up',
    html: html`
      <section class="container auth-wrap">
        <aside class="auth-art">
          <div class="auth-art-inner">
            <span class="eyebrow eyebrow-light">${icon('sparkles', 14)} Welcome</span>
            <h1>Your road<br>to <span class="grad-text">victory</span><br>starts here</h1>
            <p>One account and you are in the game: host tournaments, or build a team and fight for the prize pool.</p>
            <div class="auth-art-stats">
              <div><b>2 min</b><small>to launch a tournament</small></div>
              <div><b>${PLATFORM_FEE}%</b><small>fee on paid events</small></div>
              <div><b>$0</b><small>for free events</small></div>
            </div>
          </div>
          <div class="auth-art-glow"></div>
        </aside>
        <div class="card auth-card">
          <h2>Create an account</h2>
          <p class="muted">Already registered? <a class="link" href="#/login">Sign in</a></p>
          <form class="form" novalidate data-register>
            <fieldset class="role-picker">
              <legend class="label">I want to</legend>
              <input type="radio" name="role" id="role-organizer" value="organizer" ${role === 'organizer' ? 'checked' : ''}>
              <label for="role-organizer" class="role-option">
                <span class="role-option-icon role-org">${icon('trophy', 22)}</span>
                <span><b>Organize</b><small>Create tournaments, run standings, earn income. TurniRUM keeps 10% of paid entry fees</small></span>
                <span class="role-check">${icon('check', 14)}</span>
              </label>
              <input type="radio" name="role" id="role-participant" value="participant" ${role === 'participant' ? 'checked' : ''}>
              <label for="role-participant" class="role-option">
                <span class="role-option-icon role-player">${icon('swords', 22)}</span>
                <span><b>Compete</b><small>Find tournaments, register a team, win prizes</small></span>
                <span class="role-check">${icon('check', 14)}</span>
              </label>
            </fieldset>
            <div class="form-row">
              <label class="field" data-field="username">
                <span class="label">Username</span>
                <span class="input-icon">${icon('user', 17)}<input class="input" name="username" autocomplete="username" placeholder="nomad_kz" maxlength="32" required></span>
              </label>
              <label class="field" data-field="full_name">
                <span class="label">Name or team name</span>
                <span class="input-icon">${icon('sparkles', 17)}<input class="input" name="full_name" autocomplete="name" placeholder="Alex Carter" maxlength="60" required></span>
              </label>
            </div>
            <label class="field" data-field="email">
              <span class="label">Email</span>
              <span class="input-icon">${icon('mail', 17)}<input class="input" type="email" name="email" autocomplete="email" placeholder="you@example.com" required></span>
            </label>
            <div class="form-row">
              <label class="field" data-field="password">
                <span class="label">Password</span>
                <span class="input-icon">${icon('lock', 17)}<input class="input" type="password" name="password" autocomplete="new-password" placeholder="At least 6 characters" required></span>
              </label>
              <label class="field" data-field="password2">
                <span class="label">Repeat password</span>
                <span class="input-icon">${icon('lock', 17)}<input class="input" type="password" name="password2" autocomplete="new-password" placeholder="One more time" required></span>
              </label>
            </div>
            <div class="alert alert-error" data-error hidden></div>
            <button class="btn btn-primary btn-lg btn-block" type="submit">Create account ${icon('arrow', 18)}</button>
          </form>
        </div>
      </section>`,
    mount(root) {
      const form = root.querySelector('[data-register]');
      const errorBox = root.querySelector('[data-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const v = formValues(form);
        const errors = {};
        if (!USERNAME_RE.test(v.username.trim())) errors.username = 'Use 3–32 characters: letters, digits, “_”, “.” or “-”.';
        if (v.full_name.trim().length < 2) errors.full_name = 'Enter your name or team name (2–60 characters).';
        if (!EMAIL_RE.test(v.email.trim())) errors.email = 'Enter a valid email address.';
        if (v.password.length < 6) errors.password = 'Use at least 6 characters.';
        else if (v.password !== v.password2) errors.password2 = 'Passwords do not match.';
        showFieldErrors(form, errors);
        errorBox.hidden = true;
        if (Object.keys(errors).length) return;
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            await api.register({
              role: v.role, username: v.username.trim(), full_name: v.full_name.trim(), email: v.email.trim(), password: v.password,
            });
            await afterSignIn(ctx, null, (p) => `Account created. Welcome to TurniRUM, ${p.full_name}!`);
          } catch (error) {
            if (error.fields && Object.keys(error.fields).length) showFieldErrors(form, error.fields);
            else {
              errorBox.innerHTML = html`${icon('alert', 18)} ${error.message}`.toString();
              errorBox.hidden = false;
            }
          }
        });
      });
    },
  };
}
