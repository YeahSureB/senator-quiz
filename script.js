// ---------------------------------------------------------------------------
// US Politics Geography Quiz — Game Script
// Closely mirrors Michigan Geography Quiz (script.js)
//
// Key differences from the original (all justified):
//  1. Two JSON data files (senators.json, governors.json) instead of one
//  2. State boundary GeoJSON (us_states.geojson) replaces Counties.geojson
//  3. Both modes are polygon modes — mechanics mirror the original's
//     'counties' and 'congress-districts' modes exactly
//  4. Distance thresholds in displayResult() scaled up: US states span
//     hundreds of miles, so the original's 15/30/50 mile bands would
//     always read as "close"
//  5. No toggleStates() — state outlines are always visible because they
//     ARE the game board, not an optional reference layer
//  6. No pool size dropdown — no equivalent concept for politicians
// ---------------------------------------------------------------------------

let map;
let currentTarget;
let senatorData = [];
let governorData = [];
let currentMode = '';
let streak = 0;
let highScore = 0;
let lastGuessSuccessful = false;
let userMarker = null;
let actualMarker = null;
let connectionLine = null;
let highlightedPolygon = null;
let hasGuessed = false;
let statesLayer = null;
let statesData = null;

// --- Bayesian Knowledge Tracing (BKT) ---
// g = guess rate: probability of clicking the right state by chance.
//     Lower than a multiple-choice default (0.25) because this is a map
//     click across ~50 states, not a 4-option pick.
// s = slip rate: probability of misclicking despite actually knowing it.
const BKT_G = 0.05;
const BKT_S = 0.10;
const BKT_L_INIT = 0.50;
const BKT_MASTERY_THRESHOLD = 0.95;
const COOLDOWN_ROUNDS = 8;           // an item can't reappear within this many rounds
const MASTERED_REVIEW_CHANCE = 0.10; // 10% of rounds resurface a mastered item, for retention
let knowledgeState = {}; // key: "Name|State" -> L (probability of true knowledge)
let recentlyShown = []; // queue of the last COOLDOWN_ROUNDS target keys served

function getTargetKey(target) {
    return `${target.name}|${target.state}`;
}

// Persist/restore knowledgeState per mode, mirroring how highScore is saved.
function getKnowledgeStorageKey(mode) {
    return `politicsKnowledge_${mode}`;
}

function saveKnowledgeState() {
    if (!currentMode) return;
    localStorage.setItem(getKnowledgeStorageKey(currentMode), JSON.stringify(knowledgeState));
}

function loadKnowledgeState(mode, targets) {
    const saved = localStorage.getItem(getKnowledgeStorageKey(mode));
    let restored = {};
    if (saved) {
        try {
            restored = JSON.parse(saved);
        } catch (e) {
            console.warn('Could not parse saved knowledge state, starting fresh.', e);
        }
    }
    // Ensure every current target has an entry (covers new targets added
    // to senators.json/governors.json after a save was made).
    targets.forEach(t => {
        const key = getTargetKey(t);
        if (!(key in restored)) restored[key] = BKT_L_INIT;
    });
    return restored;
}

// P(C) = L(1 - s) + (1 - L)g — exposed for potential future use (e.g. UI display)
function probabilityCorrect(L) {
    return (L * (1 - BKT_S)) + ((1 - L) * BKT_G);
}

// Bayesian update of L given an observed answer
function updateKnowledge(target, wasCorrect) {
    const key = getTargetKey(target);
    const L = knowledgeState[key] ?? BKT_L_INIT;
    let L_new;
    if (wasCorrect) {
        L_new = (L * (1 - BKT_S)) / ((L * (1 - BKT_S)) + ((1 - L) * BKT_G));
    } else {
        L_new = (L * BKT_S) / ((L * BKT_S) + ((1 - L) * (1 - BKT_G)));
    }
    knowledgeState[key] = L_new;
    return L_new;
}

// Returns the live data array for a mode's dataSource name ('senatorData' / 'governorData').
// Replaces the old `window[name] || eval(name)` pattern — top-level `let` vars never attach
// to `window`, so that pattern was silently eval()'ing on every call.
function getDataSource(dataSourceName) {
    if (dataSourceName === 'senatorData') return senatorData;
    if (dataSourceName === 'governorData') return governorData;
    console.error(`Unknown data source: ${dataSourceName}`);
    return [];
}

