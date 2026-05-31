// js/map-renderer.js - SVG map rendering and capture animations
(function attachMapRenderer(global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var ANIMATION_TIMEOUT_MS = 700;

  var state = {
    svg: null,
    polygonsById: {},
    highlightedIds: {}
  };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function normalizeOwner(owner) {
    return owner === "player" ? "player" : "computer";
  }

  function getOwnerFill(owner) {
    var normalized = normalizeOwner(owner);
    if (normalized === "player") {
      return "var(--color-player, #4A90D9)";
    }
    return "var(--color-computer, #E87C3E)";
  }

  function getRegionClass(owner) {
    return normalizeOwner(owner) === "player" ? "region-player" : "region-computer";
  }

  function getLegacyOwnerClass(owner) {
    return normalizeOwner(owner) === "player" ? "owner-player" : "owner-computer";
  }

  function resolveSvgElement(svgElement) {
    if (svgElement && svgElement.namespaceURI === SVG_NS) {
      return svgElement;
    }

    if (!global.document || typeof global.document.getElementById !== "function") {
      return null;
    }

    var fallback = global.document.getElementById("game-map");
    if (fallback && fallback.namespaceURI === SVG_NS) {
      return fallback;
    }

    return null;
  }

  function clearSvg(svg) {
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  }

  function toPointsString(vertices) {
    if (!Array.isArray(vertices)) {
      return "";
    }

    var points = [];
    for (var i = 0; i < vertices.length; i += 1) {
      var vertex = vertices[i] || {};
      var x = isFiniteNumber(vertex.x) ? vertex.x : 0;
      var y = isFiniteNumber(vertex.y) ? vertex.y : 0;
      points.push(String(x) + "," + String(y));
    }

    return points.join(" ");
  }

  function setOwnerVisualState(polygon, owner) {
    if (!polygon || !polygon.classList) {
      return;
    }

    var normalizedOwner = normalizeOwner(owner);

    polygon.classList.remove("region-player", "region-computer", "owner-player", "owner-computer");
    polygon.classList.add(getRegionClass(normalizedOwner));
    polygon.classList.add(getLegacyOwnerClass(normalizedOwner));
    polygon.setAttribute("fill", getOwnerFill(normalizedOwner));
    polygon.setAttribute("data-owner", normalizedOwner);
  }

  function createRegionPolygon(region) {
    var polygon = global.document.createElementNS(SVG_NS, "polygon");

    polygon.setAttribute("points", toPointsString(region.vertices));
    polygon.setAttribute("data-region-id", String(region.id));
    polygon.setAttribute("class", "region");
    polygon.setAttribute("stroke", "var(--color-border, #2C3E50)");
    polygon.setAttribute("stroke-width", "1.5");
    polygon.setAttribute("vector-effect", "non-scaling-stroke");
    polygon.style.transition = "fill 0.5s ease-in-out, filter 0.2s ease";

    setOwnerVisualState(polygon, region.owner);
    return polygon;
  }

  function resetState(svg) {
    state.svg = svg;
    state.polygonsById = {};
    state.highlightedIds = {};
  }

  function rememberPolygon(regionId, polygon) {
    state.polygonsById[String(regionId)] = polygon;
  }

  function getPolygon(regionId) {
    var key = String(regionId);

    if (state.polygonsById[key]) {
      return state.polygonsById[key];
    }

    if (!state.svg || typeof state.svg.querySelector !== "function") {
      return null;
    }

    var found = state.svg.querySelector('polygon[data-region-id="' + key + '"]');
    if (found) {
      state.polygonsById[key] = found;
    }

    return found;
  }

  function t(key, fallback) {
    if (global.I18n && typeof global.I18n.t === "function") {
      return global.I18n.t(key);
    }
    return fallback || key;
  }

  function updateScore(playerCount, totalCount) {
    var player = Math.max(0, Math.round(Number(playerCount) || 0));
    var total = Math.max(0, Math.round(Number(totalCount) || 0));

    if (!global.document) {
      return;
    }

    var playerEl = global.document.getElementById("player-territories");
    var totalEl = global.document.getElementById("total-territories");

    if (playerEl) {
      playerEl.textContent = String(player);
    }
    if (totalEl) {
      totalEl.textContent = String(total);
    }

    if (!playerEl || !totalEl) {
      var scoreBar = global.document.getElementById("score-bar");
      if (scoreBar) {
        scoreBar.textContent = t("your_territories", "Твои территории") + ": " + String(player)
          + " / " + t("total", "Всего") + ": " + String(total);
      }
    }
  }

  function render(mapData, svgElement) {
    var svg = resolveSvgElement(svgElement);
    if (!svg || !mapData || !Array.isArray(mapData.regions)) {
      return;
    }

    clearSvg(svg);
    resetState(svg);

    var width = isFiniteNumber(mapData.width) && mapData.width > 0 ? mapData.width : 800;
    var height = isFiniteNumber(mapData.height) && mapData.height > 0 ? mapData.height : 400;

    svg.setAttribute("viewBox", "0 0 " + String(width) + " " + String(height));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    var playerCount = 0;

    for (var i = 0; i < mapData.regions.length; i += 1) {
      var region = mapData.regions[i];
      if (!region || !Array.isArray(region.vertices)) {
        continue;
      }

      var polygon = createRegionPolygon(region);
      svg.appendChild(polygon);
      rememberPolygon(region.id, polygon);

      if (normalizeOwner(region.owner) === "player") {
        playerCount += 1;
      }
    }

    updateScore(playerCount, mapData.regions.length);
  }

  function updateRegionOwner(regionId, newOwner) {
    var polygon = getPolygon(regionId);
    if (!polygon) {
      return false;
    }

    polygon.classList.remove("region-capturing");
    setOwnerVisualState(polygon, newOwner);
    return true;
  }

  function animateCapture(regionId, newOwner) {
    return new Promise(function onAnimate(resolve) {
      var polygon = getPolygon(regionId);
      if (!polygon) {
        resolve(false);
        return;
      }

      var resolved = false;
      var timer = null;

      function finish(success) {
        if (resolved) {
          return;
        }
        resolved = true;

        if (timer !== null) {
          global.clearTimeout(timer);
          timer = null;
        }

        polygon.classList.remove("region-capturing");
        polygon.removeEventListener("transitionend", onTransitionEnd);
        resolve(success !== false);
      }

      function onTransitionEnd(event) {
        if (!event || event.target !== polygon) {
          return;
        }
        if (event.propertyName && event.propertyName !== "fill" && event.propertyName !== "filter") {
          return;
        }
        finish(true);
      }

      polygon.classList.add("region-capturing");
      if (typeof polygon.getBBox === "function") {
        try {
          polygon.getBBox();
        } catch (error) {
          // ignore forced-layout error in hidden SVG
        }
      }

      setOwnerVisualState(polygon, newOwner);
      polygon.addEventListener("transitionend", onTransitionEnd);

      timer = global.setTimeout(function onTimeout() {
        finish(true);
      }, ANIMATION_TIMEOUT_MS);
    });
  }

  function pulsePlayerRegions() {
    if (!state.svg || typeof state.svg.querySelectorAll !== "function") {
      return;
    }

    var regions = state.svg.querySelectorAll("polygon.region-player, polygon.owner-player");
    for (var i = 0; i < regions.length; i += 1) {
      if (!regions[i] || !regions[i].classList) {
        continue;
      }
      regions[i].classList.remove("region-player-pulse");
      void regions[i].offsetWidth;
      regions[i].classList.add("region-player-pulse");
    }
  }

  function clearHighlight() {
    var keys = Object.keys(state.highlightedIds);
    for (var i = 0; i < keys.length; i += 1) {
      var polygon = getPolygon(keys[i]);
      if (polygon) {
        polygon.classList.remove("region-highlight");
      }
    }
    state.highlightedIds = {};
  }

  function highlightBorder(regionIds) {
    clearHighlight();

    if (!Array.isArray(regionIds)) {
      return;
    }

    for (var i = 0; i < regionIds.length; i += 1) {
      var key = String(regionIds[i]);
      var polygon = getPolygon(key);
      if (!polygon) {
        continue;
      }

      polygon.classList.add("region-highlight");
      state.highlightedIds[key] = true;
    }
  }

  global.MapRenderer = {
    render: render,
    animateCapture: animateCapture,
    updateRegionOwner: updateRegionOwner,
    updateScore: updateScore,
    pulsePlayerRegions: pulsePlayerRegions,
    highlightBorder: highlightBorder,
    clearHighlight: clearHighlight
  };
})(typeof window !== "undefined" ? window : globalThis);
