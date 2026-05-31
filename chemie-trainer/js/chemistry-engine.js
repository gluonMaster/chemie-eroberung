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

  var SUBSCRIPT = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9"
  };

  var SUPERSCRIPT = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "-"
  };

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeFormula(value) {
    var text = String(value == null ? "" : value).trim().replace(/\s+/g, "");
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

    return output
      .replace(/\^\+/g, "+")
      .replace(/\^-/g, "-")
      .replace(/([A-Za-z0-9)])\^1([+-])/g, "$1$2");
  }

  function normalizeText(value) {
    return normalizeFormula(value)
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[.,;:!?()[\]{}"']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameText(a, b) {
    return normalizeText(a) === normalizeText(b);
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

  function validateData(data) {
    var result = {
      errors: [],
      warnings: [],
      blockedQuestionIds: [],
      validQuestionIds: []
    };

    if (!data || typeof data !== "object") {
      result.errors.push({ scope: "data", message: "CHEMIE_DATA отсутствует." });
      return result;
    }

    var terms = asArray(data.terms);
    var questions = asArray(data.questions);
    var readyAnswers = asArray(data.readyAnswers);

    if (!Array.isArray(data.terms)) {
      result.errors.push({ scope: "terms", message: "terms должен быть массивом." });
    }
    if (!Array.isArray(data.questions)) {
      result.errors.push({ scope: "questions", message: "questions должен быть массивом." });
    }
    if (!Array.isArray(data.readyAnswers)) {
      result.errors.push({ scope: "readyAnswers", message: "readyAnswers должен быть массивом." });
    }

    var termIds = {};
    terms.forEach(function validateTerm(term, index) {
      if (!term || !term.id) {
        result.warnings.push({ scope: "term", id: "term@" + index, message: "У термина нет id." });
        return;
      }
      termIds[term.id] = true;
    });

    var questionIds = {};
    questions.forEach(function validateQuestion(question, index) {
      var id = question && question.id ? String(question.id) : "question@" + index;
      var blocking = [];

      ["id", "type", "topic", "questionRu", "questionDe"].forEach(function requireField(field) {
        if (!question || !question[field]) {
          blocking.push("нет " + field);
        }
      });

      if (question && question.id && hasOwn(questionIds, question.id)) {
        blocking.push("id не уникален");
      }
      if (question && question.id) {
        questionIds[question.id] = true;
      }

      if (question && ALLOWED_TYPES.indexOf(question.type) === -1) {
        blocking.push("неизвестный тип " + question.type);
      }

      if (question && (question.type === "single_choice" || question.type === "multiple_choice")) {
        var optionIds = {};
        asArray(question.options).forEach(function collectOption(option) {
          if (option && option.id) {
            optionIds[option.id] = true;
          }
        });
        asArray(question.answer).concat(question.correctAnswer || []).forEach(function checkOption(answerId) {
          if (answerId && !hasOwn(optionIds, answerId)) {
            blocking.push("ответ ссылается на отсутствующий option id " + answerId);
          }
        });
      }

      if (question && question.type === "fill_blank") {
        if (!Array.isArray(question.blanks) || question.blanks.length === 0) {
          blocking.push("у fill_blank нет blanks");
        } else {
          question.blanks.forEach(function checkBlank(blank) {
            if (!blank || !Array.isArray(blank.acceptedAnswers) || blank.acceptedAnswers.length === 0) {
              blocking.push("у blank нет acceptedAnswers");
            }
          });
        }
      }

      if (question && question.type === "matching" && (!Array.isArray(question.pairs) || question.pairs.length === 0)) {
        blocking.push("у matching нет pairs");
      }

      if (question && question.type === "categorization") {
        var categories = {};
        asArray(question.categories).forEach(function collectCategory(category) {
          var categoryId = typeof category === "string" ? category : category && category.id;
          if (categoryId) {
            categories[categoryId] = true;
          }
        });
        asArray(question.items).forEach(function checkItem(item) {
          if (item && item.categoryId && !hasOwn(categories, item.categoryId)) {
            blocking.push("item ссылается на отсутствующую категорию " + item.categoryId);
          }
        });
      }

      if (question && question.type === "ordering") {
        var itemIds = {};
        asArray(question.items).forEach(function collectItem(item) {
          if (item && item.id) {
            itemIds[item.id] = true;
          }
        });
        asArray(question.order || question.answer).forEach(function checkOrder(itemId) {
          if (itemId && !hasOwn(itemIds, itemId)) {
            blocking.push("порядок содержит неизвестный item id " + itemId);
          }
        });
      }

      if (question && question.type === "short_answer") {
        ["sampleAnswer", "criteria", "requiredTermGroups", "minRequiredGroups"].forEach(function requireShort(field) {
          if (!question[field]) {
            blocking.push("у short_answer нет " + field);
          }
        });
      }

      if (blocking.length > 0) {
        result.errors.push({ scope: "question", id: id, message: blocking.join("; ") });
        result.blockedQuestionIds.push(id);
      } else if (question && question.id) {
        result.validQuestionIds.push(question.id);
      }

      if (question) {
        ["instructionRu", "explanationRu", "explanationDe", "difficulty"].forEach(function warnField(field) {
          if (!question[field]) {
            result.warnings.push({ scope: "question", id: id, message: "нет " + field });
          }
        });
        asArray(question.relatedTerms).forEach(function warnMissingTerm(termId) {
          if (!hasOwn(termIds, termId)) {
            result.warnings.push({ scope: "question", id: id, message: "relatedTerms содержит отсутствующий термин " + termId });
          }
        });
      }
    });

    readyAnswers.forEach(function validateReadyAnswer(answer) {
      asArray(answer && answer.relatedTermIds).forEach(function warnReadyTerm(termId) {
        if (!hasOwn(termIds, termId)) {
          result.warnings.push({ scope: "readyAnswer", id: answer.id || "readyAnswer", message: "relatedTermIds содержит отсутствующий термин " + termId });
        }
      });
      asArray(answer && answer.relatedQuestionIds).forEach(function warnReadyQuestion(questionId) {
        if (!hasOwn(questionIds, questionId)) {
          result.warnings.push({ scope: "readyAnswer", id: answer.id || "readyAnswer", message: "relatedQuestionIds содержит отсутствующий вопрос " + questionId });
        }
      });
    });

    return result;
  }

  function buildQuestionPool(data, settings, progress) {
    var questions = asArray(data && data.questions);
    var mode = settings && settings.topicMode ? settings.topicMode : "gemischt";
    var enabledTypes = settings && settings.enabledTypes ? settings.enabledTypes : "all";
    var allowedByValidation = validateData(data).blockedQuestionIds.reduce(function buildMap(map, id) {
      map[id] = true;
      return map;
    }, {});
    var mistakeIds = progress && Array.isArray(progress.mistakeIds) ? progress.mistakeIds : [];

    return questions.filter(function filterQuestion(question) {
      if (!question || !question.id || hasOwn(allowedByValidation, question.id)) {
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
      if (enabledTypes !== "all" && Array.isArray(enabledTypes) && enabledTypes.indexOf(question.type) === -1) {
        return false;
      }
      return true;
    });
  }

  function createQuestionQueue(questionPool, progress) {
    var pool = asArray(questionPool);
    var mistakes = progress && Array.isArray(progress.mistakeIds) ? progress.mistakeIds : [];
    var weak = pool.filter(function isMistake(question) {
      return question && mistakes.indexOf(question.id) !== -1;
    });
    var regular = pool.filter(function isRegular(question) {
      return !question || mistakes.indexOf(question.id) === -1;
    });

    return {
      pool: pool.slice(),
      queue: shuffle(weak).concat(shuffle(regular)),
      round: 1,
      repeated: false
    };
  }

  function getNextQuestion(queueState) {
    if (!queueState || !Array.isArray(queueState.pool) || queueState.pool.length === 0) {
      return null;
    }
    if (!Array.isArray(queueState.queue)) {
      queueState.queue = [];
    }
    if (queueState.queue.length === 0) {
      queueState.queue = shuffle(queueState.pool);
      queueState.round = (queueState.round || 1) + 1;
      queueState.repeated = true;
    }
    return queueState.queue.shift() || null;
  }

  function checkChoice(question, answer) {
    var expected = question.answer || question.correctAnswer || [];
    var expectedList = Array.isArray(expected) ? expected.slice().sort() : [expected];
    var answerList = Array.isArray(answer) ? answer.slice().sort() : [answer];
    return expectedList.length === answerList.length && expectedList.every(function compare(value, index) {
      return String(value) === String(answerList[index]);
    });
  }

  function checkFillBlank(question, answer) {
    var blanks = asArray(question.blanks);
    var answers = Array.isArray(answer) ? answer : [answer];
    if (answers.length < blanks.length) {
      return false;
    }
    return blanks.every(function checkBlank(blank, index) {
      return asArray(blank.acceptedAnswers).some(function checkAccepted(accepted) {
        return sameText(accepted, answers[index]);
      });
    });
  }

  function checkOrdering(question, answer) {
    var expected = asArray(question.order || question.answer);
    var actual = asArray(answer);
    return expected.length === actual.length && expected.every(function compare(item, index) {
      return String(item) === String(actual[index]);
    });
  }

  function checkMatching(question, answer) {
    var expectedPairs = asArray(question.pairs);
    var actualPairs = asArray(answer);
    if (expectedPairs.length !== actualPairs.length) {
      return false;
    }
    return expectedPairs.every(function pairExists(pair) {
      return actualPairs.some(function compare(actual) {
        return String(actual.leftId || actual[0]) === String(pair.leftId || pair[0])
          && String(actual.rightId || actual[1]) === String(pair.rightId || pair[1]);
      });
    });
  }

  function checkCategorization(question, answer) {
    var items = asArray(question.items);
    var actual = answer && typeof answer === "object" ? answer : {};
    return items.every(function checkItem(item) {
      return item && String(actual[item.id]) === String(item.categoryId);
    });
  }

  function analyzeShortAnswer(question, answer) {
    var text = normalizeText(answer);
    var groups = asArray(question && question.requiredTermGroups);
    var foundGroups = [];

    groups.forEach(function checkGroup(group, index) {
      var terms = Array.isArray(group) ? group : asArray(group && group.terms);
      var found = terms.some(function hasTerm(term) {
        return text.indexOf(normalizeText(term)) !== -1;
      });
      if (found) {
        foundGroups.push(index);
      }
    });

    var minRequired = Math.max(0, Number(question && question.minRequiredGroups) || 0);
    var score = groups.length > 0 ? foundGroups.length / groups.length : 0;
    return {
      empty: text.length === 0,
      foundGroups: foundGroups,
      foundCount: foundGroups.length,
      requiredCount: minRequired,
      score: score,
      passed: text.length > 0 && foundGroups.length >= minRequired,
      warning: text.length > 0 && foundGroups.length < minRequired
        ? "В ответе найдено меньше обязательных Fachbegriffe, чем ожидается."
        : ""
    };
  }

  function checkAnswer(question, answer) {
    if (!question || !question.type) {
      return { correct: false, needsSelfCheck: false, details: null };
    }

    if (question.type === "single_choice" || question.type === "multiple_choice") {
      return { correct: checkChoice(question, answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "true_false") {
      return { correct: Boolean(answer) === Boolean(question.answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "fill_blank") {
      return { correct: checkFillBlank(question, answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "ordering") {
      return { correct: checkOrdering(question, answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "matching") {
      return { correct: checkMatching(question, answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "categorization") {
      return { correct: checkCategorization(question, answer), needsSelfCheck: false, details: null };
    }
    if (question.type === "short_answer") {
      var analysis = analyzeShortAnswer(question, answer);
      return { correct: analysis.passed, needsSelfCheck: true, details: analysis };
    }
    return { correct: false, needsSelfCheck: false, details: null };
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
      var answerIds = asArray(question.answer || question.correctAnswer);
      return asArray(question.options).filter(function isCorrect(option) {
        return option && answerIds.indexOf(option.id) !== -1;
      }).map(function optionText(option) {
        return option.text || option.label || option.id;
      }).join(", ");
    }
    if (question.type === "fill_blank") {
      return asArray(question.blanks).map(function blankText(blank) {
        return asArray(blank.acceptedAnswers)[0] || "";
      }).join(", ");
    }
    if (question.type === "ordering") {
      return asArray(question.order || question.answer).join(" ");
    }
    return String(question.answer || "");
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
    formatCorrectAnswer: formatCorrectAnswer
  };

  global.ChemistryEngine = api;
  global.validateChemieData = validateData;
})(typeof window !== "undefined" ? window : globalThis);
