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
*   `styles.css`: The styling rules, custom UI components, and leaderboard layouts.
*   `script.js`: The core game logic, Leaflet map initialization, BKT algorithm, and timer management.
*   `senators.json`: A JSON array containing data for US Senators.
*   `governors.json`: A JSON array containing data for US Governors.
*   `us_states.geojson`: Geographic boundary data for all US states (required for polygon hit-detection and drawing state lines).
*   `images/`: A folder containing `.webp` images of the politicians, formatted as `Firstname_Lastname.webp` (e.g., `images/Bernie_Sanders.webp`).

### Expected JSON Format Example
Your `senators.json` and `governors.json` should follow this structure:
```json
[
  {
    "name": "Example Politician",
    "state": "Michigan",
    "party": "D",
    "since": "2019",
    "funFact": "This is a neat piece of trivia.",
    "wiki": "Example_Politician"
  }
]