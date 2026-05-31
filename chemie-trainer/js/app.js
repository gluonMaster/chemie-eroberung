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
  var answerLocked = false;
  var dictionaryTermFilterIds = null;
  var loggedExplanationFallbacks = {};
  var EMPTY_SHORT_ANSWER_TEXT = "Ответ пустой. Сначала напиши 1–3 предложения или выбери “не засчитывать”.";
  var SHORT_ANSWER_WARNING_TEXT = "Автоматическая проверка не нашла нужные Fachbegriffe. Ты уверен, что честно оцениваешь качество своего ответа?";

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

  var RESULT_LABELS = {
    victory: "Победа",
    defeat: "Тренировка завершена",
    training_success: "Хороший результат",
    training_needs_practice: "Нужна тренировка",
    map_error: "Партия остановлена"
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function percent(correct, seen) {
    if (!seen) {
      return "0%";
    }
    return String(Math.round((correct / seen) * 100)) + "%";
  }

  function nowIso() {
    return new Date().toISOString();
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
    return Storage.isAvailable()
      ? "localStorage доступен"
      : "localStorage недоступен, используется память вкладки";
  }

  function getQuestionById(questionId) {
    var questions = asArray(DATA.questions);
    for (var i = 0; i < questions.length; i += 1) {
      if (questions[i] && String(questions[i].id) === String(questionId)) {
        return questions[i];
      }
    }
    return null;
  }

  function getValidQuestions() {
    if (validation && Array.isArray(validation.validQuestions)) {
      return validation.validQuestions;
    }
    return asArray(DATA.questions);
  }

  function getValidQuestionById(questionId) {
    var questions = getValidQuestions();
    for (var i = 0; i < questions.length; i += 1) {
      if (questions[i] && String(questions[i].id) === String(questionId)) {
        return questions[i];
      }
    }
    return null;
  }

  function getTermById(termId) {
    var terms = asArray(DATA.terms);
    for (var i = 0; i < terms.length; i += 1) {
      if (terms[i] && String(terms[i].id) === String(termId)) {
        return terms[i];
      }
    }
    return null;
  }

  function termLabel(termId) {
    var term = getTermById(termId);
    if (!term) {
      return String(termId || "");
    }
    return term.term || term.id;
  }

  function getOptionText(question, optionId) {
    var options = asArray(question && question.options);
    for (var i = 0; i < options.length; i += 1) {
      if (options[i] && String(options[i].id) === String(optionId)) {
        return options[i].text || options[i].label || options[i].id;
      }
    }
    return String(optionId || "");
  }

  function getItemText(question, itemId) {
    var items = asArray(question && question.items);
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && String(items[i].id) === String(itemId)) {
        return items[i].text || items[i].label || items[i].id;
      }
    }
    return String(itemId || "");
  }

  function getCategoryId(category) {
    return typeof category === "string" ? category : category && category.id;
  }

  function getCategoryLabel(category) {
    return typeof category === "string" ? category : category && (category.label || category.text || category.id);
  }

  function getCategoryLabelById(question, categoryId) {
    var categories = asArray(question && question.categories);
    for (var i = 0; i < categories.length; i += 1) {
      if (String(getCategoryId(categories[i])) === String(categoryId)) {
        return getCategoryLabel(categories[i]) || String(categoryId || "");
      }
    }
    return String(categoryId || "");
  }

  function getPairSide(pair, left) {
    if (Array.isArray(pair)) {
      return left ? pair[0] : pair[1];
    }
    if (!pair) {
      return "";
    }
    return left
      ? (pair.leftId || pair.left || pair.source || pair.term || "")
      : (pair.rightId || pair.right || pair.target || pair.match || "");
  }

  function hashString(value) {
    var hash = 0;
    var text = String(value || "");
    for (var i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function stableShuffle(values, seed) {
    var result = values.slice();
    var base = hashString(seed);
    for (var i = result.length - 1; i > 0; i -= 1) {
      var j = (base + i * 17 + hashString(result[i])) % (i + 1);
      var temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }
    return result;
  }

  function questionTitle(question) {
    if (!question) {
      return "";
    }
    return question.title || question.questionDe || question.questionRu || question.id;
  }

  function syncGlobals() {
    settings = Storage.loadSettings();
    progress = Storage.loadProgress();
    validation = Engine.validateData(DATA, { log: true });
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
    var validQuestions = Array.isArray(validation.validQuestions) ? validation.validQuestions.length : totalQuestions;

    if (totalQuestions === 0) {
      return '<div class="notice notice-info">Банк вопросов пока пуст. Каркас запускается в режиме оболочки; данные будут добавлены следующим промптом.</div>';
    }
    if (errors || warnings) {
      return '<div class="notice notice-warn">В банке вопросов найдены ошибки: ' + errors + ', предупреждения: ' + warnings + '. Подробности в консоли.</div>';
    }
    return '<div class="notice notice-ok">Банк вопросов проверен: ' + validQuestions + ' из ' + totalQuestions + ' заданий доступны для игры.</div>';
  }

  function renderStorageNotices(savedGame) {
    var notices = [];
    var diagnostics = Storage.getDiagnostics ? Storage.getDiagnostics() : {};

    if (!Storage.isAvailable()) {
      notices.push('<div class="notice notice-warn">Сохранение в браузере недоступно. Прогресс сохранится только до закрытия вкладки.</div>');
    }
    if (diagnostics.currentGameReset) {
      notices.push(
        '<div class="notice notice-warn resume-card">' +
          '<div><strong>Сохраненная партия сброшена.</strong><p>' + esc(diagnostics.currentGameResetReason || "Не удалось восстановить текущую игру.") + '</p></div>' +
          '<button class="primary-btn" type="button" id="ackStorageReset">Начать новую игру</button>' +
        '</div>'
      );
    }
    if (diagnostics.progressFallback) {
      notices.push('<div class="notice notice-warn">Файл прогресса поврежден. Приложение запущено с пустым прогрессом.</div>');
    }
    if (savedGame && savedGame.status === "playing") {
      notices.push(
        '<div class="notice notice-info resume-card">' +
          '<div><strong>Есть незавершенная партия.</strong><p>' +
            esc(MODE_LABELS[savedGame.topicMode] || savedGame.topicMode) +
            ', ход ' + esc(savedGame.turns || 0) + ' из ' + esc(savedGame.maxTurns || "?") +
          '</p></div>' +
          '<div class="action-row">' +
            '<button class="primary-btn" type="button" id="resumeGame">Продолжить игру</button>' +
            '<button class="soft-btn" type="button" id="restartGame">Начать заново</button>' +
            '<button class="danger-btn" type="button" id="discardGame">Сбросить сохраненную партию</button>' +
          '</div>' +
        '</div>'
      );
    }

    return notices.join("");
  }

  function renderStart() {
    setHeader("Старт", "Настрой тему, карту и режим тренировки");
    var savedGame = Storage.loadCurrentGame();
    var modeOptions = ["luft", "wasser", "gemischt", "fehler"].map(function renderMode(mode) {
      var checked = settings.topicMode === mode ? " checked" : "";
      return '<label class="segment"><input type="radio" name="topicMode" value="' + mode + '"' + checked + '><span>' + esc(MODE_LABELS[mode]) + '</span></label>';
    }).join("");

    app.innerHTML = '' +
      '<section class="start-layout">' +
        '<form class="panel settings-panel" id="settingsForm">' +
          '<div class="panel-head"><div><p class="eyebrow">Chemie-Eroberung</p><h1>Тренажер по химии</h1></div><span class="storage-pill">' + esc(storageLabel()) + '</span></div>' +
          renderDataStatus() +
          renderStorageNotices(savedGame) +
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
    drawPreviewMap();
  }

  function wireStartScreen() {
    byId("settingsForm").addEventListener("change", function onSettingsChange() {
      saveSettingsFromForm(true);
      drawPreviewMap();
    });
    byId("settingsForm").addEventListener("input", function onSettingsInput(event) {
      if (event.target && (event.target.id === "totalHexes" || event.target.id === "playerStartHexes")) {
        saveSettingsFromForm(true);
        drawPreviewMap();
      }
    });
    byId("startGame").addEventListener("click", function startFromForm() {
      beginGame();
    });
    byId("resetProgress").addEventListener("click", function resetProgress() {
      progress = Storage.resetAll();
      showStatus("Прогресс сброшен. Настройки сохранены.", "ok");
      renderStart();
    });

    var resume = byId("resumeGame");
    if (resume) {
      resume.addEventListener("click", function resumeGame() {
        var game = Storage.loadCurrentGame();
        if (game && game.status === "playing") {
          game.restoredQuestion = Boolean(game.currentQuestionId);
          game.updatedAt = nowIso();
          Storage.saveCurrentGame(game);
          setRoute("game");
        }
      });
    }

    var restart = byId("restartGame");
    if (restart) {
      restart.addEventListener("click", function restartGame() {
        Storage.clearCurrentGame();
        beginGame();
      });
    }

    var discard = byId("discardGame");
    if (discard) {
      discard.addEventListener("click", function discardGame() {
        Storage.clearCurrentGame();
        showStatus("Сохраненная партия удалена.", "ok");
        renderStart();
      });
    }

    var ack = byId("ackStorageReset");
    if (ack) {
      ack.addEventListener("click", function acknowledgeReset() {
        if (Storage.clearDiagnostics) {
          Storage.clearDiagnostics();
        }
        showStatus("Можно начать новую игру.", "ok");
      });
    }

    wireLocalRouteButtons();
  }

  function buildPoolForSettings(sourceSettings) {
    return Engine.buildQuestionPool(DATA, sourceSettings, progress, validation);
  }

  function buildPoolForGame(game) {
    var poolIds = Array.isArray(game && game.questionPoolIds) ? game.questionPoolIds.map(String) : [];
    if (poolIds.length === 0) {
      return buildPoolForSettings(game.settings || settings);
    }

    return poolIds.map(function mapId(id) {
      return getValidQuestionById(id);
    }).filter(Boolean);
  }

  function beginGame(forceSettings) {
    if (byId("settingsForm")) {
      saveSettingsFromForm(true);
    } else if (forceSettings) {
      settings = Storage.saveSettings(forceSettings).settings;
    } else {
      settings = Storage.loadSettings();
    }

    progress = Storage.loadProgress();
    validation = Engine.validateData(DATA, { log: true });

    if (settings.topicMode === "fehler" && progress.mistakeIds.length === 0) {
      setRoute("fehler");
      return;
    }

    var pool = buildPoolForSettings(settings);
    if (Array.isArray(DATA.questions) && DATA.questions.length > 0 && pool.length === 0) {
      showStatus("Нет вопросов для выбранных фильтров. Измени тему или типы заданий.", "warn");
      return;
    }

    var map = MapGenerator.generate(settings.totalHexes, settings.playerStartHexes);
    var queueState = Engine.createQuestionQueue(pool, progress, {
      settings: settings
    });

    Storage.saveCurrentGame({
      version: 2,
      status: "playing",
      phase: "question",
      topicMode: settings.topicMode,
      enabledTypes: settings.enabledTypes,
      settings: clone(settings),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      map: map,
      questionPoolIds: queueState.questionPool,
      questionQueue: queueState.questionQueue,
      queueCursor: queueState.queueCursor,
      round: queueState.round,
      currentQuestionId: null,
      answerSubmitted: false,
      restoredQuestion: false,
      repeatedQuestionRound: false,
      turns: 0,
      maxTurns: queueState.maxTurns,
      correct: 0,
      incorrect: 0,
      consecutiveIncorrect: 0,
      overtime: 0,
      lastFeedback: null,
      result: null
    });
    setRoute("game");
  }

  function drawPreviewMap() {
    if (!MapGenerator || !MapRenderer || !byId("game-map")) {
      return;
    }
    var map = MapGenerator.generate(settings.totalHexes, settings.playerStartHexes);
    renderMap(map);
  }

  function renderMap(map) {
    if (!MapRenderer || !map || !byId("game-map")) {
      return;
    }

    MapRenderer.render(map, byId("game-map"));
    var borderIds = MapGenerator.getBorderRegions(map.regions, "player").map(function getId(region) {
      return region.id;
    });
    MapRenderer.highlightBorder(borderIds);
    updateMapCounters(map);
  }

  function updateMapCounters(map) {
    var systemNode = byId("system-territories");
    var playerNode = byId("player-territories");
    var totalNode = byId("total-territories");
    var playerCount = countOwner(map, "player");
    var systemCount = countOwner(map, "computer");
    var total = map && Array.isArray(map.regions) ? map.regions.length : 0;

    if (playerNode) {
      playerNode.textContent = String(playerCount);
    }
    if (systemNode) {
      systemNode.textContent = String(systemCount);
    }
    if (totalNode) {
      totalNode.textContent = String(total);
    }
  }

  function countOwner(map, owner) {
    if (!map || !Array.isArray(map.regions)) {
      return 0;
    }
    return map.regions.filter(function byOwner(region) {
      return region && region.owner === owner;
    }).length;
  }

  function getGamePoolQueue(game) {
    var pool = buildPoolForGame(game);
    return Engine.createQuestionQueue(pool, progress, game);
  }

  function ensureCurrentQuestion(game) {
    if (!game || game.status !== "playing") {
      return null;
    }
    if (game.phase === "feedback" || game.phase === "practice_feedback") {
      return getQuestionById(game.currentQuestionId);
    }
    if (game.currentQuestionId) {
      return getQuestionById(game.currentQuestionId);
    }

    var queue = getGamePoolQueue(game);
    var question = Engine.getNextQuestion(queue);
    if (!question) {
      finishGame(game, "map_error", "Не удалось получить следующий вопрос.");
      return null;
    }

    game.questionPoolIds = queue.questionPool;
    game.questionQueue = queue.questionQueue;
    game.queueCursor = queue.queueCursor;
    game.round = queue.round;
    game.repeatedQuestionRound = Boolean(queue.repeated);
    game.currentQuestionId = question.id;
    game.answerSubmitted = false;
    game.currentQuestionStartedAt = nowIso();
    game.currentQuestionOvertime = false;
    game.restoredQuestion = false;
    game.updatedAt = nowIso();
    Storage.saveCurrentGame(game);
    return question;
  }

  function renderGame() {
    var game = Storage.loadCurrentGame();
    if (!game) {
      renderNoGame();
      return;
    }
    if (game.status === "finished") {
      renderResult(game);
      return;
    }

    settings = game.settings ? Storage.normalizeSettings(game.settings).settings : settings;
    var question = ensureCurrentQuestion(game);
    if (!question || game.status === "finished") {
      renderResult(game);
      return;
    }

    setHeader("Игра", "Ответы меняют карту и сохраняются после каждого хода");
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
          renderGameAside(game, question) +
        '</aside>' +
      '</section>';

    renderMap(game.map);
    wireGameScreen(game, question);
  }

  function renderGameAside(game, question) {
    if (game.phase === "feedback" || game.phase === "practice_feedback") {
      return renderFeedback(game, question);
    }
    return renderQuestion(game, question);
  }

  function renderQuestionMeta(question) {
    var chips = [];
    if (question.subtopic) {
      chips.push("Subtopic: " + question.subtopic);
    }
    if (question.difficulty != null && question.difficulty !== "") {
      chips.push("Niveau " + question.difficulty);
    }
    asArray(question.tags).forEach(function addTag(tag) {
      chips.push(String(tag));
    });

    return chips.length
      ? '<div class="meta-chips">' + chips.map(function chip(text) {
        return '<span>' + esc(text) + '</span>';
      }).join("") + '</div>'
      : "";
  }

  function renderRelatedTermsButton(question, id, options) {
    options = options || {};
    var label = options.label || "Открыть термины";
    var className = options.prominent ? "primary-btn terms-prominent" : "soft-btn";
    return asArray(question && question.relatedTerms).length
      ? '<button class="' + esc(className) + '" type="button" id="' + esc(id) + '">' + esc(label) + '</button>'
      : "";
  }

  function timerWarningText(game, question) {
    if (question && question.type === "short_answer" && game && game.settings && game.settings.timerMode === "hard" && !game.settings.hardTimerForShortAnswer) {
      return "Время вышло. Для short_answer строгий таймер отключен, поэтому можно сравнить ответ с образцом и принять решение.";
    }
    return "Время вышло. В soft-режиме можно ответить дальше, ответ будет отмечен как overtime.";
  }

  function renderQuestion(game, question) {
    var progressStats = progress.perQuestion && progress.perQuestion[question.id] ? progress.perQuestion[question.id] : null;
    var modeText = game.phase === "practice" ? "Учебная попытка" : (MODE_LABELS[game.topicMode] || game.topicMode);
    var repeated = game.repeatedQuestionRound
      ? '<div class="notice notice-info">Уникальные вопросы этой темы закончились - дальше идут повторения для закрепления.</div>'
      : "";
    var restored = game.restoredQuestion
      ? '<div class="notice notice-info">Вопрос восстановлен после перезагрузки. Таймер начался заново.</div>'
      : "";
    var timerWarning = game.currentQuestionOvertime
      ? '<div class="notice notice-warn" id="timer-warning">' + esc(timerWarningText(game, question)) + '</div>'
      : '<div class="notice notice-warn" id="timer-warning" hidden></div>';

    return '' +
      '<p class="eyebrow">' + esc(modeText) + ' · ' + esc(TYPE_LABELS[question.type] || question.type) + ' · ' + esc(question.id) + '</p>' +
      '<h2 lang="de">' + esc(question.questionDe) + '</h2>' +
      '<p class="question-ru">' + esc(question.questionRu) + '</p>' +
      (question.instructionRu ? '<p class="muted">' + esc(question.instructionRu) + '</p>' : "") +
      renderQuestionMeta(question) +
      restored +
      repeated +
      timerWarning +
      renderAnswerUi(question) +
      '<div class="progress-strip">' +
        '<span>Ход: ' + esc(game.turns) + ' / ' + esc(game.maxTurns) + '</span>' +
        '<span>Верно в партии: ' + esc(game.correct || 0) + '</span>' +
        '<span>Ошибки в партии: ' + esc(game.incorrect || 0) + '</span>' +
        (progressStats ? '<span>Этот вопрос: ' + esc(progressStats.correct) + '/' + esc(progressStats.seen) + '</span>' : "") +
      '</div>' +
      '<div class="action-row">' +
        '<button class="soft-btn" type="button" id="showCorrectAnswer">Показать правильный ответ</button>' +
        renderRelatedTermsButton(question, "openQuestionTerms") +
        '<button class="soft-btn" type="button" data-local-route="dictionary">Словарь</button>' +
        '<button class="soft-btn" type="button" data-local-route="start">На старт</button>' +
      '</div>';
  }

  function renderAnswerUi(question) {
    if (question.type === "single_choice") {
      return '<div class="answer-list">' + asArray(question.options).map(function renderOption(option) {
        return '<button class="answer-option" type="button" data-answer-id="' + esc(option.id) + '">' +
          '<span class="answer-letter">' + esc(option.id) + '</span>' +
          '<span>' + esc(option.text || option.label || option.id) + '</span>' +
        '</button>';
      }).join("") + '</div>';
    }

    if (question.type === "multiple_choice") {
      return renderMultipleChoiceUi(question);
    }
    if (question.type === "matching") {
      return renderMatchingUi(question);
    }
    if (question.type === "fill_blank") {
      return renderFillBlankUi(question);
    }
    if (question.type === "ordering") {
      return renderOrderingUi(question);
    }
    if (question.type === "true_false") {
      return renderTrueFalseUi(question);
    }
    if (question.type === "categorization") {
      return renderCategorizationUi(question);
    }
    if (question.type === "short_answer") {
      return renderShortAnswerUi(question);
    }

    return '<div class="notice notice-warn">Для типа `' + esc(question.type) + '` пока нет рендера.</div>';
  }

  function renderSubmitRow(extraButton, submitLabel) {
    return '<div class="action-row answer-actions">' +
      '<button class="primary-btn" type="submit" id="submitAnswer">' + esc(submitLabel || "Проверить") + '</button>' +
      (extraButton || "") +
    '</div>';
  }

  function renderMultipleChoiceUi(question) {
    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="multiple_choice">' +
        '<div class="answer-list">' + asArray(question.options).map(function renderOption(option) {
          return '<label class="answer-option answer-check">' +
            '<input type="checkbox" name="answerOption" value="' + esc(option.id) + '">' +
            '<span class="answer-letter">' + esc(option.id) + '</span>' +
            '<span>' + esc(option.text || option.label || option.id) + '</span>' +
          '</label>';
        }).join("") + '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderMatchingUi(question) {
    var pairs = asArray(question.pairs);
    var rightValues = stableShuffle(pairs.map(function right(pair) {
      return getPairSide(pair, false);
    }), question.id + ":matching");

    return '' +
      '<form id="answerForm" class="answer-form matching-form" data-answer-type="matching">' +
        '<div class="matching-grid">' + pairs.map(function renderPair(pair, index) {
          var left = getPairSide(pair, true);
          return '<label class="matching-row">' +
            '<span class="matching-left">' + esc(left) + '</span>' +
            '<select required data-match-left="' + esc(left) + '" aria-label="Пара для ' + esc(left) + '">' +
              '<option value="">Выбери пару</option>' +
              rightValues.map(function option(right) {
                return '<option value="' + esc(right) + '">' + esc(right) + '</option>';
              }).join("") +
            '</select>' +
          '</label>';
        }).join("") + '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderFillBlankTemplate(question) {
    var blanks = asArray(question.blanks);
    var template = String(question.template || "");
    var parts = template.split("___");
    var html = "";

    parts.forEach(function renderPart(part, index) {
      html += esc(part);
      if (index < parts.length - 1) {
        var blank = blanks[index] || { id: "blank_" + String(index + 1) };
        html += '<input class="blank-input" type="text" autocomplete="off" data-blank-id="' + esc(blank.id || index) + '" aria-label="Пропуск ' + esc(index + 1) + '" required>';
      }
    });

    if (parts.length === 1) {
      html += blanks.map(function renderBlank(blank, index) {
        return '<label class="field blank-field"><span>' + esc(blank.id || ("Пропуск " + String(index + 1))) + '</span>' +
          '<input class="blank-input" type="text" autocomplete="off" data-blank-id="' + esc(blank.id || index) + '" required></label>';
      }).join("");
    }

    return html;
  }

  function renderFillBlankUi(question) {
    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="fill_blank">' +
        '<div class="fill-template">' + renderFillBlankTemplate(question) + '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderOrderingUi(question) {
    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="ordering">' +
        '<div class="ordering-builder">' +
          '<section class="ordering-column">' +
            '<h3>Банк элементов</h3>' +
            '<div class="ordering-bank">' + asArray(question.items).map(function renderItem(item) {
              return '<button class="soft-btn order-chip" type="button" data-order-pick="' + esc(item.id) + '">' + esc(item.text || item.label || item.id) + '</button>';
            }).join("") + '</div>' +
          '</section>' +
          '<section class="ordering-column">' +
            '<h3>Текущий ответ</h3>' +
            '<div id="orderingAnswer" class="ordering-answer" aria-live="polite"><p class="muted empty-answer">Пока ничего не выбрано.</p></div>' +
            '<button class="soft-btn" type="button" id="resetOrdering">Сбросить порядок</button>' +
          '</section>' +
        '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderTrueFalseUi(question) {
    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="true_false">' +
        '<div class="tf-list">' + asArray(question.statements).map(function renderStatement(statement) {
          var groupName = "tf_" + String(question.id) + "_" + String(statement.id);
          return '<fieldset class="tf-statement">' +
            '<legend>' + esc(statement.text) + '</legend>' +
            '<label><input type="radio" name="' + esc(groupName) + '" data-statement-id="' + esc(statement.id) + '" value="true" required> richtig</label>' +
            '<label><input type="radio" name="' + esc(groupName) + '" data-statement-id="' + esc(statement.id) + '" value="false" required> falsch</label>' +
          '</fieldset>';
        }).join("") + '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderCategorizationUi(question) {
    var categories = asArray(question.categories);
    var categoryOptions = categories.map(function renderCategoryOption(category) {
      return '<option value="' + esc(getCategoryId(category)) + '">' + esc(getCategoryLabel(category)) + '</option>';
    }).join("");

    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="categorization">' +
        '<div class="category-zones">' + categories.map(function renderZone(category) {
          return '<section class="category-zone" data-category-zone="' + esc(getCategoryId(category)) + '">' +
            '<h3>' + esc(getCategoryLabel(category)) + '</h3>' +
            '<div class="category-zone-items"><p class="muted">Пока пусто</p></div>' +
          '</section>';
        }).join("") + '</div>' +
        '<div class="category-item-list">' + asArray(question.items).map(function renderItem(item) {
          return '<label class="category-item-row">' +
            '<span>' + esc(item.text || item.label || item.id) + '</span>' +
            '<select required data-category-item="' + esc(item.id) + '" data-category-label="' + esc(item.text || item.label || item.id) + '">' +
              '<option value="">Выбери категорию</option>' + categoryOptions +
            '</select>' +
          '</label>';
        }).join("") + '</div>' +
        renderSubmitRow("") +
      '</form>';
  }

  function renderShortAnswerUi(question) {
    return '' +
      '<form id="answerForm" class="answer-form" data-answer-type="short_answer">' +
        '<label class="field"><span>Короткий ответ по-немецки</span><textarea id="shortAnswerInput" rows="5" placeholder="Schreibe deine Antwort..."></textarea></label>' +
        '<div class="notice notice-info">Сначала напиши немецкий ответ, потом сравни его с образцом и честно реши, засчитывать ли попытку.</div>' +
        renderSubmitRow("", "Сравнить с образцом") +
        '<div id="shortAnswerCheckResult" class="short-answer-review-slot" aria-live="polite"></div>' +
      '</form>';
  }

  function getShortAnswerInputValue() {
    var input = byId("shortAnswerInput");
    return input ? input.value : "";
  }

  function formatShortAnswerGroup(group) {
    var label = group && group.id ? group.id + ": " : "";
    var terms = asArray(group && group.accepted);
    return label + (terms.length ? terms.join(" / ") : "нет списка терминов");
  }

  function renderShortAnswerGroupList(groups, emptyText, found) {
    var list = asArray(groups);
    if (list.length === 0) {
      return '<p class="muted">' + esc(emptyText) + '</p>';
    }
    return '<div class="short-answer-term-grid">' + list.map(function renderGroup(group) {
      var main = found && asArray(group.foundTerms).length
        ? asArray(group.foundTerms).join(" / ")
        : formatShortAnswerGroup(group);
      var detail = found
        ? "Группа: " + formatShortAnswerGroup(group)
        : "Можно использовать один из вариантов группы.";
      return '<article class="short-answer-term-card">' +
        '<strong>' + esc(main) + '</strong>' +
        '<span>' + esc(detail) + '</span>' +
      '</article>';
    }).join("") + '</div>';
  }

  function renderShortAnswerComparison(question, answer) {
    var analysis = Engine.analyzeShortAnswer(question, answer);
    var criteria = asArray(question.criteria);
    var warning = !analysis.empty && !analysis.passesTermThreshold
      ? '<div class="notice notice-warn short-answer-warning">' + esc(SHORT_ANSWER_WARNING_TEXT) + '</div>'
      : "";
    var emptyWarning = analysis.empty
      ? '<div class="notice notice-warn short-answer-empty-guard">' + esc(EMPTY_SHORT_ANSWER_TEXT) + '</div>'
      : '<div class="notice notice-warn short-answer-empty-guard" hidden></div>';

    return '' +
      '<section class="short-answer-review">' +
        '<h3>Сравнение с образцом</h3>' +
        emptyWarning +
        warning +
        '<div class="sample-answer"><h4>Sample answer</h4><p lang="de">' + esc(question.sampleAnswer || "") + '</p></div>' +
        '<div class="sample-answer"><h4>Criteria</h4>' +
          (criteria.length ? '<ul>' + criteria.map(function item(text) {
            return '<li>' + esc(text) + '</li>';
          }).join("") + '</ul>' : '<p class="muted">Критерии не указаны.</p>') +
        '</div>' +
        '<div class="short-answer-columns">' +
          '<section><h4>Найденные Fachbegriffe (' + esc(analysis.foundCount) + '/' + esc(analysis.requiredCount) + ')</h4>' +
            renderShortAnswerGroupList(analysis.foundGroups, "Пока не найдено ни одной обязательной группы.", true) +
          '</section>' +
          '<section><h4>Ненайденные Fachbegriffe</h4>' +
            renderShortAnswerGroupList(analysis.missingGroups, "Все обязательные группы найдены.", false) +
          '</section>' +
        '</div>' +
        '<div class="action-row">' +
          '<button class="primary-btn" type="button" id="acceptShortAnswer">Да, засчитать</button>' +
          '<button class="danger-btn" type="button" id="rejectShortAnswer">Нет, не засчитывать</button>' +
        '</div>' +
      '</section>';
  }

  function showShortAnswerEmptyGuard() {
    var guard = global.document.querySelector(".short-answer-empty-guard");
    if (guard) {
      guard.hidden = false;
      guard.textContent = EMPTY_SHORT_ANSWER_TEXT;
    }
    var input = byId("shortAnswerInput");
    if (input && typeof input.focus === "function") {
      input.focus();
    }
  }

  function submitShortAnswerDecision(question, accepted) {
    var answer = getShortAnswerInputValue();
    var analysis = Engine.analyzeShortAnswer(question, answer);
    if (accepted && analysis.empty) {
      showShortAnswerEmptyGuard();
      return;
    }

    handleAnswer(answer, {
      forceCorrect: Boolean(accepted),
      reason: accepted ? "self_accepted" : "self_rejected",
      selfAssessment: true,
      selfOverride: Boolean(accepted && !analysis.passesTermThreshold),
      shortAnswerAnalysis: analysis
    });
  }

  function updateShortAnswerComparison(question) {
    var target = byId("shortAnswerCheckResult");
    if (!target) {
      return;
    }
    target.innerHTML = renderShortAnswerComparison(question, getShortAnswerInputValue());
    byId("acceptShortAnswer").addEventListener("click", function acceptAnswer() {
      submitShortAnswerDecision(question, true);
    });
    byId("rejectShortAnswer").addEventListener("click", function rejectAnswer() {
      submitShortAnswerDecision(question, false);
    });
  }

  function warnExplanationFallback(question) {
    if (!question || (question.explanationRu && question.explanationDe)) {
      return;
    }
    var key = question.id + ":explanation";
    if (loggedExplanationFallbacks[key]) {
      return;
    }
    loggedExplanationFallbacks[key] = true;
    if (global.console && global.console.warn) {
      global.console.warn(
        "[CHEMIE_DATA] question " + question.id + ": нет explanationRu или explanationDe, используется fallback.",
        question
      );
    }
  }

  function feedbackExplanationRu(question) {
    if (!question) {
      return "";
    }
    return question.explanationRu ||
      question.hint ||
      question.learningGoal ||
      ("Правильный ответ: " + Engine.formatCorrectAnswer(question));
  }

  function feedbackExplanationDe(question) {
    if (!question) {
      return "";
    }
    return question.explanationDe ||
      question.hint ||
      question.learningGoal ||
      ("Richtige Antwort: " + Engine.formatCorrectAnswer(question));
  }

  function renderTermChips(termIds) {
    var ids = asArray(termIds);
    return ids.length
      ? '<div class="term-chips">' + ids.map(function chip(termId) {
        return '<span>' + esc(termLabel(termId)) + '</span>';
      }).join("") + '</div>'
      : "";
  }

  function renderShortAnswerFeedbackDetails(feedback) {
    var analysis = feedback && feedback.shortAnswerAnalysis;
    if (!analysis) {
      return "";
    }
    return '' +
      '<div class="short-answer-feedback">' +
        '<h3>Самопроверка Fachbegriffe</h3>' +
        (feedback.selfOverride ? '<div class="notice notice-warn">Ответ засчитан учеником, хотя автопроверка нашла меньше терминов, чем ожидалось.</div>' : "") +
        '<div class="short-answer-columns">' +
          '<section><h4>Найдено (' + esc(analysis.foundCount) + '/' + esc(analysis.requiredCount) + ')</h4>' +
            renderShortAnswerGroupList(analysis.foundGroups, "Не найдено обязательных групп.", true) +
          '</section>' +
          '<section><h4>Стоит повторить</h4>' +
            renderShortAnswerGroupList(analysis.missingGroups, "Все обязательные группы найдены.", false) +
          '</section>' +
        '</div>' +
      '</div>';
  }

  function renderFeedback(game, question) {
    var feedback = game.lastFeedback || {};
    var correct = Boolean(feedback.correct);
    var kind = correct ? "notice-ok" : "notice-warn";
    var title = correct
      ? (feedback.reason === "self_accepted" ? "Самооценка засчитана" : (feedback.practice ? "Учебная попытка засчитана" : "Правильно"))
      : (feedback.reason === "timeout" ? "Время вышло" : (feedback.reason === "self_rejected" ? "Ответ не засчитан" : "Разбор ошибки"));
    var related = asArray(question && question.relatedTerms);
    var mistakeStreak = Math.max(0, Math.round(Number(feedback.consecutiveIncorrect) || 0));
    var prominentTerms = !correct && mistakeStreak >= 2;
    var practiceLabel = mistakeStreak >= 3 ? "Учебный раунд без потери территории" : "Потренировать похожий";
    warnExplanationFallback(question);

    return '' +
      '<p class="eyebrow">' + esc(question ? question.id : "") + ' · ' + esc(feedback.practice ? "Учебный режим" : "Итог хода") + '</p>' +
      '<div class="notice ' + kind + '"><strong>' + esc(title) + '</strong><p>' + esc(feedback.summary || "") + '</p></div>' +
      (!correct && mistakeStreak >= 3 ? '<div class="notice notice-info">Три ошибки подряд: можно сделать учебный раунд без потери территории.</div>' : "") +
      '<h2 lang="de">' + esc(question ? question.questionDe : "") + '</h2>' +
      '<dl class="feedback-list">' +
        '<dt>Ответ ученика</dt><dd>' + esc(feedback.submittedAnswer || "нет ответа") + '</dd>' +
        '<dt>Правильный ответ</dt><dd>' + esc(feedback.correctAnswer || "") + '</dd>' +
        '<dt>Объяснение</dt><dd>' + esc(feedbackExplanationRu(question)) + '</dd>' +
        '<dt>Kurz auf Deutsch</dt><dd>' + esc(feedbackExplanationDe(question)) + '</dd>' +
        '<dt>Цель</dt><dd>' + esc((question && question.learningGoal) || "Закрепить правильный ответ и связанные термины.") + '</dd>' +
      '</dl>' +
      renderShortAnswerFeedbackDetails(feedback) +
      renderTermChips(related) +
      '<div class="action-row">' +
        renderRelatedTermsButton(question, "openFeedbackTerms", {
          prominent: prominentTerms,
          label: prominentTerms ? "Открыть связанные термины" : "Открыть термины"
        }) +
        (!correct && !feedback.practice ? '<button class="soft-btn" type="button" id="practiceSimilar">' + esc(practiceLabel) + '</button>' : "") +
        '<button class="primary-btn" type="button" id="continueGame">' + esc(feedback.practice ? "Продолжить партию" : "Продолжить") + '</button>' +
      '</div>';
  }

  function wireGameScreen(game, question) {
    answerLocked = false;
    wireLocalRouteButtons();
    wireRelatedTermsButton("openQuestionTerms", question);
    wireRelatedTermsButton("openFeedbackTerms", question);

    if (game.phase === "feedback" || game.phase === "practice_feedback") {
      var continueButton = byId("continueGame");
      if (continueButton) {
        continueButton.addEventListener("click", continueAfterFeedback);
      }
      var practiceButton = byId("practiceSimilar");
      if (practiceButton) {
        practiceButton.addEventListener("click", startPracticeQuestion);
      }
      if (Timer) {
        Timer.reset();
      }
      return;
    }

    wireOrderingControls(question);
    wireCategorizationControls(question);

    global.document.querySelectorAll("[data-answer-id]").forEach(function wireAnswer(button) {
      button.addEventListener("click", function submitAnswer() {
        handleAnswer(button.getAttribute("data-answer-id"), {});
      });
    });

    var answerForm = byId("answerForm");
    if (answerForm) {
      answerForm.addEventListener("submit", function submitForm(event) {
        event.preventDefault();
        if (question.type === "short_answer") {
          updateShortAnswerComparison(question);
          return;
        }
        if (typeof answerForm.reportValidity === "function" && !answerForm.reportValidity()) {
          return;
        }
        handleAnswer(collectAnswer(question), {});
      });
    }

    var showCorrect = byId("showCorrectAnswer");
    if (showCorrect) {
      showCorrect.addEventListener("click", function revealAnswer() {
        handleAnswer(null, { forceCorrect: false, reason: "revealed" });
      });
    }

    startTimerForQuestion(game, question);
  }

  function wireRelatedTermsButton(id, question) {
    var button = byId(id);
    if (!button) {
      return;
    }
    button.addEventListener("click", function openTerms() {
      dictionaryTermFilterIds = asArray(question && question.relatedTerms).map(String);
      setRoute("dictionary");
    });
  }

  function lockCurrentQuestionUi() {
    global.document.querySelectorAll(".question-panel button, .question-panel input, .question-panel select, .question-panel textarea").forEach(function disable(control) {
      control.disabled = true;
    });
  }

  function wireOrderingControls(question) {
    if (!question || question.type !== "ordering" || !byId("orderingAnswer")) {
      return;
    }
    var selected = [];

    function renderSelected() {
      var answerNode = byId("orderingAnswer");
      if (!answerNode) {
        return;
      }
      answerNode.innerHTML = selected.length
        ? selected.map(function renderItem(itemId, index) {
          return '<button class="order-answer-chip" type="button" data-order-remove="' + esc(itemId) + '">' +
            '<span>' + esc(index + 1) + '</span>' + esc(getItemText(question, itemId)) +
          '</button>';
        }).join("")
        : '<p class="muted empty-answer">Пока ничего не выбрано.</p>';

      global.document.querySelectorAll("[data-order-pick]").forEach(function update(button) {
        button.disabled = selected.indexOf(button.getAttribute("data-order-pick")) !== -1;
      });
      answerNode.querySelectorAll("[data-order-remove]").forEach(function wireRemove(button) {
        button.addEventListener("click", function removeItem() {
          selected = selected.filter(function keep(itemId) {
            return itemId !== button.getAttribute("data-order-remove");
          });
          renderSelected();
        });
      });
    }

    global.document.querySelectorAll("[data-order-pick]").forEach(function wirePick(button) {
      button.addEventListener("click", function pickItem() {
        var itemId = button.getAttribute("data-order-pick");
        if (selected.indexOf(itemId) === -1) {
          selected.push(itemId);
          renderSelected();
        }
      });
    });

    var reset = byId("resetOrdering");
    if (reset) {
      reset.addEventListener("click", function resetOrdering() {
        selected = [];
        renderSelected();
      });
    }
    renderSelected();
  }

  function wireCategorizationControls(question) {
    if (!question || question.type !== "categorization") {
      return;
    }

    function updateZones() {
      var grouped = {};
      global.document.querySelectorAll("[data-category-zone]").forEach(function reset(zone) {
        grouped[zone.getAttribute("data-category-zone")] = [];
      });
      global.document.querySelectorAll("[data-category-item]").forEach(function collect(select) {
        var categoryId = select.value;
        if (categoryId && grouped[categoryId]) {
          grouped[categoryId].push(select.getAttribute("data-category-label"));
        }
      });
      global.document.querySelectorAll("[data-category-zone]").forEach(function fill(zone) {
        var categoryId = zone.getAttribute("data-category-zone");
        var holder = zone.querySelector(".category-zone-items");
        var items = grouped[categoryId] || [];
        if (holder) {
          holder.innerHTML = items.length
            ? items.map(function chip(label) {
              return '<span class="category-chip">' + esc(label) + '</span>';
            }).join("")
            : '<p class="muted">Пока пусто</p>';
        }
      });
    }

    global.document.querySelectorAll("[data-category-item]").forEach(function wireSelect(select) {
      select.addEventListener("change", updateZones);
    });
    updateZones();
  }

  function collectAnswer(question) {
    if (!question) {
      return null;
    }
    if (question.type === "multiple_choice") {
      return Array.prototype.slice.call(global.document.querySelectorAll('input[name="answerOption"]:checked')).map(function selected(input) {
        return input.value;
      });
    }
    if (question.type === "matching") {
      var matching = {};
      global.document.querySelectorAll("[data-match-left]").forEach(function collect(select) {
        matching[select.getAttribute("data-match-left")] = select.value;
      });
      return matching;
    }
    if (question.type === "fill_blank") {
      var blanks = {};
      global.document.querySelectorAll("[data-blank-id]").forEach(function collect(input) {
        blanks[input.getAttribute("data-blank-id")] = input.value;
      });
      return blanks;
    }
    if (question.type === "ordering") {
      return Array.prototype.slice.call(global.document.querySelectorAll("#orderingAnswer [data-order-remove]")).map(function collect(button) {
        return button.getAttribute("data-order-remove");
      });
    }
    if (question.type === "true_false") {
      var statements = {};
      global.document.querySelectorAll("[data-statement-id]:checked").forEach(function collect(input) {
        statements[input.getAttribute("data-statement-id")] = input.value;
      });
      return statements;
    }
    if (question.type === "categorization") {
      var categories = {};
      global.document.querySelectorAll("[data-category-item]").forEach(function collect(select) {
        categories[select.getAttribute("data-category-item")] = select.value;
      });
      return categories;
    }
    if (question.type === "short_answer") {
      return byId("shortAnswerInput") ? byId("shortAnswerInput").value : "";
    }
    return null;
  }

  function startTimerForQuestion(game, question) {
    if (!Timer) {
      return;
    }
    Timer.reset();
    if (!game.settings.timerEnabled || !question) {
      return;
    }

    var seconds = game.settings.timerSecondsByType[question.type] || 60;
    var hard = game.settings.timerMode === "hard" && (question.type !== "short_answer" || game.settings.hardTimerForShortAnswer);
    Timer.start(seconds, hard, function onTimeUp() {
      var current = Storage.loadCurrentGame();
      if (!current || current.status !== "playing" || current.currentQuestionId !== question.id) {
        return;
      }
      if (hard) {
        handleAnswer(null, { forceCorrect: false, reason: "timeout", automatic: true });
        return;
      }
      current.currentQuestionOvertime = true;
      current.updatedAt = nowIso();
      Storage.saveCurrentGame(current);
      var warning = byId("timer-warning");
      if (warning) {
        warning.hidden = false;
        warning.textContent = timerWarningText(current, question);
      }
    });
  }

  function stopTimerAndGetElapsed() {
    if (!Timer) {
      return 0;
    }
    return Timer.stop();
  }

  function handleAnswer(answer, options) {
    options = options || {};
    if (answerLocked) {
      return;
    }
    answerLocked = true;
    lockCurrentQuestionUi();

    var game = Storage.loadCurrentGame();
    if (!game || game.status !== "playing") {
      answerLocked = false;
      return;
    }
    if ((game.phase !== "question" && game.phase !== "practice") || game.answerSubmitted) {
      return;
    }

    var question = getQuestionById(game.currentQuestionId);
    if (!question) {
      answerLocked = false;
      return;
    }

    game.answerSubmitted = true;
    game.updatedAt = nowIso();
    Storage.saveCurrentGame(game);

    var elapsedMs = stopTimerAndGetElapsed();
    var result = Object.prototype.hasOwnProperty.call(options, "forceCorrect")
      ? {
        correct: Boolean(options.forceCorrect),
        needsSelfCheck: question.type === "short_answer",
        isFinal: true,
        details: options.shortAnswerAnalysis || null
      }
      : Engine.checkAnswer(question, answer);

    if (game.phase === "practice") {
      applyPracticeAnswer(game, question, answer, result, options);
      return;
    }

    applyMainAnswer(game, question, answer, result, options, elapsedMs);
  }

  function applyPracticeAnswer(game, question, answer, result, options) {
    game.phase = "practice_feedback";
    game.lastFeedback = buildFeedback(question, answer, result, options, true, null);
    game.updatedAt = nowIso();
    Storage.saveCurrentGame(game);
    renderGame();
  }

  function applyMainAnswer(game, question, answer, result, options, elapsedMs) {
    var correct = Boolean(result.correct);
    var mapDelta = correct ? captureForCorrectAnswer(game) : loseForIncorrectAnswer(game);

    game.turns = Math.max(0, Math.round(Number(game.turns) || 0)) + 1;
    game.correct = Math.max(0, Math.round(Number(game.correct) || 0)) + (correct ? 1 : 0);
    game.incorrect = Math.max(0, Math.round(Number(game.incorrect) || 0)) + (correct ? 0 : 1);
    game.consecutiveIncorrect = correct
      ? 0
      : Math.max(0, Math.round(Number(game.consecutiveIncorrect) || 0)) + 1;
    if (game.currentQuestionOvertime) {
      game.overtime = Math.max(0, Math.round(Number(game.overtime) || 0)) + 1;
    }
    options.consecutiveIncorrect = game.consecutiveIncorrect;

    updateProgressAfterAnswer(question, correct, game, options, elapsedMs);

    game.phase = "feedback";
    game.lastFeedback = buildFeedback(question, answer, result, options, false, mapDelta);
    game.restoredQuestion = false;
    game.repeatedQuestionRound = false;
    game.updatedAt = nowIso();

    evaluateGameEnd(game, mapDelta);
    Storage.saveCurrentGame(game);
    renderGame();
  }

  function buildFeedback(question, answer, result, options, practice, mapDelta) {
    var correct = Boolean(result.correct);
    var reason = options.reason || (correct ? "correct" : "incorrect");
    var summary = "";

    if (practice) {
      summary = correct
        ? "Повторная попытка не меняет карту."
        : "Карта не меняется: это учебная попытка.";
    } else if (reason === "self_accepted") {
      summary = options.selfOverride
        ? "Ответ засчитан по самооценке. Автопроверка отметила недостающие Fachbegriffe, но решение ученика принято."
        : (mapDelta && mapDelta.regionId != null ? "Ответ засчитан по самооценке, захвачен гекс системы #" + mapDelta.regionId + "." : "Ответ засчитан по самооценке.");
    } else if (reason === "self_rejected") {
      summary = mapDelta && mapDelta.regionId != null
        ? "Потеряли территорию, но нашли тему для тренировки: гекс #" + mapDelta.regionId + "."
        : "Ответ не засчитан, тема добавлена в тренировку.";
    } else if (correct) {
      summary = mapDelta && mapDelta.regionId != null
        ? "Захвачен гекс системы #" + mapDelta.regionId + "."
        : "Ответ засчитан.";
    } else if (reason === "timeout") {
      summary = mapDelta && mapDelta.regionId != null
        ? "Строгий таймер засчитал ошибку, потерян гекс #" + mapDelta.regionId + "."
        : "Строгий таймер засчитал ошибку.";
    } else if (reason === "revealed") {
      summary = mapDelta && mapDelta.regionId != null
        ? "Ответ открыт до попытки, поэтому потерян гекс #" + mapDelta.regionId + "."
        : "Ответ открыт до попытки и засчитан как ошибка.";
    } else {
      summary = mapDelta && mapDelta.regionId != null
        ? "Потеряли территорию, но нашли тему для тренировки: гекс #" + mapDelta.regionId + "."
        : "Ответ засчитан как ошибка.";
    }

    return {
      questionId: question.id,
      correct: correct,
      practice: Boolean(practice),
      reason: reason,
      submittedAnswer: formatSubmittedAnswer(question, answer, options),
      correctAnswer: Engine.formatCorrectAnswer(question),
      summary: summary,
      mapDelta: mapDelta || null,
      selfAssessment: Boolean(options.selfAssessment),
      selfOverride: Boolean(options.selfOverride),
      shortAnswerAnalysis: options.shortAnswerAnalysis || result.details || null,
      consecutiveIncorrect: Math.max(0, Math.round(Number(options.consecutiveIncorrect) || 0))
    };
  }

  function formatSubmittedAnswer(question, answer, options) {
    options = options || {};
    if (options.reason === "timeout") {
      return "Время истекло";
    }
    if (options.reason === "revealed") {
      return "Открыт правильный ответ";
    }
    if (options.reason === "diagnostic") {
      return options.forceCorrect ? "Диагностика: верно" : "Диагностика: ошибка";
    }
    if (question.type === "single_choice") {
      var option = asArray(question.options).filter(function findOption(item) {
        return item && String(item.id) === String(answer);
      })[0];
      return option ? option.id + ": " + (option.text || option.label || option.id) : String(answer || "");
    }
    if (question.type === "multiple_choice") {
      return asArray(answer).map(function formatOption(optionId) {
        return optionId + ": " + getOptionText(question, optionId);
      }).join("; ") || "нет ответа";
    }
    if (question.type === "matching") {
      return Object.keys(answer || {}).map(function formatPair(left) {
        return left + " → " + (answer[left] || "не выбрано");
      }).join("; ") || "нет ответа";
    }
    if (question.type === "fill_blank") {
      return asArray(question.blanks).map(function formatBlank(blank, index) {
        var key = blank && blank.id ? blank.id : String(index);
        return (blank && blank.id ? blank.id : "Пропуск " + String(index + 1)) + ": " + ((answer && answer[key]) || "пусто");
      }).join("; ");
    }
    if (question.type === "ordering") {
      return asArray(answer).map(function formatItem(itemId) {
        return getItemText(question, itemId);
      }).join(" → ") || "нет ответа";
    }
    if (question.type === "true_false") {
      return asArray(question.statements).map(function formatStatement(statement) {
        var value = answer && answer[statement.id];
        return statement.text + " — " + (value === "true" || value === true ? "richtig" : (value === "false" || value === false ? "falsch" : "не выбрано"));
      }).join("; ");
    }
    if (question.type === "categorization") {
      var grouped = {};
      Object.keys(answer || {}).forEach(function groupItem(itemId) {
        var categoryId = answer[itemId] || "не выбрано";
        if (!grouped[categoryId]) {
          grouped[categoryId] = [];
        }
        grouped[categoryId].push(getItemText(question, itemId));
      });
      return Object.keys(grouped).map(function formatGroup(categoryId) {
        var label = categoryId === "не выбрано" ? categoryId : getCategoryLabelById(question, categoryId);
        return label + ": " + grouped[categoryId].join(", ");
      }).join("; ") || "нет ответа";
    }
    if (question.type === "short_answer") {
      return String(answer || "").trim() || "нет ответа";
    }
    return String(answer || "");
  }

  function regionById(regions, regionId) {
    for (var i = 0; i < regions.length; i += 1) {
      if (regions[i] && String(regions[i].id) === String(regionId)) {
        return regions[i];
      }
    }
    return null;
  }

  function countNeighborOwners(regions, region, owner) {
    var count = 0;
    asArray(region && region.neighbors).forEach(function countNeighbor(neighborId) {
      var neighbor = regionById(regions, neighborId);
      if (neighbor && neighbor.owner === owner) {
        count += 1;
      }
    });
    return count;
  }

  function captureForCorrectAnswer(game) {
    var regions = game.map && Array.isArray(game.map.regions) ? game.map.regions : [];
    var candidates = regions.filter(function isCapturable(region) {
      return region && region.owner === "computer" && countNeighborOwners(regions, region, "player") > 0;
    });

    if (candidates.length === 0) {
      if (countOwner(game.map, "player") === regions.length) {
        finishGame(game, "victory", "Все территории у ученика.");
      } else {
        finishGame(game, "map_error", "На карте нет доступного соседнего гекса системы.");
        if (global.console) {
          global.console.warn("No capturable computer hex found.", game.map);
        }
      }
      return null;
    }

    candidates.sort(function byPlayerNeighbors(a, b) {
      var playerDiff = countNeighborOwners(regions, b, "player") - countNeighborOwners(regions, a, "player");
      if (playerDiff !== 0) {
        return playerDiff;
      }
      return asArray(b.neighbors).length - asArray(a.neighbors).length;
    });

    candidates[0].owner = "player";
    return { type: "capture", regionId: candidates[0].id, newOwner: "player" };
  }

  function cloneRegionsWithCandidateLost(regions, candidateId) {
    return regions.map(function copy(region) {
      var next = clone(region);
      if (String(next.id) === String(candidateId)) {
        next.owner = "computer";
      }
      return next;
    });
  }

  function loseForIncorrectAnswer(game) {
    var regions = game.map && Array.isArray(game.map.regions) ? game.map.regions : [];
    var playerRegions = regions.filter(function isPlayer(region) {
      return region && region.owner === "player";
    });

    if (playerRegions.length === 0) {
      finishGame(game, "defeat", "Тренировка завершена. Эти темы стоит повторить.");
      return null;
    }
    if (playerRegions.length === 1) {
      playerRegions[0].owner = "computer";
      return { type: "loss", regionId: playerRegions[0].id, newOwner: "computer" };
    }

    var border = MapGenerator.getBorderRegions(regions, "player");
    var candidates = border.length > 0 ? border : playerRegions.slice();
    var safe = candidates.filter(function keepsConnected(candidate) {
      return MapGenerator.isConnected(cloneRegionsWithCandidateLost(regions, candidate.id), "player");
    });
    var selected = safe.length > 0 ? safe : candidates;

    selected.sort(function byLeastDamage(a, b) {
      var playerDiff = countNeighborOwners(regions, a, "player") - countNeighborOwners(regions, b, "player");
      if (playerDiff !== 0) {
        return playerDiff;
      }
      return asArray(a.neighbors).length - asArray(b.neighbors).length;
    });

    selected[0].owner = "computer";
    return { type: "loss", regionId: selected[0].id, newOwner: "computer" };
  }

  function finishGame(game, result, message) {
    game.status = "finished";
    game.phase = "result";
    game.result = {
      type: result,
      message: message,
      finishedAt: nowIso(),
      playerHexes: countOwner(game.map, "player"),
      systemHexes: countOwner(game.map, "computer"),
      totalHexes: game.map && Array.isArray(game.map.regions) ? game.map.regions.length : 0,
      turns: game.turns || 0,
      maxTurns: game.maxTurns || 0,
      correct: game.correct || 0,
      incorrect: game.incorrect || 0
    };
    game.updatedAt = nowIso();
  }

  function evaluateGameEnd(game, mapDelta) {
    if (game.status === "finished") {
      return;
    }

    var total = game.map && Array.isArray(game.map.regions) ? game.map.regions.length : 0;
    var playerCount = countOwner(game.map, "player");

    if (playerCount >= total && total > 0) {
      finishGame(game, "victory", "Все территории у ученика.");
      return;
    }
    if (playerCount <= 0) {
      finishGame(game, "defeat", "Тренировка завершена. Эти темы стоит повторить.");
      return;
    }
    if (game.turns >= game.maxTurns) {
      finishGame(
        game,
        playerCount > total / 2 ? "training_success" : "training_needs_practice",
        playerCount > total / 2
          ? "Лимит ходов достигнут, у ученика больше половины карты."
          : "Лимит ходов достигнут, слабые темы стоит повторить."
      );
      return;
    }
    if (mapDelta && mapDelta.type === "loss" && playerCount <= 0) {
      finishGame(game, "defeat", "Тренировка завершена. Эти темы стоит повторить.");
    }
  }

  function updateProgressAfterAnswer(question, correct, game, options, elapsedMs) {
    options = options || {};
    var next = Storage.loadProgress();
    var perQuestion = next.perQuestion || {};
    var id = question.id;
    var selfOverride = Boolean(options.selfOverride);
    var item = perQuestion[id] || {
      seen: 0,
      correct: 0,
      incorrect: 0,
      lastResult: "",
      lastSeenAt: "",
      selfOverrideCount: 0,
      lastSelfOverride: false
    };
    var resultLabel = selfOverride
      ? "self_override"
      : (correct
        ? (options.reason === "self_accepted" ? "self_accepted" : (game.currentQuestionOvertime ? "correct_overtime" : "correct"))
        : (options.reason === "timeout" ? "timeout" : (options.reason === "revealed" ? "revealed" : (options.reason === "self_rejected" ? "self_rejected" : "incorrect"))));

    item.seen += 1;
    item.correct += correct ? 1 : 0;
    item.incorrect += correct ? 0 : 1;
    item.lastResult = resultLabel;
    item.lastSeenAt = nowIso();
    item.lastSelfOverride = selfOverride;
    item.selfOverrideCount = Math.max(0, Math.round(Number(item.selfOverrideCount) || 0)) + (selfOverride ? 1 : 0);
    perQuestion[id] = item;

    next.perQuestion = perQuestion;
    next.questionStats = perQuestion;
    next.seen = Math.max(0, Math.round(Number(next.seen) || 0)) + 1;
    next.correct = Math.max(0, Math.round(Number(next.correct) || 0)) + (correct ? 1 : 0);
    next.incorrect = Math.max(0, Math.round(Number(next.incorrect) || 0)) + (correct ? 0 : 1);
    next.totalAnswerMs = Math.max(0, Math.round(Number(next.totalAnswerMs) || 0)) + Math.max(0, Math.round(Number(elapsedMs) || 0));
    next.selfOverrideCount = Math.max(0, Math.round(Number(next.selfOverrideCount) || 0)) + (selfOverride ? 1 : 0);

    if (!next.topicStats) {
      next.topicStats = { luft: { seen: 0, correct: 0, incorrect: 0 }, wasser: { seen: 0, correct: 0, incorrect: 0 } };
    }
    if (question.topic && next.topicStats[question.topic]) {
      next.topicStats[question.topic].seen += 1;
      next.topicStats[question.topic].correct += correct ? 1 : 0;
      next.topicStats[question.topic].incorrect += correct ? 0 : 1;
    }

    next.mistakeIds = updateMistakeIds(next, question.id, correct, game.topicMode);
    next.weakSubtopics = buildWeakSubtopics(next);
    progress = Storage.saveProgress(next);
  }

  function updateMistakeIds(next, questionId, correct, topicMode) {
    var mistakeIds = asArray(next.mistakeIds).map(String);
    var exists = mistakeIds.indexOf(questionId) !== -1;
    var streaks = next.mistakeCorrectStreaks || {};

    if (!correct) {
      streaks[questionId] = 0;
      if (!exists) {
        mistakeIds.push(questionId);
      }
    } else if (topicMode === "fehler" && exists) {
      streaks[questionId] = Math.max(0, Math.round(Number(streaks[questionId]) || 0)) + 1;
      if (streaks[questionId] >= 2) {
        mistakeIds = mistakeIds.filter(function remove(id) {
          return id !== questionId;
        });
        delete streaks[questionId];
      }
    }

    next.mistakeCorrectStreaks = streaks;
    return mistakeIds;
  }

  function buildWeakSubtopics(nextProgress) {
    var weak = {};
    var mistakeMap = {};
    asArray(nextProgress.mistakeIds).forEach(function mark(id) {
      mistakeMap[String(id)] = true;
    });

    Object.keys(nextProgress.perQuestion || {}).forEach(function inspect(questionId) {
      var stats = nextProgress.perQuestion[questionId];
      var question = getQuestionById(questionId);
      if (!question || !question.subtopic) {
        return;
      }
      var seen = Number(stats.seen) || 0;
      var correct = Number(stats.correct) || 0;
      var incorrect = Number(stats.incorrect) || 0;
      var isWeak = (incorrect > 0 && seen > 0 && correct / seen < 0.7) || mistakeMap[questionId];
      if (!isWeak) {
        return;
      }
      if (!weak[question.subtopic]) {
        weak[question.subtopic] = { seen: 0, correct: 0, incorrect: 0, questionIds: [] };
      }
      weak[question.subtopic].seen += seen;
      weak[question.subtopic].correct += correct;
      weak[question.subtopic].incorrect += incorrect;
      weak[question.subtopic].questionIds.push(questionId);
    });
    return weak;
  }

  function continueAfterFeedback() {
    var game = Storage.loadCurrentGame();
    if (!game || game.status !== "playing") {
      setRoute("start");
      return;
    }

    game.phase = "question";
    game.currentQuestionId = null;
    game.answerSubmitted = false;
    game.currentQuestionStartedAt = null;
    game.currentQuestionOvertime = false;
    game.lastFeedback = null;
    game.restoredQuestion = false;
    game.updatedAt = nowIso();
    Storage.saveCurrentGame(game);
    renderGame();
  }

  function startPracticeQuestion() {
    var game = Storage.loadCurrentGame();
    if (!game || !game.lastFeedback || !game.lastFeedback.questionId) {
      return;
    }
    var source = getQuestionById(game.lastFeedback.questionId);
    var practice = findSimilarQuestion(source) || source;
    if (!practice) {
      return;
    }

    game.phase = "practice";
    game.currentQuestionId = practice.id;
    game.answerSubmitted = false;
    game.currentQuestionStartedAt = nowIso();
    game.currentQuestionOvertime = false;
    game.lastFeedback = null;
    game.updatedAt = nowIso();
    Storage.saveCurrentGame(game);
    renderGame();
  }

  function findSimilarQuestion(source) {
    if (!source) {
      return null;
    }
    var sourceTags = asArray(source.tags);
    var questions = getValidQuestions();
    var sameSubtopic = questions.filter(function sameTopic(question) {
      return question && question.id !== source.id && question.subtopic && question.subtopic === source.subtopic;
    });
    if (sameSubtopic.length > 0) {
      return sameSubtopic[0];
    }
    return questions.filter(function sharesTag(question) {
      return question && question.id !== source.id && asArray(question.tags).some(function hasTag(tag) {
        return sourceTags.indexOf(tag) !== -1;
      });
    })[0] || null;
  }

  function renderNoGame() {
    setHeader("Игра", "Нет активной партии");
    app.innerHTML = '' +
      '<section class="panel empty-route">' +
        '<h1>Нет активной партии.</h1>' +
        '<p>Начни новую игру со стартового экрана.</p>' +
        '<div class="action-row"><button class="primary-btn" type="button" data-local-route="start">На старт</button></div>' +
      '</section>';
    wireLocalRouteButtons();
  }

  function renderResult(game) {
    setHeader("Итог", "Результат партии и слабые темы");
    var result = game.result || {};
    var weak = progress.weakSubtopics || {};
    var weakList = Object.keys(weak).slice(0, 8);

    app.innerHTML = '' +
      '<section class="game-layout">' +
        '<div class="panel game-map-panel">' +
          '<div class="game-topline">' +
            '<div class="score-line"><span>Ученик: <strong id="player-territories">0</strong></span><span>Система: <strong id="system-territories">0</strong></span><span>Всего: <strong id="total-territories">0</strong></span></div>' +
          '</div>' +
          '<div id="map-container" class="map-container map-container-game"><svg id="game-map" role="img" aria-label="Итоговая гекс-карта"></svg></div>' +
        '</div>' +
        '<aside class="panel question-panel">' +
          '<p class="eyebrow">' + esc(result.type || "") + '</p>' +
          '<h1>' + esc(RESULT_LABELS[result.type] || "Итог") + '</h1>' +
          '<p>' + esc(result.message || "") + '</p>' +
          '<h2>Что повторить</h2>' +
          (weakList.length ? '<ul class="weak-list">' + weakList.map(function renderWeak(name) {
            var item = weak[name];
            return '<li><strong>' + esc(name) + '</strong> - ' + esc(item.incorrect || 0) + ' ошибок, вопросы: ' + esc(asArray(item.questionIds).slice(0, 5).join(", ")) + '</li>';
          }).join("") + '</ul>' : '<p class="muted">Слабые подтемы пока не накоплены.</p>') +
          '<div class="metric-grid compact-metrics">' +
            '<div class="metric"><strong>' + esc(result.playerHexes || 0) + '</strong><span>гексов ученика</span></div>' +
            '<div class="metric"><strong>' + percent(result.correct || 0, (result.correct || 0) + (result.incorrect || 0)) + '</strong><span>точность партии</span></div>' +
            '<div class="metric"><strong>' + esc(result.turns || 0) + '</strong><span>ходов</span></div>' +
          '</div>' +
          '<div class="action-row"><button class="primary-btn" type="button" id="newGameAfterResult">Начать новую игру</button><button class="soft-btn" type="button" data-local-route="progress">Обзор прогресса</button><button class="danger-btn" type="button" id="clearFinishedGame">Убрать итог</button></div>' +
        '</aside>' +
      '</section>';

    renderMap(game.map);
    wireLocalRouteButtons();
    byId("newGameAfterResult").addEventListener("click", function newGame() {
      Storage.clearCurrentGame();
      setRoute("start");
    });
    byId("clearFinishedGame").addEventListener("click", function clearFinished() {
      Storage.clearCurrentGame();
      setRoute("start");
    });
  }

  function renderDictionary() {
    setHeader("Словарь", "Термины из банка данных");
    var allTerms = Array.isArray(DATA.terms) ? DATA.terms : [];
    var filterMap = {};
    asArray(dictionaryTermFilterIds).forEach(function mark(termId) {
      filterMap[String(termId)] = true;
    });
    var hasFilter = Object.keys(filterMap).length > 0;
    var terms = hasFilter
      ? allTerms.filter(function filterTerm(term) {
        return term && filterMap[String(term.id)];
      })
      : allTerms;
    app.innerHTML = '' +
      '<section class="panel list-panel">' +
        '<div class="screen-head"><div><h1>Словарь терминов</h1><p>' + esc(hasFilter ? "Показаны термины, связанные с текущим вопросом." : "Сейчас показаны реальные карточки из CHEMIE_DATA.terms; поиск и фильтры будут отдельным шагом.") + '</p></div><div class="action-row">' +
          (hasFilter ? '<button class="soft-btn" type="button" id="showAllTerms">Все термины</button>' : "") +
          '<button class="soft-btn" type="button" data-local-route="start">На старт</button>' +
        '</div></div>' +
        (terms.length ? '<div class="card-grid">' + terms.map(renderTerm).join("") + '</div>' : '<div class="empty-state"><h2>Термины пока не добавлены</h2><p>Структура `CHEMIE_DATA.terms` готова для следующей сессии.</p></div>') +
      '</section>';
    wireLocalRouteButtons();
    var showAll = byId("showAllTerms");
    if (showAll) {
      showAll.addEventListener("click", function clearTermFilter() {
        dictionaryTermFilterIds = null;
        renderDictionary();
      });
    }
  }

  function renderTerm(term) {
    return '<article class="mini-card"><p class="eyebrow">' + esc(term.category || "") + '</p><h2>' + esc(term.term || term.id) + '</h2><p>' + esc(term.ru || "") + '</p><p class="muted">' + esc(term.de || "") + '</p></article>';
  }

  function renderAnswers() {
    setHeader("Готовые ответы", "Немецкие формулировки из банка данных");
    var answers = Array.isArray(DATA.readyAnswers) ? DATA.readyAnswers : [];
    app.innerHTML = '' +
      '<section class="panel list-panel">' +
        '<div class="screen-head"><div><h1>Готовые немецкие ответы</h1><p>Короткие формулировки для повторения тем Luft и Wasser.</p></div><button class="soft-btn" type="button" data-local-route="start">На старт</button></div>' +
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
    var weak = progress.weakSubtopics || {};
    var weakNames = Object.keys(weak).slice(0, 10);
    var mistakeQuestions = asArray(progress.mistakeIds).slice(0, 10).map(function mapMistake(id) {
      var question = getQuestionById(id);
      return '<li><strong>' + esc(id) + '</strong> - ' + esc(questionTitle(question)) + '</li>';
    }).join("");

    app.innerHTML = '' +
      '<section class="panel progress-panel">' +
        '<div class="screen-head"><div><h1>Обзор прогресса</h1><p>Статистика обновляется после каждого хода и используется для режима повторения ошибок.</p></div><button class="soft-btn" type="button" data-local-route="start">На старт</button></div>' +
        '<div class="metric-grid">' +
          '<div class="metric"><strong>' + percent(progress.correct, progress.seen) + '</strong><span>общая точность</span></div>' +
          '<div class="metric"><strong>' + percent(luft.correct, luft.seen) + '</strong><span>Luft</span></div>' +
          '<div class="metric"><strong>' + percent(wasser.correct, wasser.seen) + '</strong><span>Wasser</span></div>' +
          '<div class="metric"><strong>' + progress.mistakeIds.length + '</strong><span>ошибок для повтора</span></div>' +
          '<div class="metric"><strong>' + esc(progress.selfOverrideCount || 0) + '</strong><span>самооценок вопреки автопроверке</span></div>' +
        '</div>' +
        '<div class="progress-columns">' +
          '<section><h2>Слабые подтемы</h2>' +
            (weakNames.length ? '<ul class="weak-list">' + weakNames.map(function renderWeak(name) {
              var item = weak[name];
              return '<li><strong>' + esc(name) + '</strong> - точность ' + esc(percent(item.correct || 0, item.seen || 0)) + ', вопросов: ' + esc(asArray(item.questionIds).slice(0, 5).join(", ")) + '</li>';
            }).join("") + '</ul>' : '<p class="muted">Пока нет слабых подтем.</p>') +
          '</section>' +
          '<section><h2>Ошибки</h2>' + (mistakeQuestions ? '<ul class="weak-list">' + mistakeQuestions + '</ul>' : '<p class="muted">Сейчас нет сохраненных ошибок.</p>') + '</section>' +
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
          '<h1>Сейчас нет сохраненных ошибок.</h1>' +
          '<p>Можно начать новую смешанную игру или открыть обзор прогресса.</p>' +
          '<div class="action-row"><button class="primary-btn" type="button" id="startMixed">Gemischt starten</button><button class="soft-btn" type="button" data-local-route="progress">Обзор прогресса</button><button class="soft-btn" type="button" data-local-route="start">Назад</button></div>' +
        '</section>';
      byId("startMixed").addEventListener("click", function startMixed() {
        settings.topicMode = "gemischt";
        Storage.saveSettings(settings);
        beginGame(settings);
      });
      wireLocalRouteButtons();
      return;
    }

    app.innerHTML = '' +
      '<section class="panel empty-route">' +
        '<h1>Ошибки для повтора</h1>' +
        '<p>Сохраненные id: ' + esc(progress.mistakeIds.join(", ")) + '</p>' +
        '<div class="action-row"><button class="primary-btn" type="button" id="startMistakes">Начать повтор</button><button class="soft-btn" type="button" data-local-route="start">Назад</button></div>' +
      '</section>';
    byId("startMistakes").addEventListener("click", function startMistakes() {
      settings.topicMode = "fehler";
      Storage.saveSettings(settings);
      beginGame(settings);
    });
    wireLocalRouteButtons();
  }

  function wireLocalRouteButtons() {
    global.document.querySelectorAll("[data-local-route]").forEach(function wire(button) {
      button.addEventListener("click", function go() {
        var route = button.getAttribute("data-local-route");
        if (route === "dictionary") {
          dictionaryTermFilterIds = null;
        }
        setRoute(route);
      });
    });
  }

  function render() {
    syncGlobals();

    var route = getRoute();
    setActiveNav(route);
    showStatus("", "");

    if (route !== "game" && Timer) {
      Timer.reset();
    }

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
    syncGlobals();
    if (Engine.runSelfCheck) {
      Engine.runSelfCheck(DATA, { log: true });
    }

    global.document.body.addEventListener("click", function onBodyClick(event) {
      var routeButton = event.target.closest("[data-route]");
      if (!routeButton) {
        return;
      }
      event.preventDefault();
      if (routeButton.getAttribute("data-route") === "dictionary") {
        dictionaryTermFilterIds = null;
      }
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