// Mode configuration — mirrors original MODE_CONFIG structure exactly
const MODE_CONFIG = {
    'senators': {
        dataSource: 'senatorData',
        label: 'US Senators',
        resultLabel: 'Senator:',
        nextBtnText: 'Next Senator',
        wikiSuffix: '',
        hasPoolSize: false,
        isPolygon: true
    },
    'governors': {
        dataSource: 'governorData',
        label: 'Governors',
        resultLabel: 'Governor:',
        nextBtnText: 'Next Governor',
        wikiSuffix: '',
        hasPoolSize: false,
        isPolygon: true
    }
};

// DOM elements
const resultLabel = document.getElementById('result-label');
const resultName = document.getElementById('result-name');
const resultState = document.getElementById('result-state');
const resultParty = document.getElementById('result-party');
const resultSince = document.getElementById('result-since');
const resultFact = document.getElementById('result-fact');
const resultWikiLink = document.getElementById('result-wiki-link');
const nextBtn = document.getElementById('btn-next');
const modeSelection = document.getElementById('mode-selection');
const targetPersonName = document.getElementById('target-person-name');
const resultPanel = document.getElementById('result-panel');
const resultMessage = document.getElementById('result-message');
const resultDistance = document.getElementById('result-distance');
const changeModeBtn = document.getElementById('change-mode-btn');
const streakNumberEl = document.getElementById('streak-number');
const highScoreEl = document.getElementById('high-score');
const gameModeEl = document.getElementById('game-mode');
const masteryPercentEl = document.getElementById('mastery-percent');
const masteryProgressFill = document.getElementById('mastery-progress-fill');
const resultConfidence = document.getElementById('result-confidence');
const MAP_CENTER = [39.5, -98.35];
const MAP_ZOOM = 4;

// Initialize the game
async function init() {
    // Load all data before initializing the map
    await loadSenatorData();
    await loadGovernorData();
    await loadStatesData();

    // Initialize map so it shows under the mode selection overlay
    initMap();

    // Draw state outlines — always visible, they are the game board
    drawStatesLayer();

    // Load saved preferences from localStorage
    loadPreferences();

    // Set up event listeners
    document.getElementById('senators-btn').addEventListener('click', () => startGame('senators'));
    document.getElementById('governors-btn').addEventListener('click', () => startGame('governors'));
    nextBtn.addEventListener('click', nextRound);
    changeModeBtn.addEventListener('click', changeMode);
}

// Load saved preferences from localStorage
function loadPreferences() {
    const savedHighScore = localStorage.getItem('politicsHighScore');
    if (savedHighScore) {
        highScore = parseInt(savedHighScore);
        highScoreEl.textContent = highScore;
    }

    const lastMode = localStorage.getItem('politicsLastMode');
    if (lastMode) {
        console.log(`Last played mode: ${lastMode}`);
    }
}

// Load senator JSON data
async function loadSenatorData() {
    try {
        const response = await fetch('senators.json');
        const rawData = await response.json();
        // Geometry and lat/lng will be joined in after loadStatesData()
        senatorData = rawData;
        console.log(`Loaded ${senatorData.length} senators from senators.json`);
    } catch (error) {
        console.error('Error loading senator data:', error);
        alert('Error loading senator data. Please ensure senators.json is in the same directory.');
    }
}

// Load governor JSON data
async function loadGovernorData() {
    try {
        const response = await fetch('governors.json');
        const rawData = await response.json();
        governorData = rawData;
        console.log(`Loaded ${governorData.length} governors from governors.json`);
    } catch (error) {
        console.error('Error loading governor data:', error);
        alert('Error loading governor data. Please ensure governors.json is in the same directory.');
    }
}

// Load US state boundary GeoJSON — equivalent to loadCountyData() in the original.
// Download us_states.geojson from:
//   https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json
// Save it as us_states.geojson in the same directory as index.html.
// The 'name' property on each feature must match the state names in senators.json/governors.json.
async function loadStatesData() {
    try {
        const response = await fetch('us_states.geojson');
        const geoJsonData = await response.json();
        statesData = geoJsonData;
        console.log(`Loaded ${statesData.features.length} state features from us_states.geojson`);

        // Build a lookup map from state name to feature for fast joining
        const stateFeatureMap = {};
        statesData.features.forEach(feature => {
            stateFeatureMap[feature.properties.name] = feature;
        });

        // Join geometry and centroid lat/lng onto each politician record.
        // This mirrors how loadGeoJSONData() in the original attaches geometry
        // to county/district records — we just do it as a separate join step
        // because our politician data lives in separate JSON files.
        joinGeometryToData(senatorData, stateFeatureMap);
        joinGeometryToData(governorData, stateFeatureMap);

    } catch (error) {
        console.error('Error loading state boundary data:', error);
        alert('Error loading us_states.geojson. See the comment in script.js for where to download it.');
    }
}

