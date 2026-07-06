// ==UserScript==
// @name         Euro-Football.ru — автозаполнение прогноза
// @namespace    euro-football-autofill
// @version      0.1.0
// @description  Вставляет прогноз из буфера обмена (сгенерированный в Claude) в форму "Добавить материал" админки euro-football.ru
// @match        https://euro-football.ru/admin/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

/*
 * ФОРМАТ ИСХОДНИКА (журналист копирует ответ Claude целиком в этом виде):
 *
 * Заголовок: <текст>
 * Команда1: <название>
 * Команда2: <название>
 * Дата: <ДД.ММ>
 * Коэффициент: <число>
 * Текст:
 * <абзац-вступление>
 *
 * ## <Команда1>
 * <текст>
 *
 * ## <Команда2>
 * <текст>
 *
 * ## Статистика и цифры
 * - пункт
 * - пункт
 *
 * ## Прогноз
 * <текст>
 * Исход матча: <текст, который пойдёт в поле "Текст прогноза">
 *
 * ВАЖНО: все селекторы ниже — заглушки по структуре со скриншотов.
 * Перед использованием открой реальную страницу "Добавить материал",
 * через ПКМ → "Просмотреть код" найди настоящие атрибуты (id/name/class)
 * и подставь их в блок SELECTORS ниже.
 */

(function () {
  'use strict';

  const SELECTORS = {
    titleInput: '#TODO_title_input',                 // Заголовок
    ckeditorIframe: '.cke_wysiwyg_frame',             // iframe тела CKEditor
    typeRadioPrognoz: 'input[name="TODO_type"][value="prognoz"]',
    publishedRadioYes: 'input[name="TODO_published"][value="1"]',
    importanceRadioNone: 'input[name="TODO_importance"][value="none"]',
    tagsInput: '#TODO_tags_input',                    // текстовое поле ввода тегов (Enter добавляет токен)
    sourceInput: '#TODO_source_input',
    matchCheckboxes: '.TODO_matches_list input[type="checkbox"]',
    matchLabelWrapper: '.TODO_matches_list label',     // для поиска по тексту команд
    oddsInput: '#TODO_odds_input',                     // Коэффициент
    prognozTextInput: '#TODO_prognoz_text_input',       // Текст прогноза
    hideFromFeedsCheckbox: '#TODO_hide_from_feeds_checkbox', // "Не отображать в основных лентах новостей"
  };

  function parseSource(raw) {
    const get = (re) => (raw.match(re) || [, ''])[1].trim();

    const title = get(/^Заголовок:\s*(.+)$/m);
    const team1 = get(/^Команда1:\s*(.+)$/m);
    const team2 = get(/^Команда2:\s*(.+)$/m);
    const date = get(/^Дата:\s*(.+)$/m);
    const odds = get(/^Коэффициент:\s*(.+)$/m);
    const outcome = get(/^Исход матча:\s*(.+)$/m);

    const bodyMatch = raw.match(/^Текст:\s*\n([\s\S]+)$/m);
    const bodyRaw = bodyMatch ? bodyMatch[1].trim() : '';

    const bodyHtml = bodyRaw
      .split(/\n{2,}/)
      .map((block) => {
        block = block.trim();
        if (block.startsWith('## ')) {
          const heading = block.replace(/^##\s*/, '');
          return `<h1>${escapeHtml(heading)}</h1>`;
        }
        if (block.split('\n').every((l) => l.trim().startsWith('- '))) {
          const items = block
            .split('\n')
            .map((l) => `<li>${escapeHtml(l.replace(/^-\s*/, ''))}</li>`)
            .join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');

    const tags = ['Сборная ' + team1, 'Сборная ' + team2, 'ЧМ-2026', 'прогнозы на футбол'];

    return { title, team1, team2, date, odds, outcome, bodyHtml, tags };
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillForm(data) {
    const titleEl = document.querySelector(SELECTORS.titleInput);
    if (titleEl) setNativeValue(titleEl, data.title);
    else console.warn('[autofill] заголовок: селектор не найден', SELECTORS.titleInput);

    const frame = document.querySelector(SELECTORS.ckeditorIframe);
    if (frame && frame.contentDocument) {
      frame.contentDocument.body.innerHTML = data.bodyHtml;
    } else {
      console.warn('[autofill] CKEditor iframe не найден', SELECTORS.ckeditorIframe);
    }

    [SELECTORS.typeRadioPrognoz, SELECTORS.publishedRadioYes, SELECTORS.importanceRadioNone].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
      else console.warn('[autofill] радио не найдено', sel);
    });

    const tagsInput = document.querySelector(SELECTORS.tagsInput);
    if (tagsInput) {
      data.tags.forEach((tag) => {
        setNativeValue(tagsInput, tag);
        tagsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    } else {
      console.warn('[autofill] поле тегов не найдено', SELECTORS.tagsInput);
    }

    const sourceEl = document.querySelector(SELECTORS.sourceInput);
    if (sourceEl) setNativeValue(sourceEl, 'Euro-Football.Ru');

    const matchLabels = document.querySelectorAll(SELECTORS.matchLabelWrapper);
    let matchFound = false;
    matchLabels.forEach((label) => {
      const text = label.textContent || '';
      if (text.includes(data.team1) && text.includes(data.team2) && (!data.date || text.includes(data.date))) {
        const cb = label.querySelector('input[type="checkbox"]') || document.getElementById(label.htmlFor);
        if (cb && !cb.checked) cb.click();
        matchFound = true;
      }
    });
    if (!matchFound) console.warn('[autofill] матч не найден по командам/дате', data.team1, data.team2, data.date);

    const oddsEl = document.querySelector(SELECTORS.oddsInput);
    if (oddsEl) setNativeValue(oddsEl, data.odds);

    const prognozTextEl = document.querySelector(SELECTORS.prognozTextInput);
    if (prognozTextEl) setNativeValue(prognozTextEl, data.outcome);

    const hideCb = document.querySelector(SELECTORS.hideFromFeedsCheckbox);
    if (hideCb && !hideCb.checked) hideCb.click();

    console.log('[autofill] готово. Проверь поля и нажми "Сохранить".');
  }

  function addButton() {
    const btn = document.createElement('button');
    btn.textContent = 'Вставить из буфера и заполнить форму';
    btn.type = 'button';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      zIndex: 999999,
      padding: '10px 16px',
      background: '#1a56db',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
    });
    btn.addEventListener('click', async () => {
      try {
        const raw = await navigator.clipboard.readText();
        const data = parseSource(raw);
        if (!data.title) {
          alert('Не удалось распознать формат. Проверь, что в буфере — текст от Claude в нужном шаблоне.');
          return;
        }
        fillForm(data);
      } catch (e) {
        alert('Не удалось прочитать буфер обмена: ' + e.message + '\nРазреши доступ к буферу для этой страницы.');
      }
    });
    document.body.appendChild(btn);
  }

  addButton();
})();
