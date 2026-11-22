# US Politics Geography Quiz

Test your knowledge of American politics with this interactive, map-based geography quiz! Players are tasked with locating the home states of US Senators and Governors by clicking on an interactive map.

---

## 🌟 Features

*   **Two Game Modes:** Choose between testing your knowledge of US Senators or state Governors.
*   **Adaptive Learning (BKT):** The game uses Bayesian Knowledge Tracing (BKT) to track your mastery of each politician. Targets you struggle with will appear more frequently, while mastered targets will occasionally resurface to test long-term retention.
*   **Speedrun Timer:** Race against the clock! A live timer tracks your run down to the millisecond and stops the moment you achieve 100% mastery of the selected pool.
*   **Local Leaderboards:** Qualify for the top 5 fastest times per mode. Scores and initials are saved locally in your browser.
*   **Interactive Map:** Built with Leaflet.js, featuring satellite imagery, state boundaries, visual distance feedback, and ray-casting algorithms to detect clicks precisely within state polygons.
*   **Rich Result Feedback:** After guessing, view detailed information about the target, including their exact state, party affiliation, time in office, an image, a fun fact, and a direct link to their Wikipedia page.
*   **Quit-Guards:** Accidentally clicking "Change Mode" or closing the tab during an active run triggers a warning, preventing accidental progress loss.

---

## 📂 File Structure

To run this game properly, ensure your project directory contains the following files:

*   `index.html`: The main structural file containing the game UI and map container.
*   `style.css`: The styling rules, custom UI components, and leaderboard layouts.
*   `script.js`: The core game logic, Leaflet map initialization, BKT algorithm, timer management, and term switch-over logic.
*   `senators.json`: Data for US Senators.
*   `governors.json`: Data for US Governors.
*   `us_states.geojson`: Geographic boundary data for all US states (required for polygon hit-detection and drawing state lines).
*   `images/`: A folder containing `.webp` images of the politicians, named after the `name` field with spaces replaced by underscores (e.g., `images/Bernie_Sanders.webp`). A missing image is fine — the image box just stays hidden.

### JSON Format
Both files share this structure:
```json
{
  "lastUpdated": "2026-11-22",
  "termStart": "2027-01-03",
  "termStarts": { "Alaska": "2026-12-07" },
  "officials": [
    {
      "name": "Example Politician",
      "state": "Michigan",
      "party": "D",
      "since": 2019,
      "funFact": "This is a neat piece of trivia.",
      "wiki": "Example_Politician"
    }
  ]
}
```

*   `lastUpdated` — the date you last edited the file. Used for the out-of-date notice (see below).
*   `termStart` — the switch-over date for every state (senators: Jan 3 after each election).
*   `termStarts` — per-state switch-over dates, which override `termStart` (governors: each state has its own inauguration day).
*   `party` — `D`, `R`, or `I`.

---

## 🗳️ Keeping the Data Current

The game only ever shows the people serving **on the day it's played**. It does this from dates in the JSON — no API, nothing to update in the code.

### Optional flags on an official

| Flag | What it does |
| --- | --- |
| `"leaving": true` | They're still serving but won't serve the next term (retiring, lost, term-limited). Shows a small `*` in the results panel. They disappear automatically once an `incoming` official from the same state takes office. |
| `"incoming": true` | Newly elected. Hidden until their state's switch-over date (`termStarts[state]`, otherwise `termStart`). |
| `"termStart": "YYYY-MM-DD"` | On an incoming official: their own start date, for rare cases like a special-election winner sworn in early. |
| `"leavesOn": "YYYY-MM-DD"` | On a leaving official: the date they disappear even if no replacement is listed (e.g. resigning to take another office before a successor is named). |

All dates are `YYYY-MM-DD` and are compared against the visitor's local date.

### After an election

1.  Add `"leaving": true` to everyone not returning.
2.  Add each winner with `"incoming": true`, and upload their photo to `images/`.
3.  Set the switch-over date(s) at the top of the file: `termStart` for senators, `termStarts` for each governor's state.
4.  Update `lastUpdated`.

That's it — the site switches over on its own on each date.

### Cleanup (any time after the switch-over)

Delete the `leaving` entries and their `.webp` photos, and remove the `incoming` / `termStart` flags from the new officials. There's no rush: leftover flags and past dates do nothing once the switch-over has happened.

You can also flag someone `leaving` mid-term (e.g. they've announced retirement). They'll keep their asterisk and stay in the game until you add their replacement as `incoming`.

### Out-of-date notice

If either file's `lastUpdated` is older than the most recent November general election, and that election was more than 4 weeks ago, visitors see a small dismissible notice saying the data may be out of date. Updating `lastUpdated` after each November election (even in a quiet year) keeps it from showing.
