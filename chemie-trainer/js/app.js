(function attachChemieApp(global) {
  "use strict";

  var DATA = global.CHEMIE_DATA || { meta: {}, terms: [], questions: [], readyAnswers: [] };
  var Storage = global.ChemieStorage;
  var Engine = global.ChemistryEngine;
  var MapGenerator = global.MapGenerator;
  var MapRenderer = global.MapRenderer;
  var Timer = global.GameTimer || global.Timer;

  var app = null;
  var routeTitle = null;
  var routeSubtitle = null;
  var settings = null;
  var progress = null;
  var validation = null;
  var currentMap = null;

  var TYPE_LABELS = {
    single_choice: "Выбор ответа",
    multiple_choice: "Множественный выбор",
    matching: "Сопоставление",
    fill_blank: "Вставка",
    ordering: "Порядок",
    true_false: "Верно/неверно",
    categorization: "Категоризация",
    short_answer: "Короткий ответ"
  };

  var MODE_LABELS = {
    luft: "Luft",
    wasser: "Wasser",
    gemischt: "Gemischt",
    fehler: "Fehler wiederholen"
  };

  function byId(id) {
    return global.document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function percent(correct, seen) {
    if (!seen) {
      return "0%";
    }
    return String(Math.round((correct / seen) * 100)) + "%";
  }

  function setRoute(route) {
    if ((global.location.hash || "#start").slice(1) !== route) {
      global.location.hash = route;
    } else {
      render();
    }
  }

  function getRoute() {
    return (global.location.hash || "#start").slice(1) || "start";
  }

  function setActiveNav(route) {
    var navRoute = route === "fehler" ? "start" : route;
    global.document.querySelectorAll("[data-route]").forEach(function updateNav(button) {
      button.classList.toggle("is-active", button.getAttribute("data-route") === navRoute);
    });
  }

  function setHeader(title, subtitle) {
    if (routeTitle) {
      routeTitle.textContent = title;
    }
    if (routeSubtitle) {
      routeSubtitle.textContent = subtitle || "";
    }
  }

  function showStatus(text, kind) {
    var node = byId("app-status");
    if (!node) {
      return;
    }
    node.hidden = !text;
    node.className = "notice" + (kind ? " notice-" + kind : "");
    node.textContent = text || "";
  }

  function storageLabel() {
    return Storage.isAvailable() ? "localStorage доступен" : "localStorage недоступен, используется память вкладки";
  }

  function collectSettingsFromForm() {
    var checkedTypes = [];
    global.document.querySelectorAll('input[name="enabledTypes"]:checked').forEach(function collect(input) {
      checkedTypes.push(input.value);
    });

    return {
      topicMode: (global.document.querySelector('input[name="topicMode"]:checked') || {}).value || settings.topicMode,
      enabledTypes: checkedTypes.length === Storage.allowedTypes.length ? "all" : checkedTypes,
      totalHexes: byId("totalHexes") ? byId("totalHexes").value : settings.totalHexes,
      playerStartHexes: byId("playerStartHexes") ? byId("playerStartHexes").value : settings.playerStartHexes,
      timerEnabled: byId("timerEnabled") ? byId("timerEnabled").checked : settings.timerEnabled,
      timerMode: byId("timerMode") ? byId("timerMode").value : settings.timerMode,
      hardTimerForShortAnswer: byId("hardTimerForShortAnswer")
        ? byId("hardTimerForShortAnswer").checked
        : settings.hardTimerForShortAnswer,
      timerSecondsByType: settings.timerSecondsByType
    };
  }

  function saveSettingsFromForm(showMessages) {
    var normalized = Storage.saveSettings(collectSettingsFromForm());
    settings = normalized.settings;
    syncSettingsInputs(settings);
    if (showMessages) {
      renderNormalizationMessages(normalized.messages);
    }
    return normalized;
  }

  function syncSettingsInputs(source) {
    if (byId("totalHexes")) {
      byId("totalHexes").value = source.totalHexes;
    }
    if (byId("playerStartHexes")) {
      byId("playerStartHexes").value = source.playerStartHexes;
      byId("playerStartHexes").max = Math.min(8, source.totalHexes - 3);
    }
    if (byId("timerEnabled")) {
      byId("timerEnabled").checked = source.timerEnabled;
    }
    if (byId("timerMode")) {
      byId("timerMode").value = source.timerMode;
    }
    if (byId("hardTimerForShortAnswer")) {
      byId("hardTimerForShortAnswer").checked = source.hardTimerForShortAnswer;
    }
  }

  function renderNormalizationMessages(messages) {
    var node = byId("normalizationNotice");
    if (!node) {
      return;
    }
    if (!messages || messages.length === 0) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent = messages.join(" ");
  }

  function typeCheckboxes() {
    var enabled = settings.enabledTypes === "all" ? Storage.allowedTypes.slice() : settings.enabledTypes;
    return Storage.allowedTypes.map(function renderType(type) {
      var checked = enabled.indexOf(type) !== -1 ? " checked" : "";
      return '<label class="check-row"><input type="checkbox" name="enabledTypes" value="' + esc(type) + '"' + checked + '> <span>' + esc(TYPE_LABELS[type]) + '</span></label>';
    }).join("");
  }

  function renderDataStatus() {
    var totalQuestions = Array.isArray(DATA.questions) ? DATA.questions.length : 0;
    var errors = validation.errors.length;
    var warnings = validation.warnings.length;

    if (totalQuestions === 0) {
      return '<div class="notice notice-info">Банк вопросов пока пуст. Каркас запускается в режиме оболочки; данные будут добавлены следующим промптом.</div>';
    }
    if (errors || warnings) {
      return '<div class="notice notice-warn">В банке вопросов найдены ошибки: ' + errors + ', предупреждения: ' + warnings + '. Подробности в консоли.</div>';
    }
    return '<div class="notice notice-ok">Банк вопросов проверен: ' + totalQuestions + ' заданий.</div>';
  }

  function renderStart() {
    setHeader("Старт", "Настрой тему, карту и режим тренировки");
    var modeOptions = ["luft", "wasser", "gemischt", "fehler"].map(function renderMode(mode) {
      var checked = settings.topicMode === mode ? " checked" : "";
      return '<label class="segment"><input type="radio" name="topicMode" value="' + mode + '"' + checked + '><span>' + esc(MODE_LABELS[mode]) + '</span></label>';
    }).join("");

    app.innerHTML = '' +
      '<section class="start-layout">' +
        '<form class="panel settings-panel" id="settingsForm">' +
          '<div class="panel-head"><div><p class="eyebrow">Chemie-Eroberung</p><h1>Тренажер по химии</h1></div><span class="storage-pill">' + esc(storageLabel()) + '</span></div>' +
          renderDataStatus() +
          '<fieldset><legend>Режим</legend><div class="segmented">' + modeOptions + '</div></fieldset>' +
          '<fieldset class="grid-2"><legend>Карта</legend>' +
            '<label class="field"><span>totalHexes</span><input id="totalHexes" type="number" min="12" max="36" step="1" value="' + settings.totalHexes + '"></label>' +
            '<label class="field"><span>playerStartHexes</span><input id="playerStartHexes" type="number" min="3" max="' + Math.min(8, settings.totalHexes - 3) + '" step="1" value="' + settings.playerStartHexes + '"></label>' +
          '</fieldset>' +
          '<fieldset class="grid-3"><legend>Таймер</legend>' +
            '<label class="check-row switch-row"><input id="timerEnabled" type="checkbox"' + (settings.timerEnabled ? " checked" : "") + '> <span>timerEnabled</span></label>' +
            '<label class="field"><span>timerMode</span><select id="timerMode"><option value="soft">soft</option><option value="hard">hard</option></select></label>' +
            '<label class="check-row switch-row"><input id="hardTimerForShortAnswer" type="checkbox"' + (settings.hardTimerForShortAnswer ? " checked" : "") + '> <span>hardTimerForShortAnswer</span></label>' +
          '</fieldset>' +
          '<details class="advanced"><summary>Erweiterte Einstellungen</summary><div class="type-grid">' + typeCheckboxes() + '</div></details>' +
          '<div id="normalizationNotice" class="notice notice-warn" hidden></div>' +
          '<div class="action-row">' +
            '<button class="primary-btn" type="button" id="startGame">Начать игру</button>' +
            '<button class="soft-btn" type="button" data-local-route="dictionary">Словарь</button>' +
            '<button class="soft-btn" type="button" data-local-route="answers">Готовые ответы</button>' +
            '<button class="soft-btn" type="button" data-local-route="progress">Обзор прогресса</button>' +
            '<button class="danger-btn" type="button" id="resetProgress">Сбросить прогресс</button>' +
          '</div>' +
        '</form>' +
        '<aside class="panel map-preview-panel">' +
          '<div class="map-toolbar"><div><h2>Карта партии</h2><p>Гексы и стартовые территории обновляются сразу после изменения настроек.</p></div><div class="score-line"><span>Ученик: <strong id="player-territories">0</strong></span><span>Всего: <strong id="total-territories">0</strong></span></div></div>' +
          '<div id="map-container" class="map-container" aria-label="Предпросмотр гекс-карты"><svg id="game-map" role="img" aria-label="Абстрактная гекс-карта"></svg></div>' +
        '</aside>' +
      '</section>';

    syncSettingsInputs(settings);
    byId("timerMode").value = settings.timerMode;
    wireStartScreen();
    drawMap();
  }

  function wireStartScreen() {
    byId("settingsForm").addEventListener("change", function onSettingsChange() {
      saveSettingsFromForm(true);
      drawMap();
    });
    byId("settingsForm").addEventListener("input", function onSettingsInput(event) {
      if (event.target && (event.target.id === "totalHexes" || event.target.id === "playerStartHexes")) {
        saveSettingsFromForm(true);
        drawMap();
      }
    });
    byId("startGame").addEventListener("click", beginGame);
    byId("resetProgress").addEventListener("click", function resetProgress() {
      progress = Storage.resetAll();
      showStatus("Прогресс сброшен. Настройки сохранены.", "ok");
      renderStart();
    });
    global.document.querySelectorAll("[data-local-route]").forEach(function wireLocal(button) {
      button.addEventListener("click", function go() {
        setRoute(button.getAttribute("data-local-route"));
      });
    });
  }

  function beginGame() {
    saveSettingsFromForm(true);
    progress = Storage.loadProgress();

    if (settings.topicMode === "fehler" && progress.mistakeIds.length === 0) {
      setRoute("fehler");
      return;
    }

    var pool = Engine.buildQuestionPool(DATA, settings, progress);
    if (Array.isArray(DATA.questions) && DATA.questions.length > 0 && pool.length === 0) {
      showStatus("Нет вопросов для выбранных фильтров. Измени тему или типы заданий.", "warn");
      return;
    }

    Storage.saveCurrentGame({
      version: 2,
      settings: settings,
      startedAt: new Date().toISOString(),
      shellMode: pool.length === 0,
      questionPoolIds: pool.map(function mapQuestion(question) {
        return question.id;
      })
    });
    setRoute("game");
  }

  function drawMap() {
    if (!MapGenerator || !MapRenderer || !byId("game-map")) {
      return;
    }
    currentMap = MapGenerator.generate(settings.totalHexes, settings.playerStartHexes);
    MapRenderer.render(currentMap, byId("game-map"));

    var borderIds = MapGenerator.getBorderRegions(currentMap.regions, "player").map(function getId(region) {
      return region.id;
    });
    MapRenderer.highlightBorder(borderIds);

    var computerNode = byId("system-territories");
    if (computerNode) {
      computerNode.textContent = String(MapGenerator.getComputerRegions(currentMap.regions).length);
    }
  }

  function renderGame() {
    setHeader("Игра", "Каркас партии и гекс-карта");
    var saved = Storage.loadCurrentGame();
    var gameSettings = saved && saved.settings ? Storage.normalizeSettings(saved.settings).settings : settings;
    settings = gameSettings;
    var pool = Engine.buildQuestionPool(DATA, gameSettings, progress);
    var queue = Engine.createQuestionQueue(pool, progress);
    var question = Engine.getNextQuestion(queue);
    var shellText = question
      ? '<h2>' + esc(question.questionDe) + '</h2><p>' + esc(question.questionRu) + '</p>'
      : '<h2>Банк вопросов будет подключен следующим шагом</h2><p>Карта, настройки, storage и маршруты уже работают. Когда появятся вопросы, этот блок станет интерактивным заданием.</p>';

    app.innerHTML = '' +
      '<section class="game-layout">' +
        '<div class="panel game-map-panel">' +
          '<div class="game-topline">' +
            '<div class="score-line"><span>Ученик: <strong id="player-territories">0</strong></span><span>Система: <strong id="system-territories">0</strong></span><span>Всего: <strong id="total-territories">0</strong></span></div>' +
            '<div class="timer-shell" aria-label="Таймер"><span id="timer-text">0</span><div class="timer-track"><div id="timer-bar-fill"></div></div></div>' +
          '</div>' +
          '<div id="map-container" class="map-container map-container-game"><svg id="game-map" role="img" aria-label="Гекс-карта партии"></svg></div>' +
        '</div>' +
        '<aside class="panel question-panel">' +
          '<p class="eyebrow">' + esc(MODE_LABELS[gameSettings.topicMode]) + ' · ' + gameSettings.totalHexes + ' Hexes</p>' +
          shellText +
          '<div class="progress-strip"><span>Решено: ' + progress.seen + '</span><span>Верно: ' + progress.correct + '</span><span>Ошибки: ' + progress.incorrect + '</span></div>' +
          '<div class="action-row"><button class="primary-btn" type="button" id="regenerateMap">Новая карта</button><button class="soft-btn" type="button" data-local-route="start">Назад</button><button class="soft-btn" type="button" data-local-route="dictionary">Словарь</button></div>' +
        '</aside>' +
      '</section>';

    global.document.querySelectorAll("[data-local-route]").forEach(function wireLocal(button) {
      button.addEventListener("click", function go() {
        setRoute(button.getAttribute("data-local-route"));
      });
    });
    byId("regenerateMap").addEventListener("click", drawMap);
    drawMap();

    if (Timer) {
      Timer.reset();
      if (gameSettings.timerEnabled && question) {
        var seconds = gameSettings.timerSecondsByType[question.type] || 60;
        var hard = gameSettings.timerMode === "hard" && (question.type !== "short_answer" || gameSettings.hardTimerForShortAnswer);
        Timer.start(seconds, hard, function onTimeUp() {
          showStatus(hard ? "Время вышло. В строгом режиме это будет считаться ошибкой." : "Время вышло.", "warn");
        });
      }
    }
  }

  function renderDictionary() {
    setHeader("Словарь", "Заготовка экрана терминов");
    var terms = Array.isArray(DATA.terms) ? DATA.terms : [];
    app.innerHTML = '' +
      '<section class="panel list-panel">' +
        '<div class="screen-head"><div><h1>Словарь терминов</h1><p>Поиск и фильтры будут подключены вместе с банком терминов.</p></div><button class="soft-btn" type="button" data-local-route="start">На старт</button></div>' +
        (terms.length ? '<div class="card-grid">' + terms.map(renderTerm).join("") + '</div>' : '<div class="empty-state"><h2>Термины пока не добавлены</h2><p>Структура `CHEMIE_DATA.terms` готова для следующей сессии.</p></div>') +
      '</section>';
    wireLocalRouteButtons();
  }

  function renderTerm(term) {
    return '<article class="mini-card"><h2>' + esc(term.term || term.id) + '</h2><p>' + esc(term.ru || "") + '</p></article>';
  }

  function renderAnswers() {
    setHeader("Готовые ответы", "Заготовка немецких формулировок");
    var answers = Array.isArray(DATA.readyAnswers) ? DATA.readyAnswers : [];
    app.innerHTML = '' +
      '<section class="panel list-panel">' +
        '<div class="screen-head"><div><h1>Готовые немецкие ответы</h1><p>Карточки будут храниться в `CHEMIE_DATA.readyAnswers`.</p></div><button class="soft-btn" type="button" data-local-route="start">На старт</button></div>' +
        (answers.length ? '<div class="card-grid">' + answers.map(renderReadyAnswer).join("") + '</div>' : '<div class="empty-state"><h2>Ответы пока не добавлены</h2><p>Экран и маршрут уже подготовлены.</p></div>') +
      '</section>';
    wireLocalRouteButtons();
  }

  function renderReadyAnswer(answer) {
    return '<article class="mini-card"><p class="eyebrow">' + esc(answer.titleDe || answer.topic) + '</p><h2>' + esc(answer.titleRu || answer.id) + '</h2><p>' + esc(answer.answerDe || "") + '</p></article>';
  }

  function renderProgress() {
    setHeader("Прогресс", "Обзор сохраненных результатов");
    var luft = progress.topicStats.luft;
    var wasser = progress.topicStats.wasser;
    app.innerHTML = '' +
      '<section class="panel progress-panel">' +
        '<div class="screen-head"><div><h1>Обзор прогресса</h1><p>Сейчас здесь отображается базовая структура сохранения. Детальная статистика появится после подключения игрового цикла.</p></div><button class="soft-btn" type="button" data-local-route="start">На старт</button></div>' +
        '<div class="metric-grid">' +
          '<div class="metric"><strong>' + percent(progress.correct, progress.seen) + '</strong><span>общая точность</span></div>' +
          '<div class="metric"><strong>' + percent(luft.correct, luft.seen) + '</strong><span>Luft</span></div>' +
          '<div class="metric"><strong>' + percent(wasser.correct, wasser.seen) + '</strong><span>Wasser</span></div>' +
          '<div class="metric"><strong>' + progress.mistakeIds.length + '</strong><span>ошибок для повтора</span></div>' +
        '</div>' +
        '<div class="action-row"><button class="soft-btn" type="button" data-local-route="fehler">Повторить ошибки</button><button class="danger-btn" type="button" id="resetProgressInline">Сбросить прогресс</button></div>' +
      '</section>';
    wireLocalRouteButtons();
    byId("resetProgressInline").addEventListener("click", function resetInline() {
      progress = Storage.resetAll();
      renderProgress();
    });
  }

  function renderFehler() {
    setHeader("Fehler wiederholen", "Режим повторения ошибок");
    if (progress.mistakeIds.length === 0) {
      app.innerHTML = '' +
        '<section class="panel empty-route">' +
          '<h1>Сейчас нет сохранённых ошибок.</h1>' +
          '<p>Можно начать новую смешанную игру или открыть обзор прогресса.</p>' +
          '<div class="action-row"><button class="primary-btn" type="button" id="startMixed">Gemischt starten</button><button class="soft-btn" type="button" data-local-route="progress">Обзор прогресса</button><button class="soft-btn" type="button" data-local-route="start">Назад</button></div>' +
        '</section>';
      byId("startMixed").addEventListener("click", function startMixed() {
        settings.topicMode = "gemischt";
        Storage.saveSettings(settings);
        beginGame();
      });
      wireLocalRouteButtons();
      return;
    }

    app.innerHTML = '' +
      '<section class="panel empty-route">' +
        '<h1>Ошибки для повтора</h1>' +
        '<p>Сохранённые id: ' + esc(progress.mistakeIds.join(", ")) + '</p>' +
        '<div class="action-row"><button class="primary-btn" type="button" id="startMistakes">Начать повтор</button><button class="soft-btn" type="button" data-local-route="start">Назад</button></div>' +
      '</section>';
    byId("startMistakes").addEventListener("click", beginGame);
    wireLocalRouteButtons();
  }

  function wireLocalRouteButtons() {
    global.document.querySelectorAll("[data-local-route]").forEach(function wire(button) {
      button.addEventListener("click", function go() {
        setRoute(button.getAttribute("data-local-route"));
      });
    });
  }

  function render() {
    settings = Storage.loadSettings();
    progress = Storage.loadProgress();
    validation = Engine.validateData(DATA);
    if ((validation.errors.length || validation.warnings.length) && global.console) {
      global.console.warn("CHEMIE_DATA validation", validation);
    }

    var route = getRoute();
    setActiveNav(route);
    showStatus("", "");

    if (route === "game") {
      renderGame();
    } else if (route === "dictionary") {
      renderDictionary();
    } else if (route === "answers") {
      renderAnswers();
    } else if (route === "progress") {
      renderProgress();
    } else if (route === "fehler") {
      renderFehler();
    } else {
      renderStart();
    }

    if (app && typeof app.focus === "function") {
      app.focus({ preventScroll: true });
    }
  }

  function init() {
    app = byId("app");
    routeTitle = byId("route-title");
    routeSubtitle = byId("route-subtitle");
    settings = Storage.loadSettings();
    progress = Storage.loadProgress();
    validation = Engine.validateData(DATA);

    global.document.body.addEventListener("click", function onBodyClick(event) {
      var routeButton = event.target.closest("[data-route]");
      if (!routeButton) {
        return;
      }
      event.preventDefault();
      setRoute(routeButton.getAttribute("data-route"));
    });

    global.addEventListener("hashchange", render);
    render();
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
