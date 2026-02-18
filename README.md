# US Politics Geography Quiz

A browser-based geography quiz game where you click a US map to identify the home state of a given senator or governor. Built as a spin-off of the Michigan Geography Quiz, sharing the same core architecture.

---

## How to Play

1. Choose a mode — **US Senators** or **Governors**
2. A politician's name and party abbreviation appear at the top
3. Click the state on the map you think they represent
4. The correct state highlights green. If you were wrong, your clicked state highlights red and a dashed blue line connects your click to the correct centroid
5. Read the fun fact and Wikipedia link in the sidebar, then hit **Next** to continue
6. Build your streak — consecutive correct answers count toward your high score (saved in localStorage)

---

## File Structure

```
us-politics-quiz/
├── index.html          # Game layout and HTML structure
├── styles.css          # All styles
├── script.js           # All game logic
├── senators.json       # 100 US senators (2 per state)
├── governors.json      # 50 governors (1 per state)
├── us_states.geojson   # US state boundary polygons — YOU MUST ADD THIS (see Setup)
└── images/             # Optional politician headshots — YOU ADD THESE (see Images)
```

---

## Setup

The game requires a local server to run — it uses `fetch()` to load the JSON and GeoJSON files, which browsers block when opening directly from the filesystem. Any simple server works:

```bash
# Python (built in)
python3 -m http.server 8000

# Node (if you have http-server installed)
npx http-server
```

Then open `http://localhost:8000` in your browser.

### Required: us_states.geojson

Download the US state boundary GeoJSON and save it as `us_states.geojson` in the project root:

```
https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json
```

The `name` property on each feature in this file must match the state name strings used in `senators.json` and `governors.json` (e.g. `"New York"`, not `"NY"`). The PublicaMundi file above uses full names and matches correctly.

---

## Images (Optional)

The game will display a headshot in the result sidebar if it finds a matching image file. If no image exists for a politician, the sidebar simply shows no image — nothing breaks.

**Convention:** `images/<Full_Name_With_Underscores>.webp`

Examples:
```
images/Bernie_Sanders.webp
images/Gretchen_Whitmer.webp
images/Katie_Britt.webp
```

The game derives the filename from `currentTarget.name` by replacing spaces with underscores and appending `.webp` — so your filenames must match the `name` field in the JSON exactly.

### Downloading Images from Wikipedia

Write a script that reads the names from `senators.json` and `governors.json`, fetches the thumbnail from the Wikipedia API, and saves the result as a compressed `.webp` file in `images/`. Recommended compression target: **~15–30KB per image** so the browser loads them quickly.

---

## Data Files

### senators.json / governors.json

Each record has the following fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | Full name — also used to derive the image filename |
| `state` | string | Full state name, must match the GeoJSON `name` property |
| `party` | string | `"D"`, `"R"`, or `"I"` |
| `since` | number | Year they took current office |
| `funFact` | string | Short interesting fact shown in the sidebar |
| `wiki` | string | Wikipedia article slug (used to build the URL) |

`lat`, `lng`, and `geometry` are **not** stored in the JSON — they are joined onto each record at runtime from `us_states.geojson` by `joinGeometryToData()` in `script.js`.

### Keeping Data Current

Political rosters change. When a senator or governor changes:

1. Find their record in `senators.json` or `governors.json`
2. Update `name`, `party`, `since`, `funFact`, and `wiki`
3. The `state` field stays the same — it just reflects which state the seat belongs to

Records that were uncertain at time of writing have a note in the `funFact` field. Seats most likely to need verification:

- **Florida** seat 2 (Rubio vacated for Secretary of State, Jan 2025)
- **Ohio** both seats (JD Vance vacated for VP, Jan 2025)
- **Illinois** seat 2 (Durbin retired, Jan 2025)
- **South Dakota** governor (Noem joined cabinet, Jan 2025)
- **New Jersey** governor (Murphy term end, early 2026)

---

## Architecture Notes

This game is a direct clone of the Michigan Geography Quiz with the following intentional changes:

| Original | This Quiz | Reason |
|---|---|---|
| `michigan_game_data.json` | `senators.json` + `governors.json` | Two separate datasets |
| `Counties.geojson` | `us_states.geojson` | Different boundary layer |
| `loadCountyData()` | `loadStatesData()` + `joinGeometryToData()` | Geometry lives in a separate file from politician data, so it gets joined at runtime |
| Distance thresholds (15/30/50 mi) | Scaled up (100/300/600 mi) | US states span hundreds of miles vs. Michigan counties at ~30 miles |
| `toggleCounties()` button | Removed | State outlines are always visible — they ARE the game board |
| Pool size dropdown | Removed | No equivalent concept for politicians |
| Try Again button | Removed | The correct state highlights immediately on guess, so retrying is pointless |

Everything else — `clearMarkers()`, `nextRound()`, `changeMode()`, `isPointInPolygon()`, `checkPointInPolygonCoordinates()`, the streak/high score logic, the result panel structure, the image `onerror`/`onload` pattern — is copied directly from the original.
