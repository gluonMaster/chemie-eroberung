(function attachChemistryEngine(global) {
  "use strict";

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

  var OPTIONAL_WARNING_FIELDS = ["instructionRu", "explanationRu", "explanationDe", "difficulty"];
  var FILL_NORMALIZE_MODES = ["text", "formula", "number", "term", "equation_part"];

  var SUBSCRIPT = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9"
  };

  var SUPERSCRIPT = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "-"
  };

  var loggedValidationSignatures = {};

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asList(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return value == null || value === "" ? [] : [value];
  }

  function unique(values) {
    var seen = {};
    var result = [];
    asArray(values).forEach(function add(value) {
      var key = String(value);
      if (value != null && value !== "" && !hasOwn(seen, key)) {
        seen[key] = true;
        result.push(value);
      }
    });
    return result;
  }

  function toIdMap(items) {
    var map = {};
    asArray(items).forEach(function add(item) {
      if (item && item.id != null) {
        map[String(item.id)] = item;
      }
    });
    return map;
  }

  function clampInt(value, min, max, fallback) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  function isMissing(value) {
    return value == null || value === "";
  }

  function makeIssue(scope, id, message) {
    return {
      scope: scope,
      id: id || scope,
      message: message
    };
  }

  function getChoiceAnswerIds(question) {
    if (!question) {
      return [];
    }
    if (question.type === "multiple_choice") {
      return unique(asList(question.answers || question.answer || question.correctAnswer));
    }
    return unique(asList(question.answer || question.correctAnswer));
  }

  function getCorrectOrder(question) {
    return asArray(question && (question.correctOrder || question.order || question.answer));
  }

  function getItemCategoryId(item) {
    return item && (item.correctCategoryId || item.categoryId);
  }

  function getShortAnswerTerms(group) {
    if (Array.isArray(group)) {
      return group;
    }
    return asArray(group && (group.accepted || group.terms));
  }

  function getShortAnswerGroupId(group, index) {
    return group && group.id ? String(group.id) : "group_" + String(index + 1);
  }

  function shuffle(values) {
    var result = values.slice();
    for (var i = result.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }
    return result;
  }

  function convertFormulaGlyphs(text) {
    var output = "";
    var inSuperscriptNumber = false;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (hasOwn(SUBSCRIPT, ch)) {
        output += SUBSCRIPT[ch];
        inSuperscriptNumber = false;
      } else if (hasOwn(SUPERSCRIPT, ch)) {
        var mapped = SUPERSCRIPT[ch];
        if (/^[0-9]$/.test(mapped)) {
          if (!inSuperscriptNumber) {
            output += "^";
            inSuperscriptNumber = true;
          }
          output += mapped;
        } else {
          output += mapped;
          inSuperscriptNumber = false;
        }
      } else {
        output += ch;
        inSuperscriptNumber = false;
      }
    }

    return output;
  }

  function normalizeTrailingCharge(text) {
    if (/\^[0-9]+[+-]$/.test(text)) {
      return text;
    }

    var normalized = text.replace(/^(.+[0-9])([2-9])([+-])$/, "$1^$2$3");
    normalized = normalized.replace(/^([A-Z][a-z]?)([2-9])([+-])$/, "$1^$2$3");
    return normalized;
  }

  function normalizeFormula(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) {
      return "";
    }

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/=>|⇒|→/g, "->")
      .replace(/[–—−]/g, "-")
      .replace(/δ/g, "delta");

    text = convertFormulaGlyphs(text);
    text = text
      .replace(/\bdelta\s*\^\s*([+-])/gi, "delta$1")
      .replace(/\bdelta\s*([+-])/gi, "delta$1")
      .replace(/\s+([0-9]+[+-])$/g, "^$1")
      .replace(/\s+/g, "")
      .replace(/\^\+/g, "+")
      .replace(/\^-/g, "-");

    return normalizeTrailingCharge(text);
  }

  function normalizeText(value) {
    var text = normalizeFormula(value)
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/\s+/g, " ")
      .trim();

    return text.replace(/\s*\.+$/g, "").replace(/\s+/g, " ").trim();
  }

  function normalizeNumber(value) {
    var text = String(value == null ? "" : value).trim().replace(",", ".");
    var parsed = Number(text);
    return Number.isFinite(parsed) ? String(parsed) : normalizeText(value);
  }

  function normalizeForMode(value, mode) {
    if (mode === "formula" || mode === "equation_part") {
      return normalizeFormula(value).toLowerCase();
    }
    if (mode === "number") {
      return normalizeNumber(value);
    }
    return normalizeText(value);
  }

  function sameByMode(a, b, mode) {
    return normalizeForMode(a, mode) === normalizeForMode(b, mode);
  }

  function logValidationReport(report) {
    if (!global.console || (!report.errors.length && !report.warnings.length)) {
      return;
    }

    var signature = report.errors.concat(report.warnings).map(function format(issue) {
      return issue.scope + ":" + issue.id + ":" + issue.message;
    }).join("|");

    if (loggedValidationSignatures[signature]) {
      return;
    }
    loggedValidationSignatures[signature] = true;

    if (global.console.groupCollapsed) {
      global.console.groupCollapsed(
        "CHEMIE_DATA validation: " +
        report.errors.length +
        " errors, " +
        report.warnings.length +
        " warnings"
      );
    }

    report.errors.forEach(function logError(issue) {
      global.console.error("[CHEMIE_DATA] " + issue.scope + " " + issue.id + ": " + issue.message, issue);
    });
    report.warnings.forEach(function logWarning(issue) {
      global.console.warn("[CHEMIE_DATA] " + issue.scope + " " + issue.id + ": " + issue.message, issue);
    });

    if (global.console.groupEnd) {
      global.console.groupEnd();
    }
  }

  function validateChoiceQuestion(question, blocking) {
    var optionIds = {};
    asArray(question.options).forEach(function collectOption(option) {
      if (option && option.id != null) {
        optionIds[String(option.id)] = true;
      }
    });

    if (Object.keys(optionIds).length === 0) {
      blocking.push("у выбора нет options");
    }

    var answerIds = getChoiceAnswerIds(question);
    if (answerIds.length === 0) {
      blocking.push("у выбора нет answer/answers");
    }

    answerIds.forEach(function checkOption(answerId) {
      if (!hasOwn(optionIds, String(answerId))) {
        blocking.push("ответ ссылается на отсутствующий option id " + answerId);
      }
    });
  }

  function validateFillBlankQuestion(question, blocking, warnings, id) {
    if (!Array.isArray(question.blanks) || question.blanks.length === 0) {
      blocking.push("у fill_blank нет blanks");
      return;
    }

    question.blanks.forEach(function checkBlank(blank, index) {
      var blankId = blank && blank.id ? blank.id : "blank@" + index;
      if (!blank || !Array.isArray(blank.acceptedAnswers) || blank.acceptedAnswers.length === 0) {
        blocking.push("у blank " + blankId + " нет acceptedAnswers");
      }
      if (blank && blank.normalizeMode && FILL_NORMALIZE_MODES.indexOf(blank.normalizeMode) === -1) {
        warnings.push(makeIssue("question", id, "у blank " + blankId + " неизвестный normalizeMode " + blank.normalizeMode));
      }
    });
  }

  function validateMatchingQuestion(question, blocking) {
    if (!Array.isArray(question.pairs) || question.pairs.length === 0) {
      blocking.push("у matching нет пар");
      return;
    }

    question.pairs.forEach(function checkPair(pair, index) {
      var left = pair && (pair.leftId || pair.left || pair[0]);
      var right = pair && (pair.rightId || pair.right || pair[1]);
      if (isMissing(left) || isMissing(right)) {
        blocking.push("у matching pair@" + index + " нет left/right");
      }
    });
  }

  function validateOrderingQuestion(question, blocking) {
    var itemIds = {};
    asArray(question.items).forEach(function collectItem(item) {
      if (item && item.id != null) {
        itemIds[String(item.id)] = true;
      }
    });

    if (Object.keys(itemIds).length === 0) {
      blocking.push("у ordering нет items");
    }

    var correctOrder = getCorrectOrder(question);
    if (correctOrder.length === 0) {
      blocking.push("у ordering нет correctOrder");
    }

    correctOrder.forEach(function checkOrder(itemId) {
      if (!hasOwn(itemIds, String(itemId))) {
        blocking.push("порядок содержит неизвестный item id " + itemId);
      }
    });
  }

  function validateTrueFalseQuestion(question, blocking) {
    if (!Array.isArray(question.statements) || question.statements.length === 0) {
      blocking.push("у true_false нет statements");
      return;
    }

    question.statements.forEach(function checkStatement(statement, index) {
      if (!statement || isMissing(statement.id) || isMissing(statement.text) || typeof statement.answer !== "boolean") {
        blocking.push("у true_false statement@" + index + " нет id/text/answer");
      }
    });
  }

  function validateCategorizationQuestion(question, blocking) {
    var categories = {};
    asArray(question.categories).forEach(function collectCategory(category) {
      var categoryId = typeof category === "string" ? category : category && category.id;
      if (categoryId != null) {
        categories[String(categoryId)] = true;
      }
    });

    if (Object.keys(categories).length === 0) {
      blocking.push("у categorization нет categories");
    }
    if (!Array.isArray(question.items) || question.items.length === 0) {
      blocking.push("у categorization нет items");
    }

    asArray(question.items).forEach(function checkItem(item, index) {
      var itemCategoryId = getItemCategoryId(item);
      if (isMissing(item && item.id) || isMissing(item && item.text)) {
        blocking.push("у categorization item@" + index + " нет id/text");
      }
      if (isMissing(itemCategoryId)) {
        blocking.push("у categorization item@" + index + " нет correctCategoryId");
      } else if (!hasOwn(categories, String(itemCategoryId))) {
        blocking.push("item ссылается на отсутствующую категорию " + itemCategoryId);
      }
    });
  }

  function validateShortAnswerQuestion(question, blocking) {
    ["sampleAnswer", "criteria", "requiredTermGroups", "minRequiredGroups"].forEach(function requireShort(field) {
      if (!hasOwn(question, field) || isMissing(question[field])) {
        blocking.push("у short_answer нет " + field);
      }
    });

    if (hasOwn(question, "requiredTermGroups") && (!Array.isArray(question.requiredTermGroups) || question.requiredTermGroups.length === 0)) {
      blocking.push("у short_answer requiredTermGroups пустой");
    }
    if (hasOwn(question, "criteria") && (!Array.isArray(question.criteria) || question.criteria.length === 0)) {
      blocking.push("у short_answer criteria пустой");
    }
  }

  function validateQuestionByType(question, blocking, warnings, id) {
    if (!question || ALLOWED_TYPES.indexOf(question.type) === -1) {
      return;
    }

    if (question.type === "single_choice" || question.type === "multiple_choice") {
      validateChoiceQuestion(question, blocking);
    } else if (question.type === "fill_blank") {
      validateFillBlankQuestion(question, blocking, warnings, id);
    } else if (question.type === "matching") {
      validateMatchingQuestion(question, blocking);
    } else if (question.type === "ordering") {
      validateOrderingQuestion(question, blocking);
    } else if (question.type === "true_false") {
      validateTrueFalseQuestion(question, blocking);
    } else if (question.type === "categorization") {
      validateCategorizationQuestion(question, blocking);
    } else if (question.type === "short_answer") {
      validateShortAnswerQuestion(question, blocking);
    }
  }

  function validateData(data, options) {
    var report = {
      valid: false,
      errors: [],
      warnings: [],
      blockedQuestionIds: [],
      validQuestionIds: [],
      validQuestions: []
    };

    if (!data || typeof data !== "object") {
      report.errors.push(makeIssue("data", "CHEMIE_DATA", "CHEMIE_DATA отсутствует."));
      if (!options || options.log !== false) {
        logValidationReport(report);
      }
      return report;
    }

    if (!Array.isArray(data.terms)) {
      report.errors.push(makeIssue("terms", "terms", "terms должен быть массивом."));
    }
    if (!Array.isArray(data.questions)) {
      report.errors.push(makeIssue("questions", "questions", "questions должен быть массивом."));
    }
    if (!Array.isArray(data.readyAnswers)) {
      report.warnings.push(makeIssue("readyAnswers", "readyAnswers", "readyAnswers должен быть массивом."));
    }

    var terms = asArray(data.terms);
    var questions = asArray(data.questions);
    var readyAnswers = asArray(data.readyAnswers);
    var termIds = {};
    var questionIdCounts = {};

    terms.forEach(function validateTerm(term, index) {
      if (!term || isMissing(term.id)) {
        report.warnings.push(makeIssue("term", "term@" + index, "у термина нет id."));
        return;
      }
      if (hasOwn(termIds, String(term.id))) {
        report.warnings.push(makeIssue("term", String(term.id), "id термина не уникален."));
      }
      termIds[String(term.id)] = true;
    });

    questions.forEach(function countQuestionId(question) {
      if (question && !isMissing(question.id)) {
        var id = String(question.id);
        questionIdCounts[id] = (questionIdCounts[id] || 0) + 1;
      }
    });

    questions.forEach(function validateQuestion(question, index) {
      var id = question && !isMissing(question.id) ? String(question.id) : "question@" + index;
      var blocking = [];

      ["id", "type", "topic", "questionRu", "questionDe"].forEach(function requireField(field) {
        if (!question || isMissing(question[field])) {
          blocking.push("нет " + field);
        }
      });

      if (question && !isMissing(question.id) && questionIdCounts[String(question.id)] > 1) {
        blocking.push("id не уникален");
      }

      if (question && !isMissing(question.type) && ALLOWED_TYPES.indexOf(question.type) === -1) {
        blocking.push("тип не входит в разрешённый список: " + question.type);
      }

      validateQuestionByType(question, blocking, report.warnings, id);

      if (blocking.length > 0) {
        report.errors.push(makeIssue("question", id, blocking.join("; ")));
        report.blockedQuestionIds.push(id);
      } else if (question && !isMissing(question.id)) {
        report.validQuestions.push(question);
        report.validQuestionIds.push(String(question.id));
      }

      if (question) {
        OPTIONAL_WARNING_FIELDS.forEach(function warnField(field) {
          if (isMissing(question[field])) {
            report.warnings.push(makeIssue("question", id, "нет " + field));
          }
        });

        asArray(question.relatedTerms).forEach(function warnMissingTerm(termId) {
          if (!hasOwn(termIds, String(termId))) {
            report.warnings.push(makeIssue("question", id, "relatedTerms содержит отсутствующий термин " + termId));
          }
        });
      }
    });

    var questionIds = {};
    questions.forEach(function collectQuestionId(question) {
      if (question && !isMissing(question.id)) {
        questionIds[String(question.id)] = true;
      }
    });

    readyAnswers.forEach(function validateReadyAnswer(answer, index) {
      var id = answer && answer.id ? String(answer.id) : "readyAnswer@" + index;
      asArray(answer && answer.relatedTermIds).forEach(function warnReadyTerm(termId) {
        if (!hasOwn(termIds, String(termId))) {
          report.warnings.push(makeIssue("readyAnswer", id, "relatedTermIds содержит отсутствующий термин " + termId));
        }
      });
      asArray(answer && answer.relatedQuestionIds).forEach(function warnReadyQuestion(questionId) {
        if (!hasOwn(questionIds, String(questionId))) {
          report.warnings.push(makeIssue("readyAnswer", id, "relatedQuestionIds содержит отсутствующий вопрос " + questionId));
        }
      });
    });

    report.valid = report.errors.length === 0;

    if (!options || options.log !== false) {
      logValidationReport(report);
    }

    return report;
  }

  function getEnabledTypes(settings) {
    var enabled = settings && settings.enabledTypes;
    if (enabled === "all" || !Array.isArray(enabled)) {
      return ALLOWED_TYPES.slice();
    }
    return enabled.filter(function filterType(type, index) {
      return ALLOWED_TYPES.indexOf(type) !== -1 && enabled.indexOf(type) === index;
    });
  }

  function getProgressStats(progress, questionId) {
    if (!progress || !questionId) {
      return {};
    }
    if (progress.questionStats && progress.questionStats[questionId]) {
      return progress.questionStats[questionId];
    }
    if (progress.perQuestion && progress.perQuestion[questionId]) {
      return progress.perQuestion[questionId];
    }
    return {};
  }

  function isWeakQuestion(question, progress) {
    var stats = getProgressStats(progress, question && question.id);
    var seen = Number(stats.seen) || 0;
    var correct = Number(stats.correct) || 0;
    var incorrect = Number(stats.incorrect) || 0;
    return incorrect > 0 && seen > 0 && correct / seen < 0.7;
  }

  function buildQuestionPool(data, settings, progress, validationReport) {
    var questions = asArray(data && data.questions);
    var report = validationReport || validateData(data, { log: false });
    var validMap = {};
    var mode = settings && settings.topicMode ? settings.topicMode : "gemischt";
    var enabledTypes = getEnabledTypes(settings);
    var mistakeIds = progress && Array.isArray(progress.mistakeIds) ? progress.mistakeIds : [];

    asArray(report.validQuestionIds).forEach(function markValid(id) {
      validMap[String(id)] = true;
    });

    return questions.filter(function filterQuestion(question) {
      if (!question || !question.id || !hasOwn(validMap, String(question.id))) {
        return false;
      }
      if (mode === "luft" && question.topic !== "luft") {
        return false;
      }
      if (mode === "wasser" && question.topic !== "wasser") {
        return false;
      }
      if (mode === "fehler" && mistakeIds.indexOf(question.id) === -1) {
        return false;
      }
      if (enabledTypes.indexOf(question.type) === -1) {
        return false;
      }
      return true;
    });
  }

  function createRoundQueueIds(pool, progress) {
    var mistakeIds = progress && Array.isArray(progress.mistakeIds) ? progress.mistakeIds : [];
    var priority = [];
    var regular = [];

    asArray(pool).forEach(function splitQuestion(question) {
      if (mistakeIds.indexOf(question.id) !== -1 || isWeakQuestion(question, progress)) {
        priority.push(question.id);
      } else {
        regular.push(question.id);
      }
    });

    return shuffle(priority).concat(shuffle(regular));
  }

  function getSavedQueueIds(savedState, poolIds) {
    var poolIdMap = {};
    var source = [];

    poolIds.forEach(function mark(id) {
      poolIdMap[String(id)] = true;
    });

    if (savedState && Array.isArray(savedState.questionQueue)) {
      source = savedState.questionQueue;
    } else if (savedState && Array.isArray(savedState.queue)) {
      source = savedState.queue.map(function mapLegacyQueue(item) {
        return item && item.id ? item.id : item;
      });
    }

    return unique(source).filter(function keepExisting(id) {
      return hasOwn(poolIdMap, String(id));
    });
  }

  function createQuestionQueue(questionPool, progress, savedState) {
    var pool = asArray(questionPool).filter(function hasId(question) {
      return question && question.id;
    });
    var poolIds = pool.map(function getId(question) {
      return question.id;
    });
    var questionById = toIdMap(pool);
    var savedQueue = getSavedQueueIds(savedState, poolIds);
    var questionQueue = savedQueue.length > 0 ? savedQueue : createRoundQueueIds(pool, progress);
    var queueCursor = savedState && savedQueue.length > 0
      ? clampInt(savedState.queueCursor, 0, questionQueue.length, 0)
      : 0;
    var totalHexes = savedState && savedState.settings ? Number(savedState.settings.totalHexes) : 0;
    var maxTurns = Math.min(90, Math.max((totalHexes || 0) * 2, pool.length));

    return {
      pool: pool,
      poolIds: poolIds,
      questionPool: poolIds.slice(),
      questionById: questionById,
      questionQueue: questionQueue,
      queue: questionQueue.map(function mapQuestion(id) {
        return questionById[id];
      }).filter(Boolean),
      queueCursor: queueCursor,
      currentQuestionId: savedState && savedState.currentQuestionId ? savedState.currentQuestionId : null,
      progress: progress || null,
      round: savedState && savedState.round ? Math.max(1, Number(savedState.round) || 1) : 1,
      repeated: false,
      exhausted: pool.length === 0,
      maxTurns: maxTurns
    };
  }

  function refreshQueueFromIds(queueState) {
    if (!queueState.questionById) {
      queueState.questionById = toIdMap(queueState.pool);
    }
    queueState.queue = asArray(queueState.questionQueue).map(function mapQuestion(id) {
      return queueState.questionById[id];
    }).filter(Boolean);
  }

  function startNewRound(queueState) {
    queueState.questionQueue = createRoundQueueIds(queueState.pool, queueState.progress);
    queueState.queueCursor = 0;
    queueState.round = (Number(queueState.round) || 1) + 1;
    queueState.repeated = true;
    refreshQueueFromIds(queueState);
  }

  function getNextQuestion(queueState) {
    if (!queueState || !Array.isArray(queueState.pool) || queueState.pool.length === 0) {
      return null;
    }

    if (!Array.isArray(queueState.questionQueue)) {
      queueState.questionQueue = getSavedQueueIds(queueState, queueState.poolIds || queueState.pool.map(function getId(question) {
        return question.id;
      }));
    }

    if (!queueState.questionById) {
      queueState.questionById = toIdMap(queueState.pool);
    }

    var attempts = 0;
    while (attempts < 2) {
      while (queueState.queueCursor < queueState.questionQueue.length) {
        var id = queueState.questionQueue[queueState.queueCursor];
        queueState.queueCursor += 1;
        if (queueState.questionById[id]) {
          queueState.currentQuestionId = id;
          return queueState.questionById[id];
        }
      }

      startNewRound(queueState);
      attempts += 1;
    }

    return null;
  }

  function normalizeChoiceInput(answer) {
    if (answer && typeof answer === "object" && !Array.isArray(answer)) {
      if (Array.isArray(answer.selectedIds)) {
        return answer.selectedIds;
      }
      if (Array.isArray(answer.answers)) {
        return answer.answers;
      }
      if (answer.answer != null) {
        return asList(answer.answer);
      }
    }
    return Array.isArray(answer) ? answer : asList(answer);
  }

  function sameSet(expected, actual) {
    var expectedList = unique(expected).map(String).sort();
    var actualList = unique(actual).map(String).sort();
    return expectedList.length === actualList.length && expectedList.every(function compare(value, index) {
      return value === actualList[index];
    });
  }

  function checkChoice(question, answer) {
    return sameSet(getChoiceAnswerIds(question), normalizeChoiceInput(answer));
  }

  function getAnswerForBlank(answer, blank, index) {
    if (Array.isArray(answer)) {
      return answer[index];
    }
    if (answer && typeof answer === "object") {
      if (blank && blank.id && hasOwn(answer, blank.id)) {
        return answer[blank.id];
      }
      if (hasOwn(answer, String(index))) {
        return answer[String(index)];
      }
    }
    return index === 0 ? answer : undefined;
  }

  function checkFillBlank(question, answer) {
    var blanks = asArray(question.blanks);
    if (blanks.length === 0) {
      return false;
    }

    return blanks.every(function checkBlank(blank, index) {
      var mode = blank && blank.normalizeMode ? blank.normalizeMode : "text";
      var value = getAnswerForBlank(answer, blank, index);
      if (value == null || value === "") {
        return false;
      }
      return asArray(blank.acceptedAnswers).some(function checkAccepted(accepted) {
        return sameByMode(accepted, value, mode);
      });
    });
  }

  function checkOrdering(question, answer) {
    var expected = getCorrectOrder(question).map(String);
    var actual = normalizeChoiceInput(answer).map(String);
    return expected.length === actual.length && expected.every(function compare(item, index) {
      return item === actual[index];
    });
  }

  function getPairValue(pair, left) {
    if (Array.isArray(pair)) {
      return left ? pair[0] : pair[1];
    }
    if (!pair) {
      return "";
    }
    return left
      ? (pair.leftId || pair.left || pair.source || pair.term)
      : (pair.rightId || pair.right || pair.target || pair.match);
  }

  function pairKey(pair) {
    return normalizeText(getPairValue(pair, true)) + " => " + normalizeText(getPairValue(pair, false));
  }

  function normalizeMatchingAnswer(answer) {
    if (Array.isArray(answer)) {
      return answer;
    }
    if (answer && typeof answer === "object") {
      return Object.keys(answer).map(function mapPair(left) {
        return { left: left, right: answer[left] };
      });
    }
    return [];
  }

  function checkMatching(question, answer) {
    var expected = asArray(question.pairs);
    var actual = normalizeMatchingAnswer(answer);
    var actualMap = {};

    if (expected.length === 0 || expected.length !== actual.length) {
      return false;
    }

    actual.forEach(function add(pair) {
      actualMap[pairKey(pair)] = true;
    });

    return expected.every(function pairExists(pair) {
      return hasOwn(actualMap, pairKey(pair));
    });
  }

  function normalizeCategorizationAnswer(answer) {
    var result = {};

    if (Array.isArray(answer)) {
      answer.forEach(function add(item) {
        if (item && item.itemId != null) {
          result[String(item.itemId)] = item.categoryId || item.correctCategoryId;
        }
      });
      return result;
    }

    if (!answer || typeof answer !== "object") {
      return result;
    }

    Object.keys(answer).forEach(function add(key) {
      var value = answer[key];
      if (Array.isArray(value)) {
        value.forEach(function addItemId(itemId) {
          result[String(itemId)] = key;
        });
      } else {
        result[key] = value;
      }
    });

    return result;
  }

  function checkCategorization(question, answer) {
    var items = asArray(question.items);
    var actual = normalizeCategorizationAnswer(answer);

    return items.length > 0 && items.every(function checkItem(item) {
      return item && hasOwn(actual, String(item.id)) && String(actual[item.id]) === String(getItemCategoryId(item));
    });
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      var normalized = normalizeText(value);
      if (["true", "richtig", "wahr", "ja", "yes"].indexOf(normalized) !== -1) {
        return true;
      }
      if (["false", "falsch", "nein", "no"].indexOf(normalized) !== -1) {
        return false;
      }
    }
    return undefined;
  }

  function checkTrueFalse(question, answer) {
    var statements = asArray(question.statements);
    var actual = answer && typeof answer === "object" ? answer : {};

    return statements.length > 0 && statements.every(function checkStatement(statement) {
      if (!statement || !hasOwn(actual, statement.id)) {
        return false;
      }
      return parseBoolean(actual[statement.id]) === statement.answer;
    });
  }

  function analyzeShortAnswer(question, answer) {
    var text = normalizeText(answer);
    var groups = asArray(question && question.requiredTermGroups);
    var foundGroups = [];
    var missingGroups = [];

    groups.forEach(function checkGroup(group, index) {
      var terms = getShortAnswerTerms(group);
      var foundTerms = terms.filter(function hasTerm(term) {
        return text.indexOf(normalizeText(term)) !== -1;
      });
      var entry = {
        id: getShortAnswerGroupId(group, index),
        index: index,
        accepted: terms,
        foundTerms: foundTerms
      };

      if (foundTerms.length > 0) {
        foundGroups.push(entry);
      } else {
        missingGroups.push(entry);
      }
    });

    var minRequired = Math.max(0, Number(question && question.minRequiredGroups) || 0);
    var passesTermThreshold = text.length > 0 && foundGroups.length >= minRequired;

    return {
      empty: text.length === 0,
      foundGroups: foundGroups,
      missingGroups: missingGroups,
      foundCount: foundGroups.length,
      requiredCount: minRequired,
      totalGroups: groups.length,
      passesTermThreshold: passesTermThreshold,
      warning: text.length > 0 && !passesTermThreshold
        ? "В ответе найдено меньше обязательных Fachbegriffe, чем ожидается."
        : ""
    };
  }

  function checkAnswer(question, answer) {
    if (!question || !question.type) {
      return { correct: false, needsSelfCheck: false, isFinal: true, details: null };
    }

    if (question.type === "single_choice" || question.type === "multiple_choice") {
      return { correct: checkChoice(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "true_false") {
      return { correct: checkTrueFalse(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "fill_blank") {
      return { correct: checkFillBlank(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "ordering") {
      return { correct: checkOrdering(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "matching") {
      return { correct: checkMatching(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "categorization") {
      return { correct: checkCategorization(question, answer), needsSelfCheck: false, isFinal: true, details: null };
    }
    if (question.type === "short_answer") {
      var analysis = analyzeShortAnswer(question, answer);
      return {
        correct: analysis.passesTermThreshold,
        needsSelfCheck: true,
        isFinal: false,
        details: analysis
      };
    }
    return { correct: false, needsSelfCheck: false, isFinal: true, details: null };
  }

  function optionTextById(question) {
    var map = {};
    asArray(question.options).forEach(function add(option) {
      if (option && option.id != null) {
        map[String(option.id)] = option.text || option.label || option.id;
      }
    });
    return map;
  }

  function itemTextById(question) {
    var map = {};
    asArray(question.items).forEach(function add(item) {
      if (item && item.id != null) {
        map[String(item.id)] = item.text || item.label || item.id;
      }
    });
    return map;
  }

  function categoryLabelById(question) {
    var map = {};
    asArray(question.categories).forEach(function add(category) {
      var id = typeof category === "string" ? category : category && category.id;
      var label = typeof category === "string" ? category : category && (category.label || category.text || category.id);
      if (id != null) {
        map[String(id)] = label || id;
      }
    });
    return map;
  }

  function formatCorrectAnswer(question) {
    if (!question) {
      return "";
    }
    if (question.sampleAnswer) {
      return question.sampleAnswer;
    }
    if (question.correctAnswerText) {
      return question.correctAnswerText;
    }

    if (question.type === "single_choice" || question.type === "multiple_choice") {
      var optionMap = optionTextById(question);
      return getChoiceAnswerIds(question).map(function formatOption(answerId) {
        return optionMap[String(answerId)] || answerId;
      }).join(", ");
    }

    if (question.type === "fill_blank") {
      return asArray(question.blanks).map(function blankText(blank) {
        return blank.displayAnswer || asArray(blank.acceptedAnswers)[0] || "";
      }).join(", ");
    }

    if (question.type === "ordering") {
      var itemMap = itemTextById(question);
      return getCorrectOrder(question).map(function formatItem(itemId) {
        return itemMap[String(itemId)] || itemId;
      }).join(" → ");
    }

    if (question.type === "true_false") {
      return asArray(question.statements).map(function statementText(statement) {
        return statement.text + " — " + (statement.answer ? "richtig" : "falsch");
      }).join("; ");
    }

    if (question.type === "categorization") {
      var categoryMap = categoryLabelById(question);
      var grouped = {};
      asArray(question.items).forEach(function groupItem(item) {
        var categoryId = String(getItemCategoryId(item));
        if (!grouped[categoryId]) {
          grouped[categoryId] = [];
        }
        grouped[categoryId].push(item.text || item.id);
      });

      return Object.keys(grouped).map(function formatGroup(categoryId) {
        return (categoryMap[categoryId] || categoryId) + ": " + grouped[categoryId].join(", ");
      }).join("; ");
    }

    if (question.type === "matching") {
      return asArray(question.pairs).map(function pairText(item) {
        return getPairValue(item, true) + " → " + getPairValue(item, false);
      }).join("; ");
    }

    return String(question.answer || question.answers || "");
  }

  function buildCorrectAnswerForCheck(question) {
    if (!question) {
      return null;
    }
    if (question.type === "single_choice") {
      return question.answer;
    }
    if (question.type === "multiple_choice") {
      return asArray(question.answers);
    }
    if (question.type === "matching") {
      return asArray(question.pairs);
    }
    if (question.type === "fill_blank") {
      return asArray(question.blanks).map(function firstAccepted(blank) {
        return asArray(blank.acceptedAnswers)[0];
      });
    }
    if (question.type === "ordering") {
      return getCorrectOrder(question);
    }
    if (question.type === "true_false") {
      var tf = {};
      asArray(question.statements).forEach(function add(statement) {
        tf[statement.id] = statement.answer;
      });
      return tf;
    }
    if (question.type === "categorization") {
      var categories = {};
      asArray(question.items).forEach(function add(item) {
        categories[item.id] = getItemCategoryId(item);
      });
      return categories;
    }
    if (question.type === "short_answer") {
      return question.sampleAnswer || "";
    }
    return null;
  }

  function makeSelfCheck(name, ok, details) {
    return {
      name: name,
      ok: Boolean(ok),
      details: details || ""
    };
  }

  function logSelfCheck(result) {
    if (!global.console) {
      return;
    }
    var failed = result.checks.filter(function failedCheck(check) {
      return !check.ok;
    });
    if (failed.length === 0) {
      global.console.info("ChemistryEngine self-check passed (" + result.checks.length + " checks).", result);
    } else {
      global.console.warn("ChemistryEngine self-check failed (" + failed.length + " checks).", result);
    }
  }

  function runSelfCheck(data, options) {
    var report = validateData(data, { log: false });
    var questions = asArray(data && data.questions);
    var typeSet = {};
    var topicCounts = {};
    var checks = [];

    questions.forEach(function collect(question) {
      if (question) {
        typeSet[question.type] = true;
        topicCounts[question.topic] = (topicCounts[question.topic] || 0) + 1;
      }
    });

    checks.push(makeSelfCheck("55 вопросов", questions.length === 55, questions.length));
    checks.push(makeSelfCheck("25 Luft", topicCounts.luft === 25, topicCounts.luft || 0));
    checks.push(makeSelfCheck("30 Wasser", topicCounts.wasser === 30, topicCounts.wasser || 0));
    checks.push(makeSelfCheck("все 8 типов", ALLOWED_TYPES.every(function hasType(type) {
      return Boolean(typeSet[type]);
    }), Object.keys(typeSet).sort().join(", ")));
    checks.push(makeSelfCheck("валидация без ошибок", report.errors.length === 0, report.errors.length + " errors"));
    checks.push(makeSelfCheck("relatedTerms/readyAnswers без предупреждений", report.warnings.length === 0, report.warnings.length + " warnings"));

    var w28 = questions.filter(function findW28(question) {
      return question && question.id === "W28";
    })[0];
    checks.push(makeSelfCheck("W28 имеет items", Boolean(w28 && Array.isArray(w28.items) && w28.items.length > 0), w28 && w28.items ? w28.items.length : 0));

    checks.push(makeSelfCheck("H2O/H₂O", normalizeFormula("H2O") === normalizeFormula("H₂O"), normalizeFormula("H₂O")));
    checks.push(makeSelfCheck("Na+/Na⁺", normalizeFormula("Na+") === normalizeFormula("Na⁺") && normalizeFormula("Na^+") === normalizeFormula("Na⁺"), normalizeFormula("Na⁺")));
    checks.push(makeSelfCheck("SO4^2-/SO₄²⁻", normalizeFormula("SO4^2-") === normalizeFormula("SO₄²⁻") && normalizeFormula("SO4 2-") === normalizeFormula("SO₄²⁻"), normalizeFormula("SO₄²⁻")));
    checks.push(makeSelfCheck("delta+/δ⁺", normalizeFormula("delta+") === normalizeFormula("δ⁺") && normalizeFormula("delta-") === normalizeFormula("δ⁻"), normalizeFormula("δ⁺")));

    ALLOWED_TYPES.forEach(function checkType(type) {
      var question = questions.filter(function findByType(item) {
        return item && item.type === type;
      })[0];
      var answer = buildCorrectAnswerForCheck(question);
      var result = checkAnswer(question, answer);
      var ok = type === "short_answer"
        ? Boolean(result.needsSelfCheck && result.details && result.details.passesTermThreshold)
        : Boolean(result.correct);
      checks.push(makeSelfCheck("правильный ответ: " + type, ok, question && question.id));
    });

    var resultObject = {
      ok: checks.every(function isOk(check) {
        return check.ok;
      }),
      checks: checks,
      validation: report
    };

    if (options && options.log) {
      logSelfCheck(resultObject);
    }

    return resultObject;
  }

  var api = {
    allowedTypes: ALLOWED_TYPES.slice(),
    validateData: validateData,
    buildQuestionPool: buildQuestionPool,
    createQuestionQueue: createQuestionQueue,
    getNextQuestion: getNextQuestion,
    checkAnswer: checkAnswer,
    normalizeText: normalizeText,
    normalizeFormula: normalizeFormula,
    analyzeShortAnswer: analyzeShortAnswer,
    formatCorrectAnswer: formatCorrectAnswer,
    runSelfCheck: runSelfCheck
  };

  global.ChemistryEngine = api;
  global.validateChemieData = validateData;
})(typeof window !== "undefined" ? window : globalThis);
