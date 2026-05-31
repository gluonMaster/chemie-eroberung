(function attachChemieStorage(global) {
  "use strict";

  var CHEMIE_STORAGE_KEYS = {
    settings: "chemieConquest.settings.v2",
    currentGame: "chemieConquest.currentGame.v2",
    progress: "chemieConquest.progress.v2"
  };

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
    version: 2,
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
    version: 2,
    seen: 0,
    correct: 0,
    incorrect: 0,
    totalAnswerMs: 0,
    topicStats: {
      luft: { seen: 0, correct: 0, incorrect: 0 },
      wasser: { seen: 0, correct: 0, incorrect: 0 }
    },
    questionStats: {},
    mistakeIds: [],
    mistakeStreaks: {}
  };

  var memoryStore = {};
  var storageAvailable = null;

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

  function readJson(key, fallback) {
    var raw = null;
    try {
      raw = isAvailable() ? getLocalStorage().getItem(key) : memoryStore[key];
      if (!raw) {
        return clone(fallback);
      }
      return JSON.parse(raw);
    } catch (error) {
      return clone(fallback);
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
      // Use in-memory fallback below.
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
    for (var i = 0; i < ALLOWED_TYPES.length; i += 1) {
      var type = ALLOWED_TYPES[i];
      var fallback = DEFAULT_TIMER_SECONDS[type];
      var value = source && hasOwn(source, type) ? Number(source[type]) : fallback;
      result[type] = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
    }
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

    return {
      settings: {
        version: 2,
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
    var stored = readJson(CHEMIE_STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    return normalizeSettings(stored).settings;
  }

  function saveSettings(settings) {
    var normalized = normalizeSettings(settings);
    writeJson(CHEMIE_STORAGE_KEYS.settings, normalized.settings);
    return normalized;
  }

  function loadCurrentGame() {
    return readJson(CHEMIE_STORAGE_KEYS.currentGame, null);
  }

  function saveCurrentGame(gameState) {
    return writeJson(CHEMIE_STORAGE_KEYS.currentGame, gameState || null);
  }

  function clearCurrentGame() {
    removeKey(CHEMIE_STORAGE_KEYS.currentGame);
  }

  function normalizeProgress(progress) {
    var source = progress && typeof progress === "object" ? progress : {};
    var result = clone(DEFAULT_PROGRESS);
    result.seen = Math.max(0, Math.round(Number(source.seen) || 0));
    result.correct = Math.max(0, Math.round(Number(source.correct) || 0));
    result.incorrect = Math.max(0, Math.round(Number(source.incorrect) || 0));
    result.totalAnswerMs = Math.max(0, Math.round(Number(source.totalAnswerMs) || 0));
    result.questionStats = source.questionStats && typeof source.questionStats === "object" ? source.questionStats : {};
    result.mistakeIds = Array.isArray(source.mistakeIds) ? source.mistakeIds.filter(Boolean) : [];
    result.mistakeStreaks = source.mistakeStreaks && typeof source.mistakeStreaks === "object" ? source.mistakeStreaks : {};

    if (source.topicStats && typeof source.topicStats === "object") {
      ["luft", "wasser"].forEach(function normalizeTopic(topic) {
        var item = source.topicStats[topic] || {};
        result.topicStats[topic] = {
          seen: Math.max(0, Math.round(Number(item.seen) || 0)),
          correct: Math.max(0, Math.round(Number(item.correct) || 0)),
          incorrect: Math.max(0, Math.round(Number(item.incorrect) || 0))
        };
      });
    }

    return result;
  }

  function loadProgress() {
    return normalizeProgress(readJson(CHEMIE_STORAGE_KEYS.progress, DEFAULT_PROGRESS));
  }

  function saveProgress(progress) {
    var normalized = normalizeProgress(progress);
    writeJson(CHEMIE_STORAGE_KEYS.progress, normalized);
    return normalized;
  }

  function resetAll() {
    removeKey(CHEMIE_STORAGE_KEYS.currentGame);
    removeKey(CHEMIE_STORAGE_KEYS.progress);
    return loadProgress();
  }

  global.CHEMIE_STORAGE_KEYS = CHEMIE_STORAGE_KEYS;
  global.ChemieStorage = {
    keys: CHEMIE_STORAGE_KEYS,
    defaultSettings: clone(DEFAULT_SETTINGS),
    defaultProgress: clone(DEFAULT_PROGRESS),
    allowedTypes: ALLOWED_TYPES.slice(),
    isAvailable: isAvailable,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadCurrentGame: loadCurrentGame,
    saveCurrentGame: saveCurrentGame,
    clearCurrentGame: clearCurrentGame,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    resetAll: resetAll
  };
})(typeof window !== "undefined" ? window : globalThis);
