/* ТурниРУМ — интерактивность интерфейса */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const storage = {
    get(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window.sessionStorage.setItem(key, value); } catch (e) { /* приватный режим */ } },
    remove(key) { try { window.sessionStorage.removeItem(key); } catch (e) { /* приватный режим */ } },
  };

  const formatNumber = (n) => Math.round(n).toLocaleString('ru-RU');
  const money = (n, currency) => formatNumber(n) + ' ' + (currency || '₸');

  // Та же формула, что и на сервере (finance.split_revenue).
  function splitRevenue(total, prizePercent, platformPercent) {
    total = Math.max(0, Math.floor(total) || 0);
    platformPercent = Math.min(100, Math.max(0, platformPercent));
    prizePercent = Math.min(100 - platformPercent, Math.max(0, prizePercent));
    const part = (p) => Math.floor((total * p + 50) / 100);
    const platform = part(platformPercent);
    const prize = part(prizePercent);
    return {
      total, prize, platform, organizer: total - platform - prize,
      prizePercent, platformPercent, organizerPercent: 100 - platformPercent - prizePercent,
    };
  }

  /* ---------------------------------------------------------- меню ---- */
  const navToggle = $('[data-nav-toggle]');
  const navPanel = $('[data-nav]');
  if (navToggle && navPanel) {
    navToggle.addEventListener('click', () => {
      const open = navPanel.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* -------------------------------------------------------- тосты ---- */
  function dismissToast(toast) {
    if (!toast || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 350);
  }
  $$('[data-toast]').forEach((toast, i) => {
    $('[data-toast-close]', toast)?.addEventListener('click', () => dismissToast(toast));
    setTimeout(() => dismissToast(toast), 5200 + i * 600);
  });

  /* ---------------------------------------------- появление при скролле */
  const revealables = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    revealables.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms';
      io.observe(el);
    });
  } else {
    revealables.forEach((el) => el.classList.add('in'));
  }

  /* ---------------------------------------------------- счётчики ----- */
  function countUp(el) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target <= 0) return;
    const suffix = el.dataset.suffix || '';
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNumber(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $$('[data-count]').forEach(countUp);
  }

  /* ------------------------------------------- подтверждение удаления */
  const modal = $('#confirm-modal');
  $$('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (form.dataset.confirmed === '1' || !modal || typeof modal.showModal !== 'function') {
        if (!modal || typeof modal.showModal !== 'function') {
          if (!window.confirm(form.dataset.confirm)) event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      $('[data-confirm-title]', modal).textContent = form.dataset.confirmTitle || 'Вы уверены?';
      $('[data-confirm-text]', modal).textContent = form.dataset.confirm;
      $('[data-confirm-ok]', modal).textContent = form.dataset.confirmOk || 'Удалить';
      modal.returnValue = '';
      modal.showModal();
      modal.addEventListener('close', function onClose() {
        modal.removeEventListener('close', onClose);
        if (modal.returnValue === 'ok') {
          form.dataset.confirmed = '1';
          form.submit();
        }
      });
    });
  });

  /* ------------------------------------------------ фильтры каталога */
  const filterForm = $('form[data-autosubmit]');
  if (filterForm) {
    const range = $('[data-range]', filterForm);
    const rangeOut = $('[data-range-out]', filterForm);
    const search = $('[data-search]', filterForm);
    let timer = null;

    const submit = () => {
      if (range && Number(range.value) >= Number(range.max)) range.disabled = true;
      filterForm.submit();
    };

    filterForm.addEventListener('change', (event) => {
      if (event.target === search) return;
      submit();
    });
    if (range && rangeOut) {
      range.addEventListener('input', () => {
        rangeOut.textContent = money(range.value, range.dataset.currency);
      });
    }
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { storage.set('turnirum-refocus', '1'); submit(); }, 650);
      });
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); submit(); }
      });
      if (storage.get('turnirum-refocus')) {
        storage.remove('turnirum-refocus');
        search.focus();
        const len = search.value.length;
        search.setSelectionRange(len, len);
      }
    }
  }

  /* ---------------------------------------------- вкладки в таблицах */
  $$('[data-tabs]').forEach((box) => {
    const tabs = $$('[data-tab]', box);
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('is-on', t === tab));
      $$('[data-tab-panel]', box).forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== tab.dataset.tab;
      });
    }));
  });

  /* ------------------------------------------- копирование номера карты */
  $$('[data-copy]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(el.dataset.copy).then(() => {
        el.classList.add('is-copied');
        setTimeout(() => el.classList.remove('is-copied'), 1800);
      }).catch(() => {});
    });
  });

  /* ---------------------------------------------- шкала призового фонда */
  function paintRange(range) {
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 100;
    range.style.setProperty('--fill', ((range.value - min) * 100 / (max - min)) + '%');
  }

  /* ---------------------------------------------- калькулятор распределения */
  function bindSplit(root, getTotal) {
    const platformPercent = Number(root.dataset.platform) || 10;
    const currency = root.dataset.currency;
    const prizeRange = $('[data-prize-range]', root);
    const prizeOut = $('[data-prize-out]', root);

    function update() {
      const prize = prizeRange ? Number(prizeRange.value) : 60;
      if (prizeOut) prizeOut.textContent = prize;
      if (prizeRange) paintRange(prizeRange);
      const s = splitRevenue(getTotal(), prize, platformPercent);
      const values = { total: s.total, prize: s.prize, organizer: s.organizer, platform: s.platform };
      const pct = { prize: s.prizePercent, organizer: s.organizerPercent, platform: s.platformPercent };
      Object.entries(values).forEach(([key, value]) => {
        $$(`[data-out="${key}"]`, root).forEach((el) => { el.textContent = money(value, currency); });
      });
      Object.entries(pct).forEach(([key, value]) => {
        $$(`[data-pct="${key}"]`, root).forEach((el) => { el.textContent = value + '%'; });
        $$(`[data-seg="${key}"]`, root).forEach((el) => { el.style.flexGrow = Math.max(value, 0.001); });
      });
    }
    root.addEventListener('input', update);
    root.addEventListener('change', update);
    update();
  }

  const calc = $('[data-calc]');
  if (calc) {
    const fee = $('[data-calc-fee]', calc);
    const teams = $('[data-calc-teams]', calc);
    bindSplit(calc, () => (Number(fee.value) || 0) * (Number(teams.value) || 0));
  }

  /* ---------------------------------------------------- форма турнира */
  const tForm = $('[data-tournament-form]');
  if (tForm) {
    const currency = tForm.dataset.currency;
    let gameStyles = {};
    try { gameStyles = JSON.parse($('#game-styles').textContent); } catch (e) { gameStyles = {}; }
    const styleIndex = {};
    Object.entries(gameStyles).forEach(([name, st]) => { styleIndex[name.toLowerCase()] = st; });

    const titleInput = $('[data-preview="title"]', tForm);
    const gameInput = $('[data-preview="game"]', tForm);
    const fee = $('[data-calc-fee]', tForm);
    const teams = $('[data-calc-teams]', tForm);
    const cardInput = $('[data-card-input]', tForm);
    const cover = $('[data-preview-cover]', tForm);

    function hashHue(text) {
      let h = 0;
      for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
      return h;
    }
    function styleFor(game) {
      const known = styleIndex[game.trim().toLowerCase()];
      if (known) return known;
      const h = hashHue(game);
      const words = game.split(/[\s\-_:]+/).filter(Boolean);
      return {
        abbr: words.slice(0, 3).map((w) => w[0]).join('').toUpperCase() || '?',
        c1: `hsl(${h} 85% 60%)`,
        c2: `hsl(${(h + 50) % 360} 80% 45%)`,
      };
    }

    function isPaid() { return $('[data-paid]:checked', tForm)?.value === '1'; }

    function updatePreview() {
      $('[data-preview-title]', tForm).textContent = titleInput.value.trim() || 'Название турнира';
      const game = gameInput.value.trim();
      $('[data-preview-game]', tForm).textContent = game || 'Игра';
      const st = styleFor(game || '?');
      cover.style.setProperty('--c1', st.c1);
      cover.style.setProperty('--c2', st.c2);
      $('[data-preview-abbr]', tForm).textContent = game ? st.abbr : '?';
      const price = $('[data-preview-price]', tForm);
      if (isPaid()) {
        price.className = 'badge badge-paid';
        price.textContent = Number(fee.value) > 0 ? money(fee.value, currency) : 'Платный';
      } else {
        price.className = 'badge badge-free';
        price.textContent = 'Бесплатно';
      }
    }

    function togglePaid() {
      $$('[data-paid-fields]', tForm).forEach((el) => { el.hidden = !isPaid(); });
      updatePreview();
    }
    function toggleCity() {
      const offline = $('[data-format]:checked', tForm)?.value === 'offline';
      $('[data-city-field]', tForm).hidden = !offline;
    }

    function luhn(number) {
      if (!/^\d{13,19}$/.test(number)) return false;
      let sum = 0;
      for (let i = 0; i < number.length; i++) {
        let d = Number(number[number.length - 1 - i]);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
      }
      return sum % 10 === 0;
    }
    function brand(n) {
      if (/^220[0-4]/.test(n)) return 'МИР';
      if (/^4/.test(n)) return 'VISA';
      if (/^5[1-5]/.test(n) || (n.slice(0, 4) >= '2221' && n.slice(0, 4) <= '2720')) return 'Mastercard';
      if (/^62/.test(n)) return 'UnionPay';
      if (/^3[47]/.test(n)) return 'AMEX';
      return 'CARD';
    }
    function updateCard() {
      const digits = cardInput.value.replace(/\D/g, '').slice(0, 19);
      const grouped = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      if (cardInput.value !== grouped) {
        const atEnd = cardInput.selectionStart === cardInput.value.length;
        cardInput.value = grouped;
        if (atEnd) cardInput.setSelectionRange(grouped.length, grouped.length);
      }
      const padded = (digits + '•'.repeat(Math.max(0, 16 - digits.length))).replace(/(.{4})(?=.)/g, '$1 ');
      $('[data-card-preview]', tForm).textContent = padded;
      $('[data-card-brand]', tForm).textContent = brand(digits);
      const card = $('[data-bank-card]', tForm);
      const status = $('[data-card-status]', tForm);
      const valid = luhn(digits);
      card.classList.toggle('is-valid', valid);
      card.classList.toggle('is-invalid', digits.length >= 13 && !valid);
      status.textContent = valid ? 'Проверена ✓' : (digits.length >= 13 ? 'Ошибка' : '—');
    }

    $$('[data-paid]', tForm).forEach((r) => r.addEventListener('change', togglePaid));
    $$('[data-format]', tForm).forEach((r) => r.addEventListener('change', toggleCity));
    $$('[data-fill-game]', tForm).forEach((btn) => btn.addEventListener('click', () => {
      gameInput.value = btn.dataset.fillGame;
      updatePreview();
    }));
    [titleInput, gameInput, fee].forEach((el) => el.addEventListener('input', updatePreview));
    cardInput.addEventListener('input', updateCard);

    bindSplit(tForm, () => (Number(fee.value) || 0) * (Number(teams.value) || 0));
    togglePaid();
    toggleCity();
    updateCard();
  }

  /* -------------------------------------------- автоподсчёт очков в таблице */
  const tableForm = $('[data-table-form]');
  const autoPoints = $('[data-auto-points]');
  if (tableForm && autoPoints) {
    tableForm.addEventListener('input', (event) => {
      const stat = event.target.dataset.stat;
      if (!autoPoints.checked || (stat !== 'wins' && stat !== 'draws')) return;
      const row = event.target.closest('[data-row]');
      const wins = Number($('[data-stat="wins"]', row).value) || 0;
      const draws = Number($('[data-stat="draws"]', row).value) || 0;
      const points = $('[data-stat="points"]', row);
      points.value = wins * 3 + draws;
      points.classList.remove('is-auto');
      void points.offsetWidth;
      points.classList.add('is-auto');
    });
  }
})();
