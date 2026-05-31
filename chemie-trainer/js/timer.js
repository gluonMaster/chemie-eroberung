// js/timer.js - Task timer with soft/hard modes and visual progress.
(function attachTimer(global) {
  "use strict";

  var SOFT_FILL_SECONDS = 90;
  var COLOR_CLASSES = ["timer-green", "timer-yellow", "timer-red"];

  var intervalId = null;
  var running = false;
  var paused = false;
  var hardMode = false;
  var totalSeconds = SOFT_FILL_SECONDS;
  var totalMs = SOFT_FILL_SECONDS * 1000;
  var startedAtMs = 0;
  var elapsedBeforePauseMs = 0;
  var timeUpFired = false;
  var onTimeUpHandler = null;

  function byId(id) {
    if (!global.document || typeof global.document.getElementById !== "function") {
      return null;
    }
    return global.document.getElementById(id);
  }

  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function toSeconds(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return fallback;
    }
    return num;
  }

  function getFillElement() {
    var fill = byId("timer-bar-fill");
    if (fill) {
      return fill;
    }

    // Compatibility fallback for older markup where #timer-bar was the fill node.
    return byId("timer-bar");
  }

  function setFillWidth(percent) {
    var fill = getFillElement();
    if (!fill || !fill.style) {
      return;
    }
    fill.style.width = String(clamp(percent, 0, 100)) + "%";
  }

  function setFillColor(className) {
    var fill = getFillElement();
    if (!fill || !fill.classList) {
      return;
    }

    for (var i = 0; i < COLOR_CLASSES.length; i += 1) {
      fill.classList.remove(COLOR_CLASSES[i]);
    }
    if (className) {
      fill.classList.add(className);
    }
  }

  function setPulse(active) {
    var textEl = byId("timer-text");
    if (!textEl || !textEl.classList) {
      return;
    }
    textEl.classList.toggle("timer-pulse", Boolean(active));
  }

  function setText(text) {
    var textEl = byId("timer-text");
    if (!textEl) {
      return;
    }
    textEl.textContent = text;
  }

  function pad2(value) {
    var intValue = Math.floor(Math.max(0, value));
    return intValue < 10 ? "0" + String(intValue) : String(intValue);
  }

  function formatSeconds(seconds) {
    var safeSeconds = Math.floor(Math.max(0, seconds));
    if (safeSeconds < 60) {
      return String(safeSeconds);
    }

    var minutes = Math.floor(safeSeconds / 60);
    var restSeconds = safeSeconds % 60;
    return pad2(minutes) + ":" + pad2(restSeconds);
  }

  function stopInterval() {
    if (intervalId !== null) {
      global.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function getElapsedMsInternal() {
    if (!running) {
      return Math.max(0, elapsedBeforePauseMs);
    }
    return Math.max(0, elapsedBeforePauseMs + (Date.now() - startedAtMs));
  }

  function render(elapsedMs) {
    var elapsed = Math.max(0, elapsedMs);

    if (hardMode) {
      var remainingMs = Math.max(0, totalMs - elapsed);
      var remainingRatio = totalMs > 0 ? remainingMs / totalMs : 0;
      var remainingSeconds = Math.ceil(remainingMs / 1000);

      setFillWidth(remainingRatio * 100);
      setText(formatSeconds(remainingSeconds));

      if (remainingSeconds <= 10) {
        setFillColor("timer-red");
      } else if (remainingRatio > 0.5) {
        setFillColor("timer-green");
      } else {
        setFillColor("timer-yellow");
      }

      setPulse(remainingSeconds <= 10);
      return;
    }

    var softRatio = clamp(elapsed / (SOFT_FILL_SECONDS * 1000), 0, 1);
    var elapsedSeconds = Math.floor(elapsed / 1000);

    setFillWidth(softRatio * 100);
    setText(formatSeconds(elapsedSeconds));
    setFillColor(softRatio < 0.5 ? "timer-green" : "timer-yellow");
    setPulse(false);
  }

  function fireTimeUpIfNeeded() {
    if (!hardMode || timeUpFired) {
      return;
    }

    if (getElapsedMsInternal() < totalMs) {
      return;
    }

    timeUpFired = true;
    stopInterval();
    running = false;
    paused = false;
    elapsedBeforePauseMs = totalMs;
    render(elapsedBeforePauseMs);

    if (typeof onTimeUpHandler === "function") {
      onTimeUpHandler();
    }
  }

  function tick() {
    var elapsed = getElapsedMsInternal();
    render(elapsed);
    fireTimeUpIfNeeded();
  }

  function start(totalSecondsArg, isHardArg, onTimeUpArg) {
    stopInterval();

    running = true;
    paused = false;
    hardMode = Boolean(isHardArg);
    totalSeconds = toSeconds(totalSecondsArg, SOFT_FILL_SECONDS);
    totalMs = Math.round(totalSeconds * 1000);
    startedAtMs = Date.now();
    elapsedBeforePauseMs = 0;
    timeUpFired = false;
    onTimeUpHandler = typeof onTimeUpArg === "function" ? onTimeUpArg : null;

    render(0);
    intervalId = global.setInterval(tick, 1000);

    return 0;
  }

  function stop() {
    if (running) {
      elapsedBeforePauseMs += Math.max(0, Date.now() - startedAtMs);
    }

    if (hardMode) {
      elapsedBeforePauseMs = Math.min(elapsedBeforePauseMs, totalMs);
    }

    stopInterval();
    running = false;
    paused = false;
    render(elapsedBeforePauseMs);
    setPulse(false);

    return Math.round(Math.max(0, elapsedBeforePauseMs));
  }

  function pause() {
    if (!running) {
      return;
    }

    elapsedBeforePauseMs += Math.max(0, Date.now() - startedAtMs);
    if (hardMode) {
      elapsedBeforePauseMs = Math.min(elapsedBeforePauseMs, totalMs);
    }

    stopInterval();
    running = false;
    paused = true;
    render(elapsedBeforePauseMs);
    setPulse(false);
  }

  function resume() {
    if (!paused) {
      return;
    }

    if (hardMode && elapsedBeforePauseMs >= totalMs) {
      paused = false;
      render(totalMs);
      return;
    }

    startedAtMs = Date.now();
    running = true;
    paused = false;
    stopInterval();
    intervalId = global.setInterval(tick, 1000);
    render(getElapsedMsInternal());
  }

  function reset() {
    stopInterval();
    running = false;
    paused = false;
    elapsedBeforePauseMs = 0;
    startedAtMs = 0;
    timeUpFired = false;
    render(0);
    setPulse(false);
  }

  function getElapsed() {
    var elapsed = getElapsedMsInternal();
    if (hardMode) {
      elapsed = Math.min(elapsed, totalMs);
    }
    return Math.round(Math.max(0, elapsed));
  }

  function isRunning() {
    return running;
  }

  var api = {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    reset: reset,
    getElapsed: getElapsed,
    isRunning: isRunning
  };

  global.Timer = api;
  global.GameTimer = api;
})(typeof window !== "undefined" ? window : globalThis);