// Attach geometry and centroid coordinates from a GeoJSON feature lookup
// to each record in a politician array, keyed by record.state.
function joinGeometryToData(politicians, stateFeatureMap) {
    const missing = [];
    for (let i = politicians.length - 1; i >= 0; i--) {
        const politician = politicians[i];
        const feature = stateFeatureMap[politician.state];
        if (feature) {
            // Compute centroid using Leaflet bounds — same approach as the original's loadGeoJSONData()
            const layer = L.geoJSON(feature);
            const bounds = layer.getBounds();
            const center = bounds.getCenter();
            politician.lat = center.lat;
            politician.lng = center.lng;
            politician.geometry = feature.geometry;
        } else {
            // No matching state feature (name mismatch between the politician JSON and
            // us_states.geojson) — drop the entry rather than leaving lat/lng/geometry
            // undefined, which would crash handleMapClick()/displayResult() if this
            // politician were ever selected as a target.
            missing.push(`${politician.name} (${politician.state})`);
            politicians.splice(i, 1);
        }
    }
    if (missing.length > 0) {
        console.warn(
            `Dropped ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} with no matching state feature — check state name spelling against us_states.geojson:`,
            missing
        );
    }
}

// Initialize Leaflet map
function initMap() {
    map = L.map('map', {
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        minZoom: 3,
        maxZoom: 10
    });

    // Esri World Imagery tiles — same as original
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 18
    }).addTo(map);

    map.on('click', handleMapClick);
}

// Draw the state outline layer — equivalent to showDistrictPolygons() in the original,
// but called once at startup and never hidden (state outlines are always needed).
function drawStatesLayer() {
    if (!statesData || statesLayer) return;
    statesLayer = L.geoJSON(statesData, {
        style: {
            color: '#ffffff',
            weight: 1.5,
            opacity: 0.6,
            fillOpacity: 0
        },
        interactive: false  // Clicks pass through to the map handler
    }).addTo(map);
    console.log('State outlines drawn');
}

// Start game with selected mode — mirrors original startGame() exactly
function startGame(mode) {
    currentMode = mode;
    streak = 0;
    updateStreakDisplay();

    const config = MODE_CONFIG[mode];
    if (!config) {
        console.error(`Unknown mode: ${mode}`);
        return;
    }

    localStorage.setItem('politicsLastMode', mode);

    // Get data source
    const dataSourceName = config.dataSource;
    const sourceData = getDataSource(dataSourceName);
    gameModeEl.textContent = config.label;

    // Restore saved BKT state for this mode if present, otherwise start fresh
    knowledgeState = loadKnowledgeState(mode, sourceData);
    recentlyShown = [];
    updateMasteryUI();

    console.log(`Starting ${mode} mode with ${sourceData.length} targets`);

    modeSelection.classList.add('hidden');
    startRound();
}

// Start a new round — adaptive selection replaces original's plain shift()
function startRound() {
    hasGuessed = false;
    clearMarkers();
    resultPanel.classList.add('hidden');
    resultConfidence.textContent = '';

    // Weighted-random pick from the full pool, cooldown-aware
    currentTarget = selectNextTarget();

    // Show name + party abbreviation in the HUD
    const partyLabel = `(${currentTarget.party})`;
    targetPersonName.textContent = `${currentTarget.name} ${partyLabel}`;

    console.log(`Streak ${streak}: Find ${currentTarget.name} → ${currentTarget.state}`);
}

