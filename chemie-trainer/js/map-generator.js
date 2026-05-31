// js/map-generator.js - Procedural map generation (flat-top hexes + organic continent)
(function attachMapGenerator(global) {
  "use strict";

  var DEFAULT_WIDTH = 800;
  var DEFAULT_HEIGHT = 400;
  var DEFAULT_TOTAL_REGIONS = 24;
  var DEFAULT_PLAYER_START = 5;

  var MIN_TOTAL = 12;
  var MAX_TOTAL = 36;
  var MIN_PLAYER = 3;
  var MAX_PLAYER = 8;

  var MIN_HEX_RADIUS = 18;
  var MAX_HEX_RADIUS = 45;
  var MAP_PADDING = 8;

  var AXIAL_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
  ];

  function randomInt(min, max) {
    var from = Math.ceil(Math.min(min, max));
    var to = Math.floor(Math.max(min, max));
    return Math.floor(Math.random() * (to - from + 1)) + from;
  }

  function clampInt(value, min, max, fallback) {
    var num = Number(value);
    var source = Number.isFinite(num) ? Math.round(num) : fallback;
    if (source < min) {
      return min;
    }
    if (source > max) {
      return max;
    }
    return source;
  }

  function round2(value) {
    return Number(Number(value).toFixed(2));
  }

  function shuffleInPlace(values) {
    for (var i = values.length - 1; i > 0; i -= 1) {
      var swapIndex = randomInt(0, i);
      var temp = values[i];
      values[i] = values[swapIndex];
      values[swapIndex] = temp;
    }
  }

  function createKey(col, row) {
    return String(col) + ":" + String(row);
  }

  function offsetToAxial(col, row) {
    return {
      q: col,
      r: row - ((col - (col & 1)) / 2)
    };
  }

  function axialToOffset(q, r) {
    return {
      col: q,
      row: r + ((q - (q & 1)) / 2)
    };
  }

  function getContainerSize() {
    var width = DEFAULT_WIDTH;
    var height = DEFAULT_HEIGHT;

    try {
      var container = global.document && global.document.getElementById
        ? global.document.getElementById("map-container")
        : null;

      if (container) {
        if (Number.isFinite(container.clientWidth) && container.clientWidth > 0) {
          width = Math.round(container.clientWidth);
        }
        if (Number.isFinite(container.clientHeight) && container.clientHeight > 0) {
          height = Math.round(container.clientHeight);
        }
      }

      var svg = global.document && global.document.getElementById
        ? global.document.getElementById("game-map")
        : null;

      if (svg) {
        if ((!Number.isFinite(width) || width <= 0) && Number.isFinite(svg.clientWidth) && svg.clientWidth > 0) {
          width = Math.round(svg.clientWidth);
        }
        if ((!Number.isFinite(height) || height <= 0) && Number.isFinite(svg.clientHeight) && svg.clientHeight > 0) {
          height = Math.round(svg.clientHeight);
        }
      }
    } catch (error) {
      // fallback to defaults
    }

    if (!Number.isFinite(width) || width <= 0) {
      width = DEFAULT_WIDTH;
    }
    if (!Number.isFinite(height) || height <= 0) {
      height = DEFAULT_HEIGHT;
    }

    return {
      width: width,
      height: height
    };
  }

  function resolveGenerationParams(totalRegions, playerStartRegions) {
    var total = clampInt(
      totalRegions,
      MIN_TOTAL,
      MAX_TOTAL,
      DEFAULT_TOTAL_REGIONS
    );

    var playerMax = Math.min(MAX_PLAYER, Math.max(MIN_PLAYER, total - 3));
    var player = clampInt(
      playerStartRegions,
      MIN_PLAYER,
      playerMax,
      Math.min(DEFAULT_PLAYER_START, playerMax)
    );

    if (player > total) {
      player = total;
    }

    return {
      totalRegions: total,
      playerStartRegions: player
    };
  }

  function estimateGrid(totalRegions, width, height) {
    var aspect = width / Math.max(1, height);
    var normalizedAspect = Math.max(1.5, Math.min(2.8, aspect));

    var desiredCellPool = Math.ceil(totalRegions * 2.8);
    var rows = Math.max(4, Math.ceil(Math.sqrt(desiredCellPool / normalizedAspect)));
    var cols = Math.max(6, Math.ceil(rows * normalizedAspect));

    while (cols * rows < Math.ceil(totalRegions * 2.2)) {
      if (cols / rows < normalizedAspect) {
        cols += 1;
      } else {
        rows += 1;
      }
    }

    var availableWidth = Math.max(120, width - MAP_PADDING * 2);
    var availableHeight = Math.max(120, height - MAP_PADDING * 2);

    function computeRadius(currentCols, currentRows) {
      var byWidth = availableWidth / (2 + (currentCols - 1) * 1.5);
      var byHeight = availableHeight / (Math.sqrt(3) * (currentRows + 0.5));
      return Math.min(byWidth, byHeight);
    }

    var radius = computeRadius(cols, rows);

    while (radius < 30 && cols * rows > totalRegions * 2.1) {
      if (cols > rows * 1.7 && cols > 6) {
        cols -= 1;
      } else if (rows > 4) {
        rows -= 1;
      } else {
        break;
      }
      radius = computeRadius(cols, rows);
    }

    radius = Math.floor(Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, radius)));

    var hexHeight = Math.sqrt(3) * radius;
    var gridWidth = radius * 2 + (cols - 1) * 1.5 * radius;
    var gridHeight = hexHeight * (rows + 0.5);

    var left = Math.max(2, (width - gridWidth) / 2);
    var top = Math.max(2, (height - gridHeight) / 2);

    return {
      cols: cols,
      rows: rows,
      radius: radius,
      hexHeight: hexHeight,
      gridWidth: gridWidth,
      gridHeight: gridHeight,
      left: left,
      top: top,
      centerX: width / 2,
      centerY: height / 2
    };
  }

  function createHexVertices(cx, cy, radius, hexHeight) {
    var halfHeight = hexHeight / 2;

    return [
      { x: round2(cx + radius), y: round2(cy) },
      { x: round2(cx + radius / 2), y: round2(cy + halfHeight) },
      { x: round2(cx - radius / 2), y: round2(cy + halfHeight) },
      { x: round2(cx - radius), y: round2(cy) },
      { x: round2(cx - radius / 2), y: round2(cy - halfHeight) },
      { x: round2(cx + radius / 2), y: round2(cy - halfHeight) }
    ];
  }

  function buildHexGrid(spec) {
    var cellsByKey = {};
    var cells = [];

    for (var col = 0; col < spec.cols; col += 1) {
      for (var row = 0; row < spec.rows; row += 1) {
        var cx = spec.left + spec.radius + col * (1.5 * spec.radius);
        var cy = spec.top + (spec.hexHeight / 2) + row * spec.hexHeight + ((col & 1) ? (spec.hexHeight / 2) : 0);

        var cell = {
          key: createKey(col, row),
          col: col,
          row: row,
          cx: round2(cx),
          cy: round2(cy),
          vertices: createHexVertices(cx, cy, spec.radius, spec.hexHeight),
          neighborKeys: []
        };

        cellsByKey[cell.key] = cell;
        cells.push(cell);
      }
    }

    for (var i = 0; i < cells.length; i += 1) {
      var current = cells[i];
      var axial = offsetToAxial(current.col, current.row);

      for (var d = 0; d < AXIAL_DIRECTIONS.length; d += 1) {
        var direction = AXIAL_DIRECTIONS[d];
        var neighborOffset = axialToOffset(axial.q + direction.q, axial.r + direction.r);
        var neighborKey = createKey(neighborOffset.col, neighborOffset.row);

        if (Object.prototype.hasOwnProperty.call(cellsByKey, neighborKey)) {
          current.neighborKeys.push(neighborKey);
        }
      }
    }

    return {
      cells: cells,
      cellsByKey: cellsByKey,
      centerKey: createKey(Math.floor(spec.cols / 2), Math.floor(spec.rows / 2))
    };
  }

  function createBlobProfile(sectors) {
    var values = [];
    var count = Math.max(8, sectors);

    for (var i = 0; i < count; i += 1) {
      values.push(0.62 + Math.random() * 0.43);
    }

    for (var pass = 0; pass < 2; pass += 1) {
      var smoothed = [];
      for (var j = 0; j < count; j += 1) {
        var prev = values[(j - 1 + count) % count];
        var next = values[(j + 1) % count];
        smoothed.push((prev + values[j] * 2 + next) / 4);
      }
      values = smoothed;
    }

    return values;
  }

  function blobRadiusForAngle(angle, profile, baseRadius) {
    var normalized = angle;
    if (normalized < 0) {
      normalized += Math.PI * 2;
    }

    var sectorAngle = (Math.PI * 2) / profile.length;
    var indexFloat = normalized / sectorAngle;
    var leftIndex = Math.floor(indexFloat) % profile.length;
    var rightIndex = (leftIndex + 1) % profile.length;
    var ratio = indexFloat - Math.floor(indexFloat);

    var scale = profile[leftIndex] * (1 - ratio) + profile[rightIndex] * ratio;
    return baseRadius * scale;
  }

  function cellBlobScore(cell, centerX, centerY, profile, baseRadius) {
    var dx = cell.cx - centerX;
    var dy = cell.cy - centerY;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var angle = Math.atan2(dy, dx);
    var allowedRadius = blobRadiusForAngle(angle, profile, baseRadius);

    if (allowedRadius <= 0) {
      return Infinity;
    }

    return distance / allowedRadius;
  }

  function nearestCellKey(cells, x, y) {
    if (!Array.isArray(cells) || cells.length === 0) {
      return null;
    }

    var bestKey = cells[0].key;
    var bestDistance = Infinity;

    for (var i = 0; i < cells.length; i += 1) {
      var dx = cells[i].cx - x;
      var dy = cells[i].cy - y;
      var distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = cells[i].key;
      }
    }

    return bestKey;
  }

  function extractConnectedComponent(selectedKeys, seedKey, cellsByKey) {
    if (!seedKey || !selectedKeys.has(seedKey)) {
      return new Set();
    }

    var queue = [seedKey];
    var visited = new Set([seedKey]);

    while (queue.length > 0) {
      var key = queue.shift();
      var cell = cellsByKey[key];
      if (!cell) {
        continue;
      }

      for (var i = 0; i < cell.neighborKeys.length; i += 1) {
        var neighborKey = cell.neighborKeys[i];
        if (!selectedKeys.has(neighborKey) || visited.has(neighborKey)) {
          continue;
        }
        visited.add(neighborKey);
        queue.push(neighborKey);
      }
    }

    return visited;
  }

  function collectConnectedSubset(allowedKeys, seedKey, targetSize, cellsByKey) {
    if (!allowedKeys.has(seedKey)) {
      return new Set();
    }

    var result = new Set([seedKey]);
    var queue = [seedKey];

    while (queue.length > 0 && result.size < targetSize) {
      var key = queue.shift();
      var neighbors = cellsByKey[key] ? cellsByKey[key].neighborKeys.slice() : [];
      shuffleInPlace(neighbors);

      for (var i = 0; i < neighbors.length && result.size < targetSize; i += 1) {
        var neighborKey = neighbors[i];
        if (!allowedKeys.has(neighborKey) || result.has(neighborKey)) {
          continue;
        }

        result.add(neighborKey);
        queue.push(neighborKey);
      }
    }

    return result;
  }

  function expandConnectedSet(currentKeys, targetSize, cellsByKey, centerX, centerY, profile, baseRadius) {
    var result = new Set(currentKeys);

    function buildFrontier() {
      var frontier = {};
      result.forEach(function eachOwned(key) {
        var cell = cellsByKey[key];
        if (!cell) {
          return;
        }

        for (var i = 0; i < cell.neighborKeys.length; i += 1) {
          var neighborKey = cell.neighborKeys[i];
          if (!result.has(neighborKey)) {
            frontier[neighborKey] = true;
          }
        }
      });

      return Object.keys(frontier);
    }

    while (result.size < targetSize) {
      var frontierKeys = buildFrontier();
      if (frontierKeys.length === 0) {
        break;
      }

      frontierKeys.sort(function byBlobScore(a, b) {
        var scoreA = cellBlobScore(cellsByKey[a], centerX, centerY, profile, baseRadius) + Math.random() * 0.06;
        var scoreB = cellBlobScore(cellsByKey[b], centerX, centerY, profile, baseRadius) + Math.random() * 0.06;
        return scoreA - scoreB;
      });

      var pickLimit = Math.min(3, frontierKeys.length - 1);
      var pickIndex = randomInt(0, Math.max(0, pickLimit));
      result.add(frontierKeys[pickIndex]);
    }

    return result;
  }

  function buildContinent(gridData, spec, targetSize) {
    var cells = gridData.cells;
    var cellsByKey = gridData.cellsByKey;

    var seedKey = gridData.centerKey;
    if (!Object.prototype.hasOwnProperty.call(cellsByKey, seedKey)) {
      seedKey = nearestCellKey(cells, spec.centerX, spec.centerY);
    }

    var best = null;
    var maxAttempts = 24;

    for (var attempt = 0; attempt < maxAttempts; attempt += 1) {
      var profile = createBlobProfile(12);
      var baseRadius = Math.min(spec.gridWidth, spec.gridHeight) * (0.34 + Math.random() * 0.16 + attempt * 0.008);

      var selected = new Set();
      for (var i = 0; i < cells.length; i += 1) {
        var score = cellBlobScore(cells[i], spec.centerX, spec.centerY, profile, baseRadius);
        if (score <= 1) {
          selected.add(cells[i].key);
        }
      }

      selected.add(seedKey);
      var connected = extractConnectedComponent(selected, seedKey, cellsByKey);

      if (!best || Math.abs(connected.size - targetSize) < Math.abs(best.keys.size - targetSize)) {
        best = {
          keys: connected,
          profile: profile,
          baseRadius: baseRadius
        };
      }

      if (connected.size >= targetSize) {
        break;
      }
    }

    if (!best || best.keys.size === 0) {
      var fallback = new Set([seedKey]);
      return expandConnectedSet(fallback, targetSize, cellsByKey, spec.centerX, spec.centerY, createBlobProfile(12), spec.radius * 4.2);
    }

    var keys = best.keys;
    if (keys.size > targetSize) {
      keys = collectConnectedSubset(keys, seedKey, targetSize, cellsByKey);
    }

    if (keys.size < targetSize) {
      keys = expandConnectedSet(keys, targetSize, cellsByKey, spec.centerX, spec.centerY, best.profile, best.baseRadius);
    }

    return keys;
  }

  function buildRegionsFromKeys(continentKeys, gridData) {
    var keys = Array.from(continentKeys);
    keys.sort(function byPosition(a, b) {
      var cellA = gridData.cellsByKey[a];
      var cellB = gridData.cellsByKey[b];

      if (!cellA || !cellB) {
        return String(a).localeCompare(String(b));
      }

      if (cellA.cy !== cellB.cy) {
        return cellA.cy - cellB.cy;
      }
      return cellA.cx - cellB.cx;
    });

    var idByKey = {};
    for (var i = 0; i < keys.length; i += 1) {
      idByKey[keys[i]] = i;
    }

    var regions = [];

    for (var j = 0; j < keys.length; j += 1) {
      var key = keys[j];
      var cell = gridData.cellsByKey[key];
      if (!cell) {
        continue;
      }

      var neighbors = [];
      for (var n = 0; n < cell.neighborKeys.length; n += 1) {
        var neighborKey = cell.neighborKeys[n];
        if (Object.prototype.hasOwnProperty.call(idByKey, neighborKey)) {
          neighbors.push(idByKey[neighborKey]);
        }
      }
      neighbors.sort(function numericSort(a, b) {
        return a - b;
      });

      regions.push({
        id: j,
        col: cell.col,
        row: cell.row,
        cx: cell.cx,
        cy: cell.cy,
        vertices: cell.vertices,
        neighbors: neighbors,
        owner: "computer"
      });
    }

    return regions;
  }

  function indexRegionsById(regions) {
    var index = {};
    for (var i = 0; i < regions.length; i += 1) {
      index[regions[i].id] = regions[i];
    }
    return index;
  }

  function bfsCollectRegionIds(regions, startId, targetCount) {
    var byId = indexRegionsById(regions);
    if (!Object.prototype.hasOwnProperty.call(byId, startId)) {
      return [];
    }

    var queue = [startId];
    var visited = new Set([startId]);
    var result = [];

    while (queue.length > 0 && result.length < targetCount) {
      var id = queue.shift();
      var region = byId[id];
      if (!region) {
        continue;
      }

      result.push(id);
      var neighbors = region.neighbors.slice();
      shuffleInPlace(neighbors);

      for (var i = 0; i < neighbors.length; i += 1) {
        var neighborId = neighbors[i];
        if (!visited.has(neighborId) && Object.prototype.hasOwnProperty.call(byId, neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    return result;
  }

  function assignOwners(regions, playerStartRegions) {
    if (!Array.isArray(regions) || regions.length === 0) {
      return;
    }

    var desiredPlayer = Math.max(1, Math.min(playerStartRegions, regions.length));

    for (var i = 0; i < regions.length; i += 1) {
      regions[i].owner = "computer";
    }

    var edgeRegions = regions.filter(function isEdge(region) {
      return Array.isArray(region.neighbors) && region.neighbors.length < 6;
    });

    if (edgeRegions.length === 0) {
      edgeRegions = regions.slice();
    }

    var startRegion = edgeRegions[randomInt(0, edgeRegions.length - 1)];
    var playerIds = bfsCollectRegionIds(regions, startRegion.id, desiredPlayer);

    if (playerIds.length < desiredPlayer) {
      for (var j = 0; j < regions.length && playerIds.length < desiredPlayer; j += 1) {
        if (playerIds.indexOf(regions[j].id) === -1) {
          playerIds.push(regions[j].id);
        }
      }
    }

    var playerSet = new Set(playerIds);
    for (var k = 0; k < regions.length; k += 1) {
      if (playerSet.has(regions[k].id)) {
        regions[k].owner = "player";
      }
    }
  }

  function getPlayerRegions(regions) {
    if (!Array.isArray(regions)) {
      return [];
    }
    return regions.filter(function onlyPlayer(region) {
      return region && region.owner === "player";
    });
  }

  function getComputerRegions(regions) {
    if (!Array.isArray(regions)) {
      return [];
    }
    return regions.filter(function onlyComputer(region) {
      return region && region.owner === "computer";
    });
  }

  function getBorderRegions(regions, owner) {
    if (!Array.isArray(regions)) {
      return [];
    }

    var requestedOwner = owner === "player" ? "player" : "computer";
    var byId = indexRegionsById(regions);

    return regions.filter(function isBorder(region) {
      if (!region || region.owner !== requestedOwner || !Array.isArray(region.neighbors)) {
        return false;
      }

      for (var i = 0; i < region.neighbors.length; i += 1) {
        var neighbor = byId[region.neighbors[i]];
        if (neighbor && neighbor.owner !== requestedOwner) {
          return true;
        }
      }

      return false;
    });
  }

  function captureRegion(regions, regionId, newOwner) {
    if (!Array.isArray(regions) || (newOwner !== "player" && newOwner !== "computer")) {
      return false;
    }

    for (var i = 0; i < regions.length; i += 1) {
      if (regions[i] && regions[i].id === regionId) {
        regions[i].owner = newOwner;
        return true;
      }
    }

    return false;
  }

  function isConnected(regions, owner) {
    if (!Array.isArray(regions)) {
      return false;
    }

    var requestedOwner = owner === "player" ? "player" : "computer";
    var owned = regions.filter(function byOwner(region) {
      return region && region.owner === requestedOwner;
    });

    if (owned.length <= 1) {
      return true;
    }

    var byId = indexRegionsById(regions);
    var queue = [owned[0].id];
    var visited = new Set([owned[0].id]);

    while (queue.length > 0) {
      var id = queue.shift();
      var region = byId[id];
      if (!region || !Array.isArray(region.neighbors)) {
        continue;
      }

      for (var i = 0; i < region.neighbors.length; i += 1) {
        var neighborId = region.neighbors[i];
        var neighbor = byId[neighborId];
        if (!neighbor || neighbor.owner !== requestedOwner || visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);
        queue.push(neighborId);
      }
    }

    return visited.size === owned.length;
  }

  function generate(totalRegions, playerStartRegions) {
    var params = resolveGenerationParams(totalRegions, playerStartRegions);
    var size = getContainerSize();
    var spec = estimateGrid(params.totalRegions, size.width, size.height);
    var grid = buildHexGrid(spec);

    var maxAvailable = grid.cells.length;
    var target = Math.min(params.totalRegions, maxAvailable);

    var continentKeys = buildContinent(grid, spec, target);
    if (continentKeys.size > target) {
      continentKeys = collectConnectedSubset(continentKeys, grid.centerKey, target, grid.cellsByKey);
    }
    if (continentKeys.size < target) {
      continentKeys = expandConnectedSet(
        continentKeys,
        target,
        grid.cellsByKey,
        spec.centerX,
        spec.centerY,
        createBlobProfile(12),
        Math.min(spec.gridWidth, spec.gridHeight) * 0.42
      );
    }

    var regions = buildRegionsFromKeys(continentKeys, grid);
    assignOwners(regions, params.playerStartRegions);

    if (!isConnected(regions, "player")) {
      // Safety fallback: enforce connected player cluster from one border region.
      assignOwners(regions, params.playerStartRegions);
    }

    return {
      regions: regions,
      width: size.width,
      height: size.height,
      hexRadius: spec.radius
    };
  }

  global.MapGenerator = {
    generate: generate,
    resolveGenerationParams: resolveGenerationParams,
    getPlayerRegions: getPlayerRegions,
    getComputerRegions: getComputerRegions,
    getBorderRegions: getBorderRegions,
    captureRegion: captureRegion,
    isConnected: isConnected
  };
})(typeof window !== "undefined" ? window : globalThis);
