// static/app.js
(() => {
    // ---------- DOM ----------
    const $ = (sel) => document.querySelector(sel);
    const screenStart = $("#screen-start");
    const screenQuiz = $("#screen-quiz");
    const screenResults = $("#screen-results");
    const progressEl = $("#progress");
    const questionArea = $("#question-area");
    const inputEl = $("#answer-input");
    const submitBtn = $("#submit-answer");
    const restartBtn = $("#restart");

    // ---------- CONFIG ----------
    const SENATORS_URL = "senators.json";
    const DEFAULT_QUESTION_COUNT = 20;
    const PORTRAIT_BASE = "assets/";

    // ---------- STATE ----------
    const GameState = {
        data: {
            senators: [],
        },
        state: null, // holds the live game state object

        create(difficulty, questions) {
            this.state = {
                difficulty,
                questions,
                current_index: 0,
                answers: [],
                score: 0,
                start_time: new Date().toISOString(),
                end_time: null,
                completed: false,
            };
            return this.state;
        },

        currentQuestion() {
            return this.state?.questions?.[this.state.current_index] || null;
        },

        recordAnswer(userAnswer) {
            this.state.answers.push(userAnswer);
            if (userAnswer.is_correct) this.state.score += 1;
            this.state.current_index += 1;
            if (this.state.current_index >= this.state.questions.length) {
                this.state.completed = true;
                this.state.end_time = new Date().toISOString();
            }
        },

        toResults() {
            const total = this.state.questions.length;
            const correct = this.state.answers.filter((a) => a.is_correct).length;
            const incorrect = total - correct;
            const score = Math.round((correct / total) * 100);

            const timeTakenMs =
                new Date(this.state.end_time || new Date()).getTime() -
                new Date(this.state.start_time).getTime();
            const timeTaken = formatDuration(timeTakenMs);

            return {
                total_questions: total,
                correct_answers: correct,
                incorrect_answers: incorrect,
                score,
                time_taken: timeTaken,
                answers_detail: this.state.answers,
            };
        },
    };

    // ---------- UTILITIES ----------
    function normalizeName(str) {
        return (str || "")
            .toLowerCase()
            .normalize("NFKD")                   // break accents (José → jose)
            .replace(/[\u0300-\u036f]/g, "")     // remove combining accent marks
            .replace(/[^a-z0-9\s]/g, "")         // drop punctuation (', -, ., etc)
            .replace(/\s+/g, " ")                // collapse multiple spaces
            .trim();
    }

    function lastNameOf(full) {
        const parts = normalizeName(full).split(" ");
        return parts[parts.length - 1] || "";
    }

    function officialName(sen) {
        return sen.name;
    }

    function formatDuration(ms) {
        const totalSecs = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(totalSecs / 60)
            .toString()
            .padStart(2, "0");
        const s = (totalSecs % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    // Levenshtein distance for mild misspellings (small & fast)
    function levenshtein(a = "", b = "") {
        a = normalizeName(a);
        b = normalizeName(b);
        const m = a.length,
            n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    }

    function withinMisspellingThreshold(input, target) {
        // Simple rule: allow distance 1 for short tokens, 2 for long tokens (>=7)
        const t = normalizeName(target);
        const i = normalizeName(input);
        const dist = levenshtein(i, t);
        if (t.length >= 7) return dist <= 2;
        return dist <= 1;
    }

    // ---------- DATA HELPERS ----------
    function groupByState(senators) {
        const byState = {};
        for (const s of senators) {
            if (!byState[s.state]) byState[s.state] = [];
            byState[s.state].push(s);
        }
        return byState;
    }

    function getByStatePartySeniority(senators, { state, party, seniority }) {
        return senators.filter((s) => {
            if (state && s.state !== state) return false;
            if (party && s.party !== party) return false;
            if (seniority && s.seniority !== seniority) return false;
            return true;
        });
    }

    // ---------- RULES: Templates ----------
    const Templates = {
        Easy: [
            { key: "state_any", type: "text" }, // "Name a senator from {state}."
            { key: "state_party_any", type: "text" }, // "Name a {party} senator from {state}."
            { key: "state_seniority", type: "text" }, // "Name the {seniority} Senator from {state}."
            { key: "party_of_portrait", type: "text" },  // which party does [NAME] belong to? (shows portrait + name)
            { key: "state_of_portrait", type: "text" },  // which state does [NAME] represent? (shows portrait + name)
        ],
        Hard: [
            { key: "portrait_only", type: "portrait" },
            { key: "state_seniority", type: "text" },
            { key: "state_party_seniority", type: "text" },
            { key: "party_of_random", type: "text" },    // randomized: either photo-only OR name-only
            { key: "state_of_random", type: "text" }     // randomized: same logic
        ],
    };

    // ---------- GENERATOR: Template Fillers ----------
    const Generator = {
        // Public API
        generateQuestion(difficulty, senators, rnd = Math.random) {
            // Shuffle allowed templates and try until one fits rules
            const allowed = [...Templates[difficulty]];
            shuffleInPlace(allowed, rnd);

            for (const t of allowed) {
                const q = this.tryTemplate(t.key, difficulty, senators, rnd);
                if (!isError(q)) {
                    logValidation(`Template '${t.key}' accepted.`);
                    return q;
                } else {
                    logValidation(
                        `Template '${t.key}' rejected: ${q.error_type} — ${q.message}`
                    );
                }
            }
            return errorObject(
                "unsolvable_template",
                "No suitable template could be generated for the current dataset.",
                null
            );
        },

        tryTemplate(key, difficulty, senators, rnd) {
            switch (key) {
                case "portrait_only":
                    return this.portraitOnly(difficulty, senators, rnd);
                case "state_any":
                    return this.stateAny(senators, rnd);
                case "state_party_any":
                    return this.statePartyAny(senators, rnd);
                case "state_seniority":
                    return this.stateSeniority(difficulty, senators, rnd);
                case "state_party_seniority":
                    return this.statePartySeniority(senators, rnd);
                case "party_of_portrait":
                    return this.partyOfPortrait(senators, rnd);
                case "state_of_portrait":
                    return this.stateOfPortrait(senators, rnd);
                case "party_of_random":
                    return this.partyOfRandom(difficulty, senators, rnd);
                case "state_of_random":
                    return this.stateOfRandom(difficulty, senators, rnd);
                default:
                    return errorObject("unknown_template", "Unknown template key.", {
                        key,
                    });
            }
        },

        portraitOnly(difficulty, senators, rnd) {
            const s = pickRandom(senators, rnd);
            if (!s || !s.portrait) {
                return errorObject("data_missing", "Portrait asset not found.", {
                    senator: s?.name || "unknown",
                });
            }
            const q = {
                id: makeId(),
                template: "Who is this senator?",
                filled_variables: {
                    portrait_image: s.portrait.startsWith("http")
                        ? s.portrait
                        : PORTRAIT_BASE + s.portrait,
                },
                difficulty,
                correct_answers: [officialName(s)],
                allowed_answer_modes: difficulty === "Easy" ? ["last_name", "full_name"] : ["full_name"],
                type: "portrait",
            };
            // Hard: Uniqueness is implied by portrait mapping to exactly 1 senator
            logValidation("portrait_only solvable: 1 match by portrait.");
            return q;
        },

        stateAny(senators, rnd) {
            // Easy only: "Name a senator from {state}."
            const byState = groupByState(senators);
            const states = Object.keys(byState).filter((st) => byState[st].length >= 1);
            const state = pickRandom(states, rnd);
            const matches = byState[state] || [];
            if (matches.length < 1) {
                return errorObject(
                    "unsolvable_template",
                    "No senators found for selected state.",
                    { state }
                );
            }
            const q = {
                id: makeId(),
                template: "Name a senator from {state}.",
                filled_variables: { state },
                difficulty: "Easy",
                correct_answers: matches.map((m) => officialName(m)),
                allowed_answer_modes: ["last_name", "full_name"],
                type: "text",
            };
            logValidation(
                `state_any solvable: ${matches.length} acceptable answers for ${state}.`
            );
            return q;
        },

        statePartyAny(senators, rnd) {
            // Easy only: "Name a {party} senator from {state}."
            const parties = ["Democrat", "Republican", "Independent"];
            // pick random state+party that yields >=1 match
            for (let attempt = 0; attempt < 30; attempt++) {
                const state = pickRandom(uniqueStates(senators), rnd);
                const party = pickRandom(parties, rnd);
                const matches = getByStatePartySeniority(senators, { state, party });

                if (matches.length >= 1) {
                    const q = {
                        id: makeId(),
                        template: "Name a {party} senator from {state}.",
                        filled_variables: { party, state },
                        difficulty: "Easy",
                        correct_answers: matches.map((m) => officialName(m)),
                        allowed_answer_modes: ["last_name", "full_name"],
                        type: "text",
                    };
                    logValidation(
                        `state_party_any solvable: ${matches.length} acceptable answers (${party}, ${state}).`
                    );
                    return q;
                }
            }
            return errorObject(
                "unsolvable_template",
                "Could not find a state+party with at least one match for Easy.",
                null
            );
        },

        stateSeniority(difficulty, senators, rnd) {
            // Both modes: "Name the {seniority} Senator from {state}."
            const seniorities = ["Senior", "Junior"];
            for (let attempt = 0; attempt < 40; attempt++) {
                const state = pickRandom(uniqueStates(senators), rnd);
                const seniority = pickRandom(seniorities, rnd);
                const matches = getByStatePartySeniority(senators, { state, seniority });

                if (matches.length === 1) {
                    const q = {
                        id: makeId(),
                        template: "Name the {seniority} Senator from {state}.",
                        filled_variables: { state, seniority },
                        difficulty,
                        correct_answers: [officialName(matches[0])],
                        allowed_answer_modes: difficulty === "Easy" ? ["last_name", "full_name"] : ["full_name"],
                        type: "text",
                    };
                    logValidation(
                        `state_seniority unique: 1 match (${seniority}, ${state}).`
                    );
                    return q;
                }
            }
            return errorObject(
                "ambiguous_answer",
                "Could not enforce uniqueness for state+seniority.",
                null
            );
        },

        statePartySeniority(senators, rnd) {
            // Hard only: "Name the {party} {seniority} Senator from {state}."
            const parties = ["Democrat", "Republican", "Independent"];
            const seniorities = ["Senior", "Junior"];
            for (let attempt = 0; attempt < 50; attempt++) {
                const state = pickRandom(uniqueStates(senators), rnd);
                const party = pickRandom(parties, rnd);
                const seniority = pickRandom(seniorities, rnd);
                const matches = getByStatePartySeniority(senators, {
                    state,
                    party,
                    seniority,
                });
                if (matches.length === 1) {
                    const q = {
                        id: makeId(),
                        template: "Name the {party} {seniority} Senator from {state}.",
                        filled_variables: { party, seniority, state },
                        difficulty: "Hard",
                        correct_answers: [officialName(matches[0])],
                        allowed_answer_modes: ["full_name"],
                        type: "text",
                    };
                    logValidation(
                        `state_party_seniority unique: 1 match (${party}, ${seniority}, ${state}).`
                    );
                    return q;
                }
            }
            return errorObject(
                "ambiguous_answer",
                "Could not enforce uniqueness for state+party+seniority in Hard.",
                null
            );
        },
        partyOfPortrait(senators, rnd) {
            const s = pickRandom(senators, rnd);
            if (!s) return errorObject("data_missing", "No senator found.", null);

            return {
                id: makeId(),
                template: "Which party does {name} belong to?",
                filled_variables: { name: officialName(s) },
                difficulty: "Easy",
                correct_answers: [s.party],  // exact canonical answer
                allowed_answer_modes: ["full_name"], // but we’ll validate manually
                type: "party_portrait",       // CUSTOM TYPE so UI knows to show BOTH name + portrait
                portrait_image: s.portrait.startsWith("http") ? s.portrait : PORTRAIT_BASE + s.portrait
            };
        },

        stateOfPortrait(senators, rnd) {
            const s = pickRandom(senators, rnd);
            if (!s) return errorObject("data_missing", "No senator found.", null);

            return {
                id: makeId(),
                template: "Which state does {name} represent?",
                filled_variables: { name: officialName(s) },
                difficulty: "Easy",
                correct_answers: [s.state],
                allowed_answer_modes: ["full_name"],
                type: "state_portrait",
                portrait_image: s.portrait.startsWith("http") ? s.portrait : PORTRAIT_BASE + s.portrait
            };
        },

        partyOfRandom(difficulty, senators, rnd) {
            const s = pickRandom(senators, rnd);
            if (!s) return errorObject("data_missing", "No senator found.", null);

            const coin = Math.random() < 0.5; // randomize portrait or name
            return {
                id: makeId(),
                template: coin
                    ? "Which party does this senator belong to?"
                    : "Which party does {name} belong to?",
                filled_variables: coin ? {} : { name: officialName(s) },
                difficulty: "Hard",
                correct_answers: [s.party],
                allowed_answer_modes: ["full_name"],
                type: coin ? "party_portrait_hard" : "party_text_hard",
                portrait_image: s.portrait.startsWith("http") ? s.portrait : PORTRAIT_BASE + s.portrait
            };
        },

        stateOfRandom(difficulty, senators, rnd) {
            const s = pickRandom(senators, rnd);
            if (!s) return errorObject("data_missing", "No senator found.", null);

            const coin = Math.random() < 0.5;
            return {
                id: makeId(),
                template: coin
                    ? "Which state does this senator represent?"
                    : "Which state does {name} represent?",
                filled_variables: coin ? {} : { name: officialName(s) },
                difficulty: "Hard",
                correct_answers: [s.state],
                allowed_answer_modes: ["full_name"],
                type: coin ? "state_portrait_hard" : "state_text_hard",
                portrait_image: s.portrait.startsWith("http") ? s.portrait : PORTRAIT_BASE + s.portrait
            };
        },
    };

    // ---------- VALIDATION ----------
    const Validator = {
        validateAnswer(question, userInput) {
            const mode = question.difficulty;
            const inputNorm = normalizeName(userInput);
            const correctNorms = question.correct_answers.map(normalizeName);

            // Hard: exact full official name only
            if (mode === "Hard") {
                const exact = correctNorms.includes(inputNorm);
                const ua = {
                    question_id: question.id,
                    user_input: userInput,
                    is_correct: exact,
                    accepted_as: "full_name",
                    feedback: exact
                        ? "Correct."
                        : `Hard mode requires the full official name. Correct answer: '${question.correct_answers[0]}'.`,
                };
                logValidation(
                    exact
                        ? "Hard: exact match accepted."
                        : "Hard: input rejected; requires full official name."
                );
                return ua;
            }

            // Easy mode:
            // exact full name
            if (correctNorms.includes(inputNorm)) {
                logValidation("Easy: exact full name accepted.");
                return ok("full_name", "Correct.");
            }

            // last name acceptance (if it maps to one of the allowed answers for this prompt)
            const last = lastNameOf(inputNorm);
            const matchesByLast = question.correct_answers.filter(
                (a) => lastNameOf(a) === last
            );
            if (matchesByLast.length === 1 && last) {
                logValidation("Easy: last name accepted.");
                return ok("last_name", "Correct.");
            }

            for (const ans of question.correct_answers) {
                if (withinMisspellingThreshold(inputNorm, ans)) {
                    logValidation("Easy: mild misspelling of full name accepted.");
                    return ok("misspelling_correction", "Correct.");
                }
            }

            for (const ans of question.correct_answers) {
                if (withinMisspellingThreshold(last, lastNameOf(ans)) && last) {
                    logValidation("Easy: mild misspelling of last name accepted.");
                    return ok("misspelling_correction", "Correct.");
                }
            }

            }

            // ambiguous last name in Easy (multiple)
            if (matchesByLast.length > 1) {
                logValidation("Easy: ambiguous last name → rejected.");
                return {
                    question_id: question.id,
                    user_input: userInput,
                    is_correct: false,
                    accepted_as: "full_name",
                    feedback:
                        "Ambiguous last name. Try the full name or include more detail.",
                };
            }

            logValidation("Easy: no match.");
            return {
                question_id: question.id,
                user_input: userInput,
                is_correct: false,
                accepted_as: "full_name",
                feedback: "Not quite. Easy accepts last names and mild misspellings.",
            };

            function ok(kind, feedback) {
                return {
                    question_id: question.id,
                    user_input: userInput,
                    is_correct: true,
                    accepted_as: kind,
                    feedback,
                };
            }
        },
    };

    // ---------- UI CONTROLLER ----------
    const UI = {
        mode: null,
        poolSize: DEFAULT_QUESTION_COUNT,
        
        async init() {
            // Disable difficulty buttons until data is ready
            const modeButtons = document.querySelectorAll(".mode-btn");
            modeButtons.forEach(btn => {
                btn.disabled = true;
            });

            // Load senator data (wait before enabling the game)
            GameState.data.senators = await loadSenators();

            // Safely attach click behavior — only after data is ready
            modeButtons.forEach(btn => btn.addEventListener("click", () => {
                this.startGame(btn.getAttribute("data-mode"));
            }));
            // Attach listeners for quiz submission and results screen
            submitBtn.addEventListener("click", () => this.submitCurrent());
            inputEl.addEventListener("keyup", (e) => {
                if (e.key === "Enter") this.submitCurrent();
            });
            restartBtn.addEventListener("click", () => this.restart());

            // Now enable buttons
            modeButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = "";
                btn.style.cursor = "pointer";
            });

            this.showScreen("start"); // Set the initial screen
        },

        async startGame(mode) {
            this.mode = mode === "Hard" ? "Hard" : "Easy";

            const questions = [];
            const MAX_ATTEMPTS = this.poolSize * 5; // hard cap so we NEVER infinite-loop
            let attempts = 0;

            while (questions.length < this.poolSize && attempts < MAX_ATTEMPTS) {
                attempts++;
                const q = Generator.generateQuestion(this.mode, GameState.data.senators);

                if (!isError(q)) {
                    questions.push(q);
                    continue;
                }

                // retry immediately
                const retry = Generator.generateQuestion(this.mode, GameState.data.senators);
                if (!isError(retry)) {
                    questions.push(retry);
                }
                // else we simply loop and try again — do NOT abort the whole run
            }

            if (questions.length < this.poolSize) {
                alert("Could not generate enough questions. Try Easy mode or refresh.");
                return;
            }

            GameState.create(this.mode, questions);
            this.showScreen("quiz");
            this.renderCurrent();
        },

        submitCurrent(evt) {
            if (evt) evt.preventDefault();

            // Prevent double-submits while a feedback animation is running
            if (submitBtn.disabled) return;

            const q = GameState.currentQuestion();
            if (!q) return;

            const raw = inputEl.value.trim();
            if (!raw) return; // ignore empty submits

            const ua = Validator.validateAnswer(q, raw);

            // Tuning knobs
            const CORRECT_ADVANCE_MS = 650;   // short pause on correct (no reveal)
            const REVEAL_DISPLAY_MS = 2400;  // how long wrong-answer text stays fully visible
            const REVEAL_FADE_MS = 800;   // slow fade duration (matches CSS transition)
            const FAST_FADE_MS = 120;   // quick fade when user advances early

            const block = document.querySelector(".question-block");
            if (!block) {
                // Fallback: if the block isn't mounted, just record and continue
                GameState.recordAnswer(ua);
                return GameState.state.completed ? UI.showResults() : UI.renderCurrent();
            }

            // Flash success/error on the question block
            block.classList.remove("correct", "incorrect");
            block.classList.add(ua.is_correct ? "correct" : "incorrect");

            // Lock UI during feedback window
            submitBtn.disabled = true;
            inputEl.disabled = true;

            let revealEl = null;
            let revealTimer = null;
            let advanceTimer = null;

            // Build a pretty "Correct:" line if user was wrong
            if (!ua.is_correct) {
                // Remove any previous reveal node (defensive)
                const old = block.querySelector(".correct-reveal");
                if (old) old.remove();

                // Derive a display answer
                const qObj = GameState.state.questions.find(x => x.id === ua.question_id) || q;
                let pretty = "See results";
                if (qObj.correct_answers && qObj.correct_answers.length > 0) {
                  const list = qObj.correct_answers;
                  if (list.length === 1) {
                    pretty = list[0];
                  } else if (list.length === 2) {
                    pretty = `${list[0]} or ${list[1]}`;
                  } else {
                    pretty = list.join(", ");
                  }
                } else if (qObj.display_answer) {
                  pretty = qObj.display_answer;
                }

                revealEl = document.createElement("div");
                revealEl.className = "correct-reveal";
                revealEl.setAttribute("aria-live", "polite");
                revealEl.textContent = `Correct: ${pretty}`;
                block.appendChild(revealEl);

            }

            // Advance handlers
            const finishAdvance = () => {
                // Cleanup visuals
                block.classList.remove("correct", "incorrect");
                const r = block.querySelector(".correct-reveal");
                if (r) r.remove();

                // Commit answer and move on
                GameState.recordAnswer(ua);

                // Unlock UI for the next step
                submitBtn.disabled = false;
                inputEl.disabled = false;
                inputEl.value = "";

                if (GameState.state.completed) {
                    UI.showResults();
                } else {
                    UI.renderCurrent();
                }
            };

            const doAdvance = () => {
                // Clear scheduled timers to avoid double-calls
                if (revealTimer) clearTimeout(revealTimer);
                if (advanceTimer) clearTimeout(advanceTimer);

                // If there's a reveal visible, fast-fade it before advancing
                const r = block.querySelector(".correct-reveal");
                if (r && !r.classList.contains("fade-out")) {
                    r.classList.add("fast", "fade-out"); // CSS sets fast transition
                    setTimeout(finishAdvance, FAST_FADE_MS);
                } else {
                    finishAdvance();
                }
            };

            // Auto-advance timing
            if (ua.is_correct) {
                // No reveal -> quick advance
                advanceTimer = setTimeout(doAdvance, CORRECT_ADVANCE_MS);
            } else {
                // Show reveal, then slow fade, then advance
                revealTimer = setTimeout(() => {
                    if (revealEl) revealEl.classList.add("fade-out"); // slow fade (CSS: 800ms)
                }, REVEAL_DISPLAY_MS);

                advanceTimer = setTimeout(
                    doAdvance,
                    REVEAL_DISPLAY_MS + REVEAL_FADE_MS + 150 // small buffer
                );
            }

            // Let Enter skip the delay (one-time)
            window.addEventListener(
                "keydown",
                (e) => { if (e.key === "Enter") doAdvance(); },
                { once: true }
            );
        },

        renderCurrent() {
            const q = GameState.currentQuestion();
            if (!q) return;

            // Progress
            const idx = GameState.state.current_index + 1;
            const total = GameState.state.questions.length;
            progressEl.textContent = `Question ${idx} of ${total}`;

            // Question area
            questionArea.innerHTML = "";
            const qEl = document.createElement("div");
            qEl.className = "question-block";

            if (q.type === "portrait" || q.type === "party_portrait" || q.type === "state_portrait" || q.type === "party_portrait_hard" || q.type === "state_portrait_hard") {
                // Always show portrait when ANY portrait-based type
                const img = document.createElement("img");
                img.src = q.portrait_image;
                img.alt = "Senator portrait";
                img.className = "senator-portrait";
                qEl.appendChild(img);

                const prompt = document.createElement("div");

                if (q.type === "party_portrait" || q.type === "state_portrait") {
                    // EASY MODE — portrait + NAME shown in prompt
                    prompt.textContent = renderTemplate(q.template, { name: q.filled_variables.name });
                } else if (q.type === "party_portrait_hard" || q.type === "state_portrait_hard") {
                    // HARD portrait — portrait only, NO NAME shown
                    prompt.textContent = q.template; // already says "this senator"
                } else {
                    // legacy normal portrait_only case
                    prompt.textContent = "Who is this senator?";
                }

                qEl.appendChild(prompt);
            } else {
                // PURE TEXT MODE (no portrait shown)
                const prompt = document.createElement("div");
                prompt.textContent = renderTemplate(q.template, q.filled_variables);
                qEl.appendChild(prompt);
            }

            // Validation note area (small muted text)
            const note = document.createElement("div");
            note.id = "validation-note";
            note.textContent = ""; // will be updated by logValidation
            qEl.appendChild(note);

            questionArea.appendChild(qEl);

            // Focus input
            inputEl.focus();
            // Reset previous logs
            setValidationNote("");
        },
        showResults() {
            const results = GameState.toResults();

            const summary = $("#results-summary");
            summary.innerHTML = "";

            // Title line
            const h = document.createElement("div");
            h.className = "results-score"; // <-- Use class
            h.textContent = `Score: ${results.score}% (${results.correct_answers}/${results.total_questions})`;
            summary.appendChild(h);

            const t = document.createElement("div");
            t.className = "results-time"; // <-- Use class
            t.textContent = `Time: ${results.time_taken}`;
            summary.appendChild(t);

            // ✅ OPTIMIZED: build a question map ONCE instead of searching every time
            const qmap = new Map(GameState.state.questions.map(q => [q.id, q]));

            // Per-question detail
            results.answers_detail.forEach((a) => {
                const row = document.createElement("div");
                row.className = "result-row"; // <-- Use class

                const q = qmap.get(a.question_id);
                const label = renderTemplate(q.template, q.filled_variables);
                const status = a.is_correct ? "✅" : "❌";

                // Updated innerHTML to use classes instead of inline styles
                row.innerHTML = `
          <div class="question-label">${status} ${escapeHtml(label)}</div>
          <div><strong>Your answer:</strong> ${escapeHtml(a.user_input)}</div>
          ${!a.is_correct
                        ? `<div><strong>Correct:</strong> ${escapeHtml(q.correct_answers[0])}</div>`
                        : ""
                    }
          <div class="feedback-text">${escapeHtml(a.feedback || "")}</div>
        `;
                summary.appendChild(row);
            });

            this.showScreen("results");
        },

        showScreen(name) {
            screenStart.classList.add("hidden");
            screenQuiz.classList.add("hidden");
            screenResults.classList.add("hidden");

            if (name === "start") screenStart.classList.remove("hidden");
            if (name === "quiz") screenQuiz.classList.remove("hidden");
            if (name === "results") screenResults.classList.remove("hidden");
        },

        restart() {
            this.showScreen("start");
            progressEl.textContent = "";
            questionArea.innerHTML = "";
            inputEl.value = "";
            $("#results-summary").innerHTML = "";
        },
    };

    // ---------- HELPERS ----------
    async function loadSenators() {
        try {
            const res = await fetch(SENATORS_URL);
            if (!res.ok) throw new Error("Failed to load senators.json");
            const data = await res.json();

            // Minimal normalization + constraints
            const cleaned = data
                .filter((s) => !!s && s.name && s.state && s.party && s.seniority)
                .map((s) => ({
                    name: s.name,
                    state: s.state,
                    party: oneOf(s.party, ["Democrat", "Republican", "Independent"])
                        ? s.party
                        : "Independent",
                    seniority: oneOf(s.seniority, ["Senior", "Junior"])
                        ? s.seniority
                        : "Junior",
                    portrait: s.portrait || s.portrait_image || "",
                }));
            return cleaned;
        } catch (e) {
            console.error(e);
            alert("Error loading senator data.");
            return [];
        }
    }

    function oneOf(val, arr) {
        return arr.includes(val);
    }

    function renderTemplate(tpl, vars) {
        return tpl
            .replace(/{name}/g, vars.name ?? "")
            .replace(/{state}/g, vars.state ?? "")
            .replace(/{party}/g, vars.party ?? "")
            .replace(/{seniority}/g, vars.seniority ?? "");
    }

    function errorObject(error_type, message, details) {
        return { error_type, message, details: details || null };
    }

    function isError(obj) {
        return obj && obj.error_type;
    }

    function makeId() {
        return "q_" + Math.random().toString(36).slice(2, 9);
    }

    function uniqueStates(senators) {
        return [...new Set(senators.map((s) => s.state))];
    }

    function pickRandom(arr, rnd = Math.random) {
        if (!arr || arr.length === 0) return null;
        const i = Math.floor(rnd() * arr.length);
        return arr[i];
    }

    function shuffleInPlace(arr, rnd = Math.random) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // Small validation summary note under the prompt
    function setValidationNote(text) {
        const note = $("#validation-note");
        if (note) note.textContent = text || "";
    }
    function logValidation(msg) {
        setValidationNote(msg);
        // Also log in console for dev visibility
        console.debug("[validation]", msg);
    }

    // ---------- BOOT ----------
    UI.init();
})();