// Weighted-random adaptive selection: more uncertain items are MORE LIKELY
// to appear, not guaranteed to appear — this avoids fixating on the same
// low-confidence item round after round. A short cooldown keeps any item
// from repeating too soon, and mastered items occasionally resurface so
// they aren't forgotten (spaced-repetition style retention pass).
function selectNextTarget() {
    const config = MODE_CONFIG[currentMode];
    const dataSourceName = config.dataSource;
    const allTargets = getDataSource(dataSourceName);

    const isOnCooldown = t => recentlyShown.includes(getTargetKey(t));

    const unmastered = allTargets.filter(
        t => (knowledgeState[getTargetKey(t)] ?? BKT_L_INIT) < BKT_MASTERY_THRESHOLD
    );
    const mastered = allTargets.filter(
        t => (knowledgeState[getTargetKey(t)] ?? BKT_L_INIT) >= BKT_MASTERY_THRESHOLD
    );

    // Occasionally serve a mastered item for long-term retention, cooldown allowing
    if (mastered.length > 0 && Math.random() < MASTERED_REVIEW_CHANCE) {
        const eligible = mastered.filter(t => !isOnCooldown(t));
        if (eligible.length > 0) {
            return pickAndRemember(eligible[Math.floor(Math.random() * eligible.length)]);
        }
    }

    // Prefer unmastered items not on cooldown; fall back to any unmastered,
    // then to the full pool, so the game never stalls.
    let pool = unmastered.filter(t => !isOnCooldown(t));
    if (pool.length === 0) pool = unmastered;
    if (pool.length === 0) pool = allTargets;

    // Weight by uncertainty: L near 0.5 gets weight near 1, L near 0 or 1
    // gets weight near a small floor (never zero, so nothing is fully excluded).
    const weights = pool.map(t => {
        const L = knowledgeState[getTargetKey(t)] ?? BKT_L_INIT;
        return Math.max(0.05, 1 - Math.abs(L - 0.5) * 2);
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
            chosen = pool[i];
            break;
        }
    }

    return pickAndRemember(chosen);
}

function pickAndRemember(target) {
    recentlyShown.push(getTargetKey(target));
    if (recentlyShown.length > COOLDOWN_ROUNDS) recentlyShown.shift();
    return target;
}

// Update the mastery stat + progress bar — % of this mode's full target
// pool that has crossed the BKT_MASTERY_THRESHOLD.
function updateMasteryUI() {
    if (!currentMode) return;
    const config = MODE_CONFIG[currentMode];
    const dataSourceName = config.dataSource;
    const sourceData = getDataSource(dataSourceName);
    const total = sourceData.length;
    const masteredCount = sourceData.filter(
        t => (knowledgeState[getTargetKey(t)] ?? BKT_L_INIT) >= BKT_MASTERY_THRESHOLD
    ).length;
    const pct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;
    masteryPercentEl.textContent = `${pct}%`;
    masteryProgressFill.style.width = `${pct}%`;
}

// Update streak display — identical to original
function updateStreakDisplay() {
    streakNumberEl.textContent = streak;

    if (streak > highScore) {
        highScore = streak;
        highScoreEl.textContent = highScore;
        localStorage.setItem('politicsHighScore', highScore);
        console.log(`New high score: ${highScore}!`);
    }
}

// Handle map click — mirrors original handleMapClick() for polygon modes
function handleMapClick(e) {
    if (hasGuessed) return;

    hasGuessed = true;
    const userLatLng = e.latlng;
    const actualLatLng = L.latLng(currentTarget.lat, currentTarget.lng);

    // Place marker where user clicked (red)
    userMarker = L.circleMarker(userLatLng, {
        color: '#c0392b',
        fillColor: '#e74c3c',
        fillOpacity: 0.7,
        radius: 8,
        weight: 2
    }).addTo(map);

    // Place marker at correct state centroid (green)
    actualMarker = L.circleMarker(actualLatLng, {
        color: '#1e8449',
        fillColor: '#27ae60',
        fillOpacity: 0.7,
        radius: 8,
        weight: 2
    }).addTo(map);

    // Highlight the correct state polygon — same as original's polygon highlight
    if (currentTarget.geometry) {
        highlightedPolygon = L.geoJSON(currentTarget.geometry, {
            style: {
                color: '#27ae60',
                weight: 3,
                opacity: 0.8,
                fillColor: '#27ae60',
                fillOpacity: 0.2
            }
        }).addTo(map);
    }

    // Draw dashed line between click and correct centroid — identical to original
    connectionLine = L.polyline([userLatLng, actualLatLng], {
        color: '#3498db',
        weight: 2,
        dashArray: '10, 10',
        opacity: 0.7
    }).addTo(map);

    // Calculate distance in miles — identical to original
    const distanceMeters = userLatLng.distanceTo(actualLatLng);
    const distanceMiles = (distanceMeters * 0.000621371).toFixed(2);

    displayResult(distanceMiles, userLatLng);
}

