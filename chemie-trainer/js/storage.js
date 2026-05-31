(function attachChemieStorage(global) {
  "use strict";

  var CHEMIE_STORAGE_KEYS = {
    settings: "chemieConquest.settings.v2",
    currentGame: "chemieConquest.currentGame.v2",
    progress: "chemieConquest.progress.v2"
  };

  var STORAGE_VERSION = 2;

  var ALLOWED_TYPES = [
    "single_choice",
    "multiple_choice",
    "matching",
    "fill_blank",
    "ordering",
    "true_false",
    "categorization",
    "short_answer"
  ];

  var DEFAULT_TIMER_SECONDS = {
    single_choice: 45,
    multiple_choice: 60,
    matching: 90,
    fill_blank: 75,
    ordering: 75,
    true_false: 75,
    categorization: 90,
    short_answer: 180
  };

  var DEFAULT_SETTINGS = {
    version: STORAGE_VERSION,
    topicMode: "gemischt",
    enabledTypes: "all",
    totalHexes: 24,
    playerStartHexes: 5,
    timerEnabled: false,
    timerMode: "soft",
    hardTimerForShortAnswer: false,
    timerSecondsByType: DEFAULT_TIMER_SECONDS
  };

  var DEFAULT_PROGRESS = {
    version: STORAGE_VERSION,
    perQuestion: {},
    mistakeIds: [],
    weakSubtopics: {},
    viewedReadyAnswerIds: [],
    mistakeCorrectStreaks: {},
    seen: 0,
    correct: 0,
    incorrect: 0,
    totalAnswerMs: 0,
    selfOverrideCount: 0,
    topicStats: {
      luft: { seen: 0, correct: 0, incorrect: 0 },
      wasser: { seen: 0, correct: 0, incorrect: 0 }
    },
    questionStats: {}
  };

  var memoryStore = {};
  var storageAvailable = null;
  var diagnostics = {
    currentGameReset: false,
    currentGameResetReason: "",
    progressMigrated: false,
    progressFallback: false,
    settingsMigrated: false,
    storageWriteFailed: false
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function getLocalStorage() {
    try {
      if (!global.localStorage) {
        return null;
      }
      return global.localStorage;
    } catch (error) {
      return null;
    }
  }

  function isAvailable() {
    if (storageAvailable !== null) {
      return storageAvailable;
    }

    var store = getLocalStorage();
    if (!store) {
      storageAvailable = false;
      return storageAvailable;
    }

    try {
      var key = "chemieConquest.storageTest";
      store.setItem(key, "1");
      store.removeItem(key);
      storageAvailable = true;
    } catch (error) {
      storageAvailable = false;
    }
    return storageAvailable;
  }

  function readRaw(key) {
    try {
      return isAvailable() ? getLocalStorage().getItem(key) : memoryStore[key] || null;
    } catch (error) {
      return memoryStore[key] || null;
    }
  }

  function readRecord(key) {
    var raw = readRaw(key);
    if (!raw) {
      return { ok: true, missing: true, value: null };
    }

    try {
      return { ok: true, missing: false, value: JSON.parse(raw) };
    } catch (error) {
      return { ok: false, missing: false, value: null, error: error };
    }
  }

  function writeJson(key, value) {
    var raw = JSON.stringify(value);
    try {
      if (isAvailable()) {
        getLocalStorage().setItem(key, raw);
      } else {
        memoryStore[key] = raw;
      }
      return true;
    } catch (error) {
      diagnostics.storageWriteFailed = true;
      memoryStore[key] = raw;
      return false;
    }
  }

  function removeKey(key) {
    try {
      if (isAvailable()) {
        getLocalStorage().removeItem(key);
      }
    } catch (error) {
      diagnostics.storageWriteFailed = true;
    }
    delete memoryStore[key];
  }

  function clampInt(value, min, max, fallback, label, messages) {
    var parsed = Number(value);
    var normalized = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
    if (normalized < min) {
      messages.push(label + " увеличено до " + min + ".");
      return min;
    }
    if (normalized > max) {
      messages.push(label + " уменьшено до " + max + ".");
      return max;
    }
    return normalized;
  }

  function normalizeEnabledTypes(value) {
    if (value === "all" || !Array.isArray(value)) {
      return "all";
    }

    var selected = value.filter(function filterType(type, index) {
      return ALLOWED_TYPES.indexOf(type) !== -1 && value.indexOf(type) === index;
    });

    return selected.length === 0 || selected.length === ALLOWED_TYPES.length ? "all" : selected;
  }

  function normalizeTimerSeconds(source) {
    var result = {};
    ALLOWED_TYPES.forEach(function normalizeType(type) {
      var fallback = DEFAULT_TIMER_SECONDS[type];
      var value = source && hasOwn(source, type) ? Number(source[type]) : fallback;
      result[type] = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
    });
    return result;
  }

  function normalizeSettings(input) {
    var source = input && typeof input === "object" ? input : {};
    var messages = [];
    var totalHexes = clampInt(source.totalHexes, 12, 36, DEFAULT_SETTINGS.totalHexes, "Количество гексов", messages);
    var maxStart = Math.min(8, totalHexes - 3);
    var playerStartHexes = clampInt(
      source.playerStartHexes,
      3,
      maxStart,
      Math.min(DEFAULT_SETTINGS.playerStartHexes, maxStart),
      "Стартовые гексы ученика",
      messages
    );

    var topicMode = ["luft", "wasser", "gemischt", "fehler"].indexOf(source.topicMode) !== -1
      ? source.topicMode
      : DEFAULT_SETTINGS.topicMode;
    var timerMode = source.timerMode === "hard" ? "hard" : "soft";

    if (source.version && source.version !== STORAGE_VERSION) {
      diagnostics.settingsMigrated = true;
      messages.push("Настройки обновлены до версии " + STORAGE_VERSION + ".");
    }

    return {
      settings: {
        version: STORAGE_VERSION,
        topicMode: topicMode,
        enabledTypes: normalizeEnabledTypes(source.enabledTypes),
        totalHexes: totalHexes,
        playerStartHexes: playerStartHexes,
        timerEnabled: Boolean(source.timerEnabled),
        timerMode: timerMode,
        hardTimerForShortAnswer: Boolean(source.hardTimerForShortAnswer),
        timerSecondsByType: normalizeTimerSeconds(source.timerSecondsByType)
      },
      messages: messages
    };
  }

  function loadSettings() {
    var record = readRecord(CHEMIE_STORAGE_KEYS.settings);
    var normalized = normalizeSettings(record.ok ? record.value : null);
    if (!record.ok || diagnostics.settingsMigrated) {
      saveSettings(normalized.settings);
    }
    return normalized.settings;
  }

  function saveSettings(settings) {
    var normalized = normalizeSettings(settings);
    writeJson(CHEMIE_STORAGE_KEYS.settings, normalized.settings);
    return normalized;
  }

  function markCurrentGameReset(reason) {
    diagnostics.currentGameReset = true;
    diagnostics.currentGameResetReason = reason;
  }

  function loadCurrentGame() {
    var record = readRecord(CHEMIE_STORAGE_KEYS.currentGame);
    if (record.missing) {
      return null;
    }
    if (!record.ok) {
      clearCurrentGame();
      markCurrentGameReset("Сохраненная партия повреждена и была сброшена.");
      return null;
    }
    if (!record.value || typeof record.value !== "object" || record.value.version !== STORAGE_VERSION) {
      clearCurrentGame();
      markCurrentGameReset("Сохраненная партия была создана другой версией и сброшена.");
      return null;
    }
    return record.value;
  }

  function saveCurrentGame(gameState) {
    if (!gameState) {
      clearCurrentGame();
      return true;
    }
    var copy = clone(gameState);
    copy.version = STORAGE_VERSION;
    return writeJson(CHEMIE_STORAGE_KEYS.currentGame, copy);
  }

  function clearCurrentGame() {
    removeKey(CHEMIE_STORAGE_KEYS.currentGame);
  }

  function uniqueStrings(values) {
    var seen = {};
    var result = [];
    if (!Array.isArray(values)) {
      return result;
    }
    values.forEach(function add(value) {
      var key = String(value || "");
      if (key && !hasOwn(seen, key)) {
        seen[key] = true;
        result.push(key);
      }
    });
    return result;
  }

  function normalizeQuestionEntry(entry) {
    var source = entry && typeof entry === "object" ? entry : {};
    return {
      seen: Math.max(0, Math.round(Number(source.seen) || 0)),
      correct: Math.max(0, Math.round(Number(source.correct) || 0)),
      incorrect: Math.max(0, Math.round(Number(source.incorrect) || 0)),
      lastResult: source.lastResult ? String(source.lastResult) : "",
      lastSeenAt: source.lastSeenAt ? String(source.lastSeenAt) : "",
      selfOverrideCount: Math.max(0, Math.round(Number(source.selfOverrideCount) || 0)),
      lastSelfOverride: Boolean(source.lastSelfOverride)
    };
  }

  function normalizePerQuestion(source) {
    var result = {};
    var stats = source && typeof source === "object" ? source : {};
    Object.keys(stats).forEach(function normalizeId(questionId) {
      if (!questionId) {
        return;
      }
      result[questionId] = normalizeQuestionEntry(stats[questionId]);
    });
    return result;
  }

  function normalizeTopicStats(source) {
    var result = clone(DEFAULT_PROGRESS.topicStats);
    if (!source || typeof source !== "object") {
      return result;
    }

    ["luft", "wasser"].forEach(function normalizeTopic(topic) {
      var item = source[topic] || {};
      result[topic] = {
        seen: Math.max(0, Math.round(Number(item.seen) || 0)),
        correct: Math.max(0, Math.round(Number(item.correct) || 0)),
        incorrect: Math.max(0, Math.round(Number(item.incorrect) || 0))
      };
    });
    return result;
  }

  function normalizeProgress(progress) {
    var source = progress && typeof progress === "object" ? progress : {};
    var perQuestion = normalizePerQuestion(source.perQuestion || source.questionStats);
    var perQuestionOverrideCount = 0;
    var result = clone(DEFAULT_PROGRESS);

    if (source.version && source.version !== STORAGE_VERSION) {
      diagnostics.progressMigrated = true;
    }

    result.perQuestion = perQuestion;
    result.questionStats = perQuestion;
    result.mistakeIds = uniqueStrings(source.mistakeIds);
    result.weakSubtopics = source.weakSubtopics && typeof source.weakSubtopics === "object"
      ? clone(source.weakSubtopics)
      : {};
    result.viewedReadyAnswerIds = uniqueStrings(source.viewedReadyAnswerIds);
    result.mistakeCorrectStreaks = source.mistakeCorrectStreaks && typeof source.mistakeCorrectStreaks === "object"
      ? clone(source.mistakeCorrectStreaks)
      : {};
    result.topicStats = normalizeTopicStats(source.topicStats);
    result.totalAnswerMs = Math.max(0, Math.round(Number(source.totalAnswerMs) || 0));

    result.seen = Math.max(0, Math.round(Number(source.seen) || 0));
    result.correct = Math.max(0, Math.round(Number(source.correct) || 0));
    result.incorrect = Math.max(0, Math.round(Number(source.incorrect) || 0));
    Object.keys(perQuestion).forEach(function countOverrides(questionId) {
      perQuestionOverrideCount += Math.max(0, Math.round(Number(perQuestion[questionId].selfOverrideCount) || 0));
    });
    result.selfOverrideCount = Math.max(
      Math.max(0, Math.round(Number(source.selfOverrideCount) || 0)),
      perQuestionOverrideCount
    );

    if (result.seen === 0 && Object.keys(perQuestion).length > 0) {
      Object.keys(perQuestion).forEach(function addStats(id) {
        result.seen += perQuestion[id].seen;
        result.correct += perQuestion[id].correct;
        result.incorrect += perQuestion[id].incorrect;
      });
    }

    return result;
  }

  function loadProgress() {
    var record = readRecord(CHEMIE_STORAGE_KEYS.progress);
    if (!record.ok) {
      diagnostics.progressFallback = true;
      return normalizeProgress(null);
    }
    var normalized = normalizeProgress(record.value);
    if (!record.missing && diagnostics.progressMigrated) {
      saveProgress(normalized);
    }
    return normalized;
  }

  function saveProgress(progress) {
    var normalized = normalizeProgress(progress);
    writeJson(CHEMIE_STORAGE_KEYS.progress, normalized);
    return normalized;
  }

  function resetProgress() {
    removeKey(CHEMIE_STORAGE_KEYS.progress);
    return loadProgress();
  }

  function resetAll() {
    removeKey(CHEMIE_STORAGE_KEYS.currentGame);
    removeKey(CHEMIE_STORAGE_KEYS.progress);
    return loadProgress();
  }

  function getDiagnostics() {
    return clone(diagnostics);
  }

  function clearDiagnostics() {
    diagnostics.currentGameReset = false;
    diagnostics.currentGameResetReason = "";
    diagnostics.progressMigrated = false;
    diagnostics.progressFallback = false;
    diagnostics.settingsMigrated = false;
    diagnostics.storageWriteFailed = false;
  }

  global.CHEMIE_STORAGE_KEYS = CHEMIE_STORAGE_KEYS;
  global.ChemieStorage = {
    keys: CHEMIE_STORAGE_KEYS,
    defaultSettings: clone(DEFAULT_SETTINGS),
    defaultProgress: clone(DEFAULT_PROGRESS),
    allowedTypes: ALLOWED_TYPES.slice(),
    isAvailable: isAvailable,
    normalizeSettings: normalizeSettings,
    normalizeProgress: normalizeProgress,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadCurrentGame: loadCurrentGame,
    saveCurrentGame: saveCurrentGame,
    clearCurrentGame: clearCurrentGame,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    resetProgress: resetProgress,
    resetAll: resetAll,
    getDiagnostics: getDiagnostics,
    clearDiagnostics: clearDiagnostics
  };
})(typeof window !== "undefined" ? window : globalThis);
