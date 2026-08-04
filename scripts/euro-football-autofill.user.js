// ==UserScript==
// @name         Euro-Football.ru — автозаполнение прогноза
// @namespace    euro-football-autofill
// @version      0.2.0
// @description  Вставляет прогноз из буфера обмена (сгенерированный в Claude) в форму "Добавить материал" админки euro-football.ru
// @match        https://www.euro-football.ru/admin/content/content/*
// @grant        none
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
 * Категория и фото сознательно не трогаются — выбираются вручную.
 *
 * Две кнопки на странице:
 * - "ЧМ-2026" — теги: Сборная <Команда1>, Сборная <Команда2>, ЧМ-2026, прогнозы на футбол
 * - "Первая лига" — теги: <Команда1>, <Команда2>, прогнозы на футбол (без "Сборная" и без ЧМ-2026)
 */

(function () {
  'use strict';

  function parseSource(raw) {
    raw = raw.replace(/\r\n/g, '\n');
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
      .flatMap((block) => {
        block = block.trim();
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const parts = [];
        let rest = lines;

        if (rest.length && rest[0].startsWith('## ')) {
          parts.push(`<h1><strong>${escapeHtml(rest[0].replace(/^##\s*/, ''))}</strong></h1>`);
          rest = rest.slice(1);
        }
        if (!rest.length) return parts;

        if (rest.every((l) => l.startsWith('- '))) {
          const line = rest.map((l) => '– ' + escapeHtml(l.replace(/^-\s*/, ''))).join('<br />\n');
          parts.push(`<p>${line}</p>`);
        } else {
          parts.push(`<p>${escapeHtml(rest.join('\n')).replace(/\n/g, '<br />')}</p>`);
        }
        return parts;
      })
      .join('\n');

    return { title, team1, team2, date, odds, outcome, bodyHtml };
  }

  function buildTags(data, tagMode) {
    if (tagMode === 'liga') {
      return [data.team1, data.team2, 'прогнозы на футбол'];
    }
    return ['Сборная ' + data.team1, 'Сборная ' + data.team2, 'ЧМ-2026', 'прогнозы на футбол'];
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

  function fillForm(data, tagMode) {
    const $ = window.jQuery;
    const missing = [];
    const tags = buildTags(data, tagMode);

    const titleEl = document.getElementById('contentform-title');
    if (titleEl) setNativeValue(titleEl, data.title);
    else missing.push('Заголовок (#contentform-title)');

    if (window.CKEDITOR && CKEDITOR.instances['contentform-textfull']) {
      CKEDITOR.instances['contentform-textfull'].setData(data.bodyHtml);
    } else {
      missing.push('Тело статьи (CKEDITOR contentform-textfull) — редактор ещё не загрузился?');
    }

    const typeRadio = document.getElementById('indicator-anons'); // "Прогноз"
    if (typeRadio) typeRadio.click();
    else missing.push('Тип материала "Прогноз" (#indicator-anons)');

    const publishedRadio = document.querySelector('input[name="ContentForm[published]"][value="1"]');
    if (publishedRadio) publishedRadio.click();
    else missing.push('Радио "Опубликован"');

    const priorityRadio = document.querySelector('input[name="ContentForm[priority]"][value="none"]');
    if (priorityRadio) priorityRadio.click();
    else missing.push('Радио "Важность: Отсутствует"');

    if ($ && $.fn.select2) {
      const $tags = $('#contentform-marks');
      tags.forEach((tag) => {
        if (!tag) return;
        const option = new Option(tag, tag, true, true);
        $tags.append(option).trigger('change');
      });
    } else {
      missing.push('Теги (#contentform-marks, select2 не найден на странице)');
    }

    const sourceEl = document.getElementById('contentform-source');
    if (sourceEl) setNativeValue(sourceEl, 'Euro-Football.ru');
    else missing.push('Источник (#contentform-source)');

    const matchInputs = document.querySelectorAll('input[name="ContentForm[matches][]"]');
    let matchFound = false;
    matchInputs.forEach((cb) => {
      const wrapper = cb.closest('.match');
      const text = wrapper ? wrapper.textContent : '';
      if (data.team1 && data.team2 && text.includes(data.team1) && text.includes(data.team2)
          && (!data.date || text.includes(data.date))) {
        if (!cb.checked) cb.click();
        matchFound = true;
      }
    });
    if (!matchFound) missing.push(`Матч не найден по командам "${data.team1}"/"${data.team2}" и дате "${data.date}"`);

    const oddsEl = document.getElementById('contentform-forecast_coeff');
    if (oddsEl) setNativeValue(oddsEl, data.odds);
    else missing.push('Коэффициент (#contentform-forecast_coeff)');

    const prognozTextEl = document.getElementById('contentform-forecast_text');
    if (prognozTextEl) setNativeValue(prognozTextEl, data.outcome);
    else missing.push('Текст прогноза (#contentform-forecast_text)');

    const hideCb = document.getElementById('contentform-ishidemainlist');
    if (hideCb && !hideCb.checked) hideCb.click();
    else if (!hideCb) missing.push('Чекбокс "Не отображать в основных лентах новостей"');

    if (missing.length) {
      alert('Форма заполнена частично. Проверь вручную:\n\n' + missing.join('\n'));
    } else {
      console.log('[autofill] готово. Проверь поля и нажми "Сохранить".');
    }
  }

  async function onFillClick(tagMode) {
    try {
      const raw = await navigator.clipboard.readText();
      const data = parseSource(raw);
      if (!data.title) {
        alert('Не удалось распознать формат. Проверь, что в буфере — текст от Claude в нужном шаблоне.');
        return;
      }
      fillForm(data, tagMode);
    } catch (e) {
      alert('Не удалось прочитать буфер обмена: ' + e.message + '\nРазреши доступ к буферу для этой страницы.');
    }
  }

  function makeButton(label, top, tagMode) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.type = 'button';
    Object.assign(btn.style, {
      position: 'fixed',
      top: top,
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
    btn.addEventListener('click', () => onFillClick(tagMode));
    return btn;
  }

  function addButtons() {
    if (!document.getElementById('content-form')) return; // страница без формы материала
    if (document.getElementById('autofill-btn-wc')) return; // уже добавлены

    const btnWc = makeButton('Вставить из буфера (ЧМ-2026)', '10px', 'wc');
    btnWc.id = 'autofill-btn-wc';
    const btnLiga = makeButton('Вставить из буфера (Первая лига)', '54px', 'liga');
    btnLiga.id = 'autofill-btn-liga';

    document.body.appendChild(btnWc);
    document.body.appendChild(btnLiga);
  }

  // Сайт использует pjax (AJAX-навигацию без полной перезагрузки страницы),
  // поэтому обычного запуска при document-idle недостаточно — форма может
  // появиться в DOM позже, без нового срабатывания userscript.
  addButtons();
  new MutationObserver(addButtons).observe(document.body, { childList: true, subtree: true });
})();