function displayResult(distance, userLatLng) {
    let message = '';
    const config = MODE_CONFIG[currentMode];

    // Check if the click landed inside the correct state polygon
    const clickPoint = [userLatLng.lng, userLatLng.lat];
    lastGuessSuccessful = isPointInPolygon(clickPoint, currentTarget.geometry);

    // Update this target's knowledge estimate (L) now that we know the outcome,
    // so the result panel and mastery bar reflect the post-answer state.
    const updatedL = updateKnowledge(currentTarget, lastGuessSuccessful);
    saveKnowledgeState();
    resultConfidence.textContent = `${Math.round(updatedL * 100)}%`;
    updateMasteryUI();

    // 1. Determine the message based on success and distance.
    //    Thresholds are scaled up vs. the original because US states span
    //    hundreds of miles (Michigan counties span ~30 miles).
    if (lastGuessSuccessful) {
        message = '🎯 Perfect! You clicked inside!';
    } else {
        if (distance < 100) {
            message = '👍 Great job! Pretty close!';
        } else if (distance < 300) {
            message = '✓ Not bad! Getting warmer!';
        } else if (distance < 600) {
            message = '🔍 Keep practicing!';
        } else {
            message = '🗺️ Try again next time!';
        }
    }

    // 2. Update the simple text fields — mirrors original displayResult() exactly
    resultMessage.textContent = message;
    if (lastGuessSuccessful) {
        resultDistance.textContent = `You clicked inside the correct state!`;
    } else {
        resultDistance.textContent = `You were ${distance} miles from the center.`;
    }

    resultName.textContent = currentTarget.name;
    resultState.textContent = currentTarget.state;

    const partyFull = currentTarget.party === 'D' ? 'Democrat' :
                      currentTarget.party === 'R' ? 'Republican' : 'Independent';
    resultParty.textContent = partyFull;
    resultSince.textContent = currentTarget.since;

    resultFact.textContent = currentTarget.funFact ? currentTarget.funFact : '';

    // Handle images — mirrors original exactly.
    // Expects images at images/<Name_With_Underscores>.webp (e.g. images/Bernie_Sanders.webp).
    // The container hides itself via onerror if no image file exists, so images are optional.
    const personImageContainer = document.getElementById('person-image-container');
    const personImage = document.getElementById('person-image');
    const imageFileName = currentTarget.name.replace(/ /g, '_') + '.webp';
    const imagePath = `images/${imageFileName}`;

    // Attach handlers before setting src — a cached image can fire onload
    // synchronously-ish, so the handlers must already be in place.
    personImage.onerror = () => {
        personImageContainer.style.display = 'none';
    };
    personImage.onload = () => {
        personImageContainer.style.display = 'block';
    };

    personImage.alt = currentTarget.name;
    personImage.src = imagePath;

    // Show container optimistically (onerror will hide it if the image doesn't exist)
    personImageContainer.style.display = 'block';

    // 3. Use MODE_CONFIG for display customization — mirrors original
    resultLabel.textContent = config.resultLabel;
    nextBtn.textContent = config.nextBtnText;

    // Set Wikipedia link — uses wiki slug directly from JSON (no suffix needed)
    resultWikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(currentTarget.wiki)}`;

    // 4. Show the panel
    resultPanel.classList.remove('hidden');
}

// Check if a point is inside a polygon (using ray casting algorithm) — identical to original
function isPointInPolygon(point, geometry) {
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(polygon =>
            checkPointInPolygonCoordinates(point, polygon)
        );
    } else if (geometry.type === 'Polygon') {
        return checkPointInPolygonCoordinates(point, geometry.coordinates);
    }
    return false;
}

function checkPointInPolygonCoordinates(point, coordinates) {
    // coordinates[0] is the outer ring; any further rings are holes.
    // A point counts as "inside" only if it's inside the outer ring and
    // not inside any hole.
    if (!isInRing(point, coordinates[0])) return false;
    for (let r = 1; r < coordinates.length; r++) {
        if (isInRing(point, coordinates[r])) return false;
    }
    return true;
}

function isInRing(point, ring) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

// Clear markers and lines from map — identical to original
function clearMarkers() {
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    if (actualMarker) {
        map.removeLayer(actualMarker);
        actualMarker = null;
    }
    if (connectionLine) {
        map.removeLayer(connectionLine);
        connectionLine = null;
    }
    if (highlightedPolygon) {
        map.removeLayer(highlightedPolygon);
        highlightedPolygon = null;
    }
}

// Next round — mirrors original nextRound() exactly (BKT update now happens in displayResult)
function nextRound() {
    if (lastGuessSuccessful) {
        streak++;
        updateStreakDisplay();
    } else {
        streak = 0;
        updateStreakDisplay();
    }

    map.setView(MAP_CENTER, MAP_ZOOM, { animate: true });
    startRound();
}

// Change game mode — mirrors original changeMode() exactly
function changeMode() {
    clearMarkers();
    map.setView(MAP_CENTER, MAP_ZOOM);
    modeSelection.classList.remove('hidden');
}

// Start the game when page loads
init();
