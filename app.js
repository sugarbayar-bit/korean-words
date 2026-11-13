(() => {
  "use strict";

  // ---------- Setup ----------
  const cfg = window.APP_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && !cfg.SUPABASE_KEY.includes("YOUR-"));
  const SB_URL = String(cfg.SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const sb = configured && window.supabase ? window.supabase.createClient(SB_URL, cfg.SUPABASE_KEY.trim()) : null;
  const DEMO = !sb;

  const SETUP_KEY = "kw_setup_v1";
  const STATS_KEY = "kw_stats_v1";

  const state = {
    view: "test",
    loaded: false,
    error: null,
    user: null,
    categories: [],
    words: [],
    setup: Object.assign(
      { catIds: [], dir: "ko2m", lang: "en", count: 10, mode: "normal" },
      readJSON(SETUP_KEY, {})
    ),
    test: null,
    settings: { meaning: "en" },
    browse: { catId: null, search: "" },
    manage: { filterCat: "", search: "", renaming: null, draft: emptyDraft(), busy: false },
  };

  // ---------- Helpers ----------
  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function emptyDraft(catId = "") {
    return { id: null, category_id: catId, korean: "", english: "", mongolian: "", synonyms: "", note: "" };
  }
  const catName = (id) => (state.categories.find((c) => c.id === id) || {}).name || "—";
  const hasMeaning = (w) => !!((w.english || "").trim() || (w.mongolian || "").trim());
  function meaningOf(w, lang) {
    const en = (w.english || "").trim(), mn = (w.mongolian || "").trim();
    if (lang === "en") return en || mn;
    if (lang === "mn") return mn || en;
    return [en, mn].filter(Boolean).join(" · ");
  }
  const pref = () => state.settings.meaning || "en";
  const parseSyn = (s) => String(s || "").split(/[,，、;]/).map((x) => x.trim()).filter(Boolean);
  const synSet = (w) => new Set((w.synonyms || []).map(norm).filter(Boolean));

  // Two words count as "same meaning" -> never used as a wrong answer for each other
  function areSynonyms(a, b) {
    if (a.id === b.id) return true;
    const ka = norm(a.korean), kb = norm(b.korean);
    if (ka === kb) return true;
    if (synSet(a).has(kb) || synSet(b).has(ka)) return true;
    const ea = norm(a.english), eb = norm(b.english);
    if (ea && ea === eb) return true;
    const ma = norm(a.mongolian), mb = norm(b.mongolian);
    if (ma && ma === mb) return true;
    return false;
  }

  // ---------- Stats (per browser, never sent to server) ----------
  const loadStats = () => readJSON(STATS_KEY, {});
  function recordAnswer(id, ok) {
    const s = loadStats();
    const r = s[id] || { right: 0, wrong: 0 };
    ok ? r.right++ : r.wrong++;
    r.last = Date.now();
    s[id] = r;
    writeJSON(STATS_KEY, s);
  }
  const weakScore = (r) => (r ? r.wrong * 2 - r.right : -Infinity);

  // ---------- Data ----------
  async function loadData() {
    if (DEMO) {
      const d = demoData();
      state.categories = d.categories; state.words = d.words; state.loaded = true;
      render(); return;
    }
    const [c, w, st] = await Promise.all([
      sb.from("categories").select("*").order("name"),
      sb.from("words").select("*").order("created_at", { ascending: false }),
      sb.from("settings").select("*"),
    ]);
    if (!st.error && st.data) st.data.forEach((r) => { if (r.key === "meaning") state.settings.meaning = r.value; });
    if (c.error || w.error) state.error = (c.error || w.error).message;
    else { state.categories = c.data; state.words = w.data; state.error = null; }
    state.loaded = true;
    render();
  }

  // ---------- Translation (MyMemory, free) ----------
  async function translate(text, target) {
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|${target}`;
    if (cfg.TRANSLATE_EMAIL) url += `&de=${encodeURIComponent(cfg.TRANSLATE_EMAIL)}`;
    const res = await fetch(url);
    const j = await res.json();
    const out = (j && j.responseData && j.responseData.translatedText || "").trim();
    if (String(j.responseStatus) !== "200" || !out || /MYMEMORY WARNING/i.test(out)) {
      throw new Error(j.responseDetails || "Translation limit reached or failed");
    }
    return out;
  }

  // ---------- Synonym suggestions ----------
  const STOP = new Set(["a", "an", "the", "to", "of", "and", "or", "in", "on", "for", "be", "is", "with", "at", "by", "my", "your", "it", "do", "get"]);
  const tokens = (s) => norm(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  function synonymSuggestions(d) {
    const en = tokens(d.english), mn = tokens(d.mongolian);
    if (!en.length && !mn.length) return [];
    const k = norm(d.korean);
    const current = new Set(parseSyn(d.synonyms).map(norm));
    const out = [];
    for (const w of state.words) {
      if (w.id === d.id || norm(w.korean) === k || current.has(norm(w.korean))) continue;
      const we = new Set(tokens(w.english)), wm = new Set(tokens(w.mongolian));
      let score = 0;
      en.forEach((t) => { if (we.has(t)) score++; });
      mn.forEach((t) => { if (wm.has(t)) score++; });
      if (score) out.push({ w, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6).map((x) => x.w);
  }
  function duplicateOf(d) {
    const k = norm(d.korean);
    if (!k) return null;
    return state.words.find((w) => w.id !== d.id && norm(w.korean) === k) || null;
  }

  // ---------- Test logic ----------
  function buildQuestion(word, dir, lang, pool) {
    const d = dir === "mixed" ? (Math.random() < 0.5 ? "ko2m" : "m2ko") : dir;
    const answerText = (w) => (d === "ko2m" ? meaningOf(w, lang) : w.korean);
    const correct = answerText(word);
    const used = new Set([norm(correct)]);
    const same = shuffle(pool.filter((w) => w.category_id === word.category_id));
    const other = shuffle(pool.filter((w) => w.category_id !== word.category_id));
    const wrong = [];
    for (const w of same.concat(other)) {
      if (wrong.length >= 3) break;
      if (areSynonyms(word, w)) continue;
      const t = answerText(w);
      if (!t || used.has(norm(t))) continue;
      used.add(norm(t)); wrong.push(t);
    }
    if (wrong.length < 3) return null;
    const choices = shuffle([correct, ...wrong]);
    return {
      word, dir: d, choices, correctIndex: choices.indexOf(correct), answered: null,
      prompt: d === "ko2m" ? word.korean : meaningOf(word, lang),
    };
  }

  function startTest(onlyWords) {
    const s = state.setup;
    const pool = state.words.filter(hasMeaning);
    let list;
    if (onlyWords) {
      list = shuffle(onlyWords.filter(hasMeaning));
    } else {
      const cats = s.catIds.length ? s.catIds : state.categories.map((c) => c.id);
      list = pool.filter((w) => cats.includes(w.category_id));
      if (s.mode === "weak") {
        const st = loadStats();
        list = list.filter((w) => st[w.id] && st[w.id].wrong > 0)
          .sort((a, b) => weakScore(st[b.id]) - weakScore(st[a.id]));
        if (!list.length) { toast("No weak words yet in these categories 👍"); return; }
        if (s.count !== "all") list = list.slice(0, s.count);
        list = shuffle(list);
      } else {
        list = shuffle(list);
        if (s.count !== "all") list = list.slice(0, s.count);
      }
    }
    const qs = list.map((w) => buildQuestion(w, s.dir, pref(), pool)).filter(Boolean);
    if (!qs.length) {
      toast(pool.length < 4 ? "You need at least 4 words to make a test" : "No words in the chosen categories");
      return;
    }
    state.test = { questions: qs, i: 0, score: 0, mistakes: [], done: false };
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Rendering ----------
  function render() {
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    ["test", "words", "stats", "manage"].forEach((v) => { document.getElementById("view-" + v).hidden = v !== state.view; });
    document.getElementById("authBadge").textContent = DEMO ? "demo" : state.user ? "owner" : "";
    const el = document.getElementById("view-" + state.view);
    if (!state.loaded) { el.innerHTML = `<div class="card center muted">Loading…</div>`; return; }
    if (state.error) {
      el.innerHTML = `<div class="card"><div class="notice bad">Could not load words: ${esc(state.error)}</div>
        <button class="btn block" data-action="reload">Try again</button></div>`;
      return;
    }
    if (state.view === "test") el.innerHTML = renderTest();
    if (state.view === "words") el.innerHTML = renderWords();
    if (state.view === "stats") el.innerHTML = renderStats();
    if (state.view === "manage") { el.innerHTML = renderManage(); updateDraftHints(); }
  }

  function demoBanner() {
    return DEMO ? `<div class="notice info">Demo mode with sample words. Fill in <b>config.js</b> to connect your Supabase database.</div>` : "";
  }

  function seg(key, options) {
    return `<div class="seg">${options.map(([val, label]) =>
      `<button data-action="set" data-key="${key}" data-val="${val}" class="${String(state.setup[key]) === String(val) ? "on" : ""}">${label}</button>`).join("")}</div>`;
  }

  function renderTest() {
    const t = state.test;
    if (!t) return renderSetup();
    if (t.done) return renderResults();
    const q = t.questions[t.i];
    const answered = q.answered !== null;
    const label = q.dir === "ko2m" ? "What does this mean?" : "What is this in Korean?";
    const long = q.prompt.length > 14 ? " long" : "";
    let fb = "";
    if (answered) {
      const ok = q.answered === q.correctIndex;
      const w = q.word;
      const extra = [
        `<b>${esc(w.korean)}</b> = ${esc(meaningOf(w, pref()))}`,
        (w.synonyms || []).length ? `Synonyms: ${esc(w.synonyms.join(", "))}` : "",
        w.note ? esc(w.note) : "",
      ].filter(Boolean).join("<br>");
      fb = `<div class="feedback ${ok ? "good" : "bad"}"><b>${ok ? "Correct! 정답!" : "Not quite."}</b>
        <div class="extra">${extra}</div></div>
        <button class="btn primary block" style="margin-top:12px" data-action="next">${t.i + 1 < t.questions.length ? "Next →" : "See results"}</button>`;
    }
    return `<div class="card">
      <div class="qmeta"><span>Question ${t.i + 1} / ${t.questions.length} · Score ${t.score}</span>
        <button class="quitx" data-action="quit-test" aria-label="Quit test">✕</button></div>
      <div class="progress"><div style="width:${(t.i / t.questions.length) * 100}%"></div></div>
      <div class="prompt"><div class="label">${label}</div><div class="word${long}">${esc(q.prompt)}</div></div>
      <div class="choices">${q.choices.map((c, i) => {
        let cls = "";
        if (answered) { if (i === q.correctIndex) cls = "correct"; else if (i === q.answered) cls = "wrong"; }
        return `<button class="choice ${cls}" data-action="answer" data-i="${i}" ${answered ? "disabled" : ""}><span class="n">${i + 1}</span><span>${esc(c)}</span></button>`;
      }).join("")}</div>
      ${fb}
    </div>`;
  }

  function renderSetup() {
    const s = state.setup;
    const counts = {};
    state.words.forEach((w) => { if (hasMeaning(w)) counts[w.category_id] = (counts[w.category_id] || 0) + 1; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!state.categories.length) {
      return demoBanner() + `<div class="card center"><h2>No words yet</h2><p class="muted">Go to <b>Manage</b>, log in, and add a category and some words.</p></div>`;
    }
    return demoBanner() + `<div class="card">
      <h2>Start a test</h2>
      <h3>Categories</h3>
      <div class="chips">
        <button class="chip ${s.catIds.length ? "" : "on"}" data-action="cat-all">All<small>${total}</small></button>
        ${state.categories.map((c) => `<button class="chip ${s.catIds.includes(c.id) ? "on" : ""}" data-action="cat-toggle" data-id="${c.id}">${esc(c.name)}<small>${counts[c.id] || 0}</small></button>`).join("")}
      </div>
      <h3>Direction</h3>
      ${seg("dir", [["ko2m", "한국어 → Meaning"], ["m2ko", "Meaning → 한국어"], ["mixed", "Mixed"]])}
      <h3>Questions</h3>
      ${seg("count", [[10, "10"], [20, "20"], [30, "30"], ["all", "All"]])}
      <h3>Mode</h3>
      ${seg("mode", [["normal", "All words"], ["weak", "My weak words"]])}
      <button class="btn primary block" style="margin-top:18px" data-action="start">Start ▶</button>
    </div>`;
  }

  function renderResults() {
    const t = state.test;
    const n = t.questions.length;
    const pct = Math.round((t.score / n) * 100);
    const msg = pct === 100 ? "Perfect! 완벽해요! 🎉" : pct >= 80 ? "Great job! 잘했어요!" : pct >= 50 ? "Good — keep practicing. 화이팅!" : "Keep going — review the mistakes below.";
    const uniq = [...new Map(t.mistakes.map((w) => [w.id, w])).values()];
    return `<div class="card center">
      <div class="muted">Your score</div>
      <div class="score">${t.score}<small> / ${n}</small></div>
      <p>${msg}</p>
    </div>
    ${uniq.length ? `<div class="card"><h2>Mistakes (${uniq.length})</h2><ul class="list">
      ${uniq.map((w) => `<li><div class="main"><div class="ko">${esc(w.korean)}</div><div class="mean">${esc(meaningOf(w, pref()))}</div></div></li>`).join("")}
    </ul><button class="btn primary block" style="margin-top:10px" data-action="retry-mistakes">Retry these mistakes</button></div>` : ""}
    <div class="row"><button class="btn grow" data-action="quit">New test</button><button class="btn primary grow" data-action="start">Same settings again</button></div>`;
  }

  function renderWords() {
    const b = state.browse;
    if (!state.categories.length) return demoBanner() + `<div class="card center muted">No categories yet.</div>`;
    const counts = {};
    state.words.forEach((w) => { counts[w.category_id] = (counts[w.category_id] || 0) + 1; });
    const cat = state.categories.find((c) => c.id === b.catId);
    if (!cat) {
      return demoBanner() + `<div class="card"><h2>Categories</h2><ul class="list">
        ${state.categories.map((c) => `<li class="clickable" data-action="browse-cat" data-id="${c.id}">
          <div class="main"><div class="ko" style="font-size:17px">${esc(c.name)}</div><div class="mean">${counts[c.id] || 0} words</div></div>
          <span class="chev">›</span></li>`).join("")}
      </ul></div>`;
    }
    const q = norm(b.search);
    const words = state.words
      .filter((w) => w.category_id === cat.id)
      .filter((w) => !q || [w.korean, w.english, w.mongolian, (w.synonyms || []).join(" ")].some((x) => norm(x).includes(q)))
      .sort((a, c) => a.korean.localeCompare(c.korean, "ko"));
    return `<button class="btn small" style="margin-bottom:12px" data-action="browse-back">‹ All categories</button>
    <div class="card">
      <h2>${esc(cat.name)} <span class="muted" style="font-weight:400">(${counts[cat.id] || 0})</span></h2>
      <input type="search" data-input="browse-search" value="${esc(b.search)}" placeholder="Search in this category…">
      <ul class="list" style="margin-top:8px">
        ${words.map((w) => `<li><div class="main">
          <div class="ko">${esc(w.korean)}</div>
          <div class="mean">${esc(meaningOf(w, pref())) || "<i>no meaning</i>"}</div>
          ${(w.synonyms || []).length ? `<div class="syn">≈ ${esc(w.synonyms.join(", "))}</div>` : ""}
          ${w.note ? `<div class="note">${esc(w.note)}</div>` : ""}
        </div></li>`).join("") || `<li class="muted">No words found.</li>`}
      </ul>
      ${(counts[cat.id] || 0) >= 1 ? `<button class="btn primary block" style="margin-top:12px" data-action="browse-test">Test this category ▶</button>` : ""}
    </div>`;
  }

  function renderStats() {
    const st = loadStats();
    const byId = new Map(state.words.map((w) => [w.id, w]));
    let right = 0, wrong = 0;
    const rows = [];
    for (const [id, r] of Object.entries(st)) {
      const w = byId.get(Number(id));
      if (!w) continue;
      right += r.right; wrong += r.wrong;
      if (r.wrong > 0) rows.push({ w, r });
    }
    rows.sort((a, b) => b.r.wrong - a.r.wrong || weakScore(b.r) - weakScore(a.r));
    const total = right + wrong;
    return demoBanner() + `<div class="card">
      <h2>My stats</h2>
      <p class="muted" style="margin-top:-6px">Saved only on this device. Other people have their own stats.</p>
      <div class="row center">
        <div class="grow"><div class="score" style="font-size:30px">${total}</div><div class="muted">answers</div></div>
        <div class="grow"><div class="score" style="font-size:30px">${total ? Math.round((right / total) * 100) : 0}%</div><div class="muted">correct</div></div>
        <div class="grow"><div class="score" style="font-size:30px">${rows.length}</div><div class="muted">weak words</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Most-missed words</h2>
      ${rows.length ? `<ul class="list">${rows.slice(0, 50).map(({ w, r }) => `<li>
          <div class="main"><div class="ko">${esc(w.korean)}</div><div class="mean">${esc(meaningOf(w, pref()))}</div></div>
          <span class="pill bad">✗ ${r.wrong}</span><span class="pill good">✓ ${r.right}</span>
          <button class="iconbtn" title="Reset this word" data-action="reset-word" data-id="${w.id}">↺</button>
        </li>`).join("")}</ul>
        <button class="btn primary block" style="margin-top:12px" data-action="practice-weak">Practice weak words</button>`
        : `<p class="muted">No mistakes yet. Take a test!</p>`}
    </div>
    ${total ? `<button class="btn danger block" data-action="reset-stats">Reset all my stats</button>` : ""}`;
  }

  function renderManage() {
    if (DEMO) {
      return demoBanner() + `<div class="card"><h2>Manage</h2><p class="muted">Editing works after you connect Supabase. Follow the steps in README.md.</p></div>`;
    }
    if (!state.user) {
      return `<div class="card">
        <h2>Owner login</h2>
        <p class="muted" style="margin-top:-6px">Only the owner can add or change words. Everyone can take tests.</p>
        <form data-form="login">
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          <button class="btn primary block" type="submit">Log in</button>
        </form>
      </div>`;
    }
    const m = state.manage, d = m.draft;
    const filtered = state.words.filter((w) =>
      (!m.filterCat || String(w.category_id) === String(m.filterCat)) &&
      (!m.search || [w.korean, w.english, w.mongolian, (w.synonyms || []).join(" ")].some((x) => norm(x).includes(norm(m.search)))));
    const catOptions = (sel) => state.categories.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const counts = {};
    state.words.forEach((w) => { counts[w.category_id] = (counts[w.category_id] || 0) + 1; });

    return `
    <div class="card" id="wordFormCard">
      <h2>${d.id ? "Edit word" : "Add a word or phrase"}</h2>
      ${state.categories.length ? `
      <form data-form="word" autocomplete="off">
        <label class="field"><span>Category</span>
          <select name="category_id" required><option value="">Choose…</option>${catOptions(d.category_id)}</select></label>
        <label class="field"><span>Korean</span>
          <div class="row"><input class="grow" type="text" name="korean" value="${esc(d.korean)}" placeholder="예: 병원" lang="ko" required>
          <button type="button" class="btn" data-action="autofill" ${m.busy ? "disabled" : ""}>${m.busy ? "…" : "✨ Auto-fill"}</button></div></label>
        <div id="dupHint"></div>
        <label class="field"><span>English meaning</span><input type="text" name="english" value="${esc(d.english)}" placeholder="hospital"></label>
        <label class="field"><span>Mongolian meaning</span><input type="text" name="mongolian" value="${esc(d.mongolian)}" placeholder="эмнэлэг" lang="mn"></label>
        <label class="field"><span>Synonyms (Korean, comma separated)</span><input type="text" name="synonyms" value="${esc(d.synonyms)}" placeholder="의원, 클리닉" lang="ko"></label>
        <div id="synHint"></div>
        <label class="field"><span>Note / example (optional)</span><textarea name="note" rows="2">${esc(d.note)}</textarea></label>
        <div class="row">
          ${d.id ? `<button type="button" class="btn danger" data-action="delete-word">Delete</button><button type="button" class="btn" data-action="cancel-edit">Cancel</button>` : ""}
          <button type="submit" class="btn primary grow">${d.id ? "Save changes" : "Add word"}</button>
        </div>
      </form>` : `<p class="muted">First create a category below.</p>`}
    </div>

    <div class="card">
      <h2>Words (${filtered.length})</h2>
      <div class="row" style="margin-bottom:8px">
        <select class="grow" data-input="filterCat"><option value="">All categories</option>${catOptions(m.filterCat)}</select>
      </div>
      <input type="search" data-input="search" value="${esc(m.search)}" placeholder="Search Korean, English, Mongolian…">
      <ul class="list" style="margin-top:8px">
        ${filtered.slice(0, 300).map((w) => `<li class="clickable" data-action="edit-word" data-id="${w.id}">
          <div class="main"><div class="ko">${esc(w.korean)}</div>
          <div class="mean">${esc(meaningOf(w, "both")) || "<i>no meaning</i>"}</div>
          ${(w.synonyms || []).length ? `<div class="syn">≈ ${esc(w.synonyms.join(", "))}</div>` : ""}</div>
          <span class="muted" style="font-size:12px">${esc(catName(w.category_id))}</span></li>`).join("") || `<li class="muted">No words found.</li>`}
      </ul>
    </div>

    <div class="card">
      <h2>Categories</h2>
      <form data-form="category" class="row" style="margin-bottom:6px">
        <input class="grow" type="text" name="name" placeholder="New category, e.g. 병원 Hospital" required>
        <button class="btn primary" type="submit">Add</button>
      </form>
      <ul class="list">
        ${state.categories.map((c) => m.renaming === c.id ? `<li>
          <form data-form="rename" data-id="${c.id}" class="row grow"><input class="grow" type="text" name="name" value="${esc(c.name)}" required>
          <button class="btn small primary" type="submit">Save</button><button class="btn small" type="button" data-action="rename-cancel">✕</button></form></li>`
          : `<li><div class="main"><div class="ko" style="font-size:16px">${esc(c.name)}</div><div class="mean">${counts[c.id] || 0} words</div></div>
          <button class="iconbtn" data-action="rename" data-id="${c.id}" title="Rename">✏️</button>
          <button class="iconbtn" data-action="delete-cat" data-id="${c.id}" title="Delete">🗑️</button></li>`).join("")}
      </ul>
    </div>
    <div class="card">
      <h2>Display settings</h2>
      <p class="muted" style="margin-top:-6px">Which meaning to show in tests, the Words tab and stats. Applies to everyone who uses the app.</p>
      <div class="seg">${[["en", "English first"], ["mn", "Mongolian first"], ["both", "Both"]].map(([v, l]) =>
        `<button data-action="set-meaning" data-val="${v}" class="${pref() === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <p class="muted" style="font-size:13px;margin:8px 0 0">${pref() === "en" ? "Shows only English. If a word has no English, shows Mongolian."
        : pref() === "mn" ? "Shows only Mongolian. If a word has no Mongolian, shows English." : "Shows English · Mongolian together."}</p>
    </div>
    <button class="btn block" data-action="logout">Log out</button>`;
  }

  // Updates only the hint areas, so typing is never interrupted
  function updateDraftHints() {
    const dupEl = document.getElementById("dupHint");
    const synEl = document.getElementById("synHint");
    if (!dupEl || !synEl) return;
    const d = state.manage.draft;
    const dup = duplicateOf(d);
    dupEl.innerHTML = dup ? `<div class="notice warn">Already saved: <b>${esc(dup.korean)}</b> = ${esc(meaningOf(dup, "both"))} (${esc(catName(dup.category_id))})</div>` : "";
    const sugg = synonymSuggestions(d);
    synEl.innerHTML = sugg.length ? `<div class="suggest"><div class="muted" style="margin-bottom:6px">Possible synonyms — tap to add:</div>
      <div class="chips">${sugg.map((w) => `<button type="button" class="chip" data-action="add-syn" data-ko="${esc(w.korean)}">+ ${esc(w.korean)} <small>${esc(meaningOf(w, "en"))}</small></button>`).join("")}</div></div>` : "";
  }

  function readDraftFromForm() {
    const f = document.querySelector('form[data-form="word"]');
    if (!f) return;
    const d = state.manage.draft;
    ["category_id", "korean", "english", "mongolian", "synonyms", "note"].forEach((k) => { if (f.elements[k]) d[k] = f.elements[k].value; });
  }

  // ---------- Actions ----------
  const actions = {
    tab(el) { state.view = el.dataset.view; render(); window.scrollTo(0, 0); },
    reload() { state.loaded = false; render(); loadData(); },
    set(el) {
      const k = el.dataset.key; let v = el.dataset.val;
      if (k === "count" && v !== "all") v = Number(v);
      state.setup[k] = v; writeJSON(SETUP_KEY, state.setup); render();
    },
    "cat-all"() { state.setup.catIds = []; writeJSON(SETUP_KEY, state.setup); render(); },
    "cat-toggle"(el) {
      const id = Number(el.dataset.id), ids = state.setup.catIds;
      state.setup.catIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      writeJSON(SETUP_KEY, state.setup); render();
    },
    start() { startTest(); },
    "browse-cat"(el) { state.browse.catId = Number(el.dataset.id); state.browse.search = ""; render(); window.scrollTo(0, 0); },
    "browse-back"() { state.browse.catId = null; render(); window.scrollTo(0, 0); },
    "browse-test"() {
      state.setup.catIds = [state.browse.catId]; state.setup.mode = "normal"; writeJSON(SETUP_KEY, state.setup);
      state.view = "test"; state.test = null; startTest();
    },
    async "set-meaning"(el) {
      const v = el.dataset.val, old = pref();
      if (v === old) return;
      readDraftFromForm();
      state.settings.meaning = v; render();
      if (DEMO) return;
      const { error } = await sb.from("settings").upsert({ key: "meaning", value: v });
      if (error) {
        state.settings.meaning = old; readDraftFromForm(); render();
        toast(/settings/i.test(error.message) ? "Run update-v2.sql in Supabase first" : error.message);
      } else toast("Saved for everyone");
    },
    answer(el) {
      const t = state.test, q = t.questions[t.i];
      if (q.answered !== null) return;
      q.answered = Number(el.dataset.i);
      const ok = q.answered === q.correctIndex;
      if (ok) t.score++; else t.mistakes.push(q.word);
      recordAnswer(q.word.id, ok);
      render();
    },
    next() {
      const t = state.test; t.i++;
      if (t.i >= t.questions.length) t.done = true;
      render(); window.scrollTo(0, 0);
    },
    quit() { state.test = null; render(); },
    "quit-test"() {
      if (confirm("Quit this test? Your progress in this test will be lost.")) { state.test = null; render(); }
    },
    "retry-mistakes"() { startTest([...new Map(state.test.mistakes.map((w) => [w.id, w])).values()]); },
    "practice-weak"() { state.setup.mode = "weak"; writeJSON(SETUP_KEY, state.setup); state.view = "test"; startTest(); },
    "reset-word"(el) { const s = loadStats(); delete s[el.dataset.id]; writeJSON(STATS_KEY, s); render(); toast("Word reset"); },
    "reset-stats"() { if (confirm("Reset all your test stats on this device?")) { writeJSON(STATS_KEY, {}); render(); toast("Stats reset"); } },

    async autofill() {
      readDraftFromForm();
      const d = state.manage.draft, text = d.korean.trim();
      if (!text) { toast("Type the Korean first"); return; }
      const fillBoth = !!(d.english.trim() && d.mongolian.trim());
      state.manage.busy = true; render();
      const [en, mn] = await Promise.allSettled([
        fillBoth || !d.english.trim() ? translate(text, "en") : Promise.resolve(null),
        fillBoth || !d.mongolian.trim() ? translate(text, "mn") : Promise.resolve(null),
      ]);
      state.manage.busy = false;
      if (en.status === "fulfilled" && en.value) d.english = en.value;
      if (mn.status === "fulfilled" && mn.value) d.mongolian = mn.value;
      render();
      if (en.status === "rejected" || mn.status === "rejected") toast("Auto-fill failed: " + ((en.reason || mn.reason).message || "try later"));
      else toast("Check the suggestion and edit if needed");
    },
    "add-syn"(el) {
      readDraftFromForm();
      const d = state.manage.draft, list = parseSyn(d.synonyms);
      if (!list.includes(el.dataset.ko)) list.push(el.dataset.ko);
      d.synonyms = list.join(", ");
      const f = document.querySelector('form[data-form="word"]');
      if (f) f.elements.synonyms.value = d.synonyms;
      updateDraftHints();
    },
    "edit-word"(el) {
      const w = state.words.find((x) => x.id === Number(el.dataset.id));
      if (!w) return;
      state.manage.draft = { id: w.id, category_id: w.category_id, korean: w.korean, english: w.english || "", mongolian: w.mongolian || "", synonyms: (w.synonyms || []).join(", "), note: w.note || "" };
      render();
      document.getElementById("wordFormCard").scrollIntoView({ behavior: "smooth" });
    },
    "cancel-edit"() { state.manage.draft = emptyDraft(state.manage.draft.category_id); render(); },
    async "delete-word"() {
      const d = state.manage.draft;
      if (!d.id || !confirm(`Delete "${d.korean}"?`)) return;
      const { error } = await sb.from("words").delete().eq("id", d.id);
      if (error) { toast(error.message); return; }
      state.words = state.words.filter((w) => w.id !== d.id);
      state.manage.draft = emptyDraft(d.category_id);
      render(); toast("Deleted");
    },
    rename(el) { state.manage.renaming = Number(el.dataset.id); readDraftFromForm(); render(); },
    "rename-cancel"() { state.manage.renaming = null; readDraftFromForm(); render(); },
    async "delete-cat"(el) {
      const id = Number(el.dataset.id), n = state.words.filter((w) => w.category_id === id).length;
      if (!confirm(`Delete category "${catName(id)}"${n ? ` and its ${n} words` : ""}?`)) return;
      const { error } = await sb.from("categories").delete().eq("id", id);
      if (error) { toast(error.message); return; }
      readDraftFromForm();
      state.categories = state.categories.filter((c) => c.id !== id);
      state.words = state.words.filter((w) => w.category_id !== id);
      state.setup.catIds = state.setup.catIds.filter((x) => x !== id);
      if (String(state.manage.draft.category_id) === String(id)) state.manage.draft.category_id = "";
      render(); toast("Category deleted");
    },
    async logout() { await sb.auth.signOut(); toast("Logged out"); },
  };

  const forms = {
    async login(f) {
      const { error } = await sb.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.password.value });
      if (error) toast(error.message); else toast("Welcome back!");
    },
    async category(f) {
      const name = f.elements.name.value.trim();
      if (!name) return;
      readDraftFromForm();
      const { data, error } = await sb.from("categories").insert({ name }).select().single();
      if (error) { toast(error.code === "23505" ? "That category already exists" : error.message); return; }
      state.categories = [...state.categories, data].sort((a, b) => a.name.localeCompare(b.name));
      if (!state.manage.draft.category_id) state.manage.draft.category_id = data.id;
      render(); toast("Category added");
    },
    async rename(f) {
      const id = Number(f.dataset.id), name = f.elements.name.value.trim();
      if (!name) return;
      const { data, error } = await sb.from("categories").update({ name }).eq("id", id).select().single();
      if (error) { toast(error.message); return; }
      state.categories = state.categories.map((c) => (c.id === id ? data : c)).sort((a, b) => a.name.localeCompare(b.name));
      state.manage.renaming = null; render(); toast("Renamed");
    },
    async word() {
      readDraftFromForm();
      const d = state.manage.draft;
      if (!d.category_id) { toast("Choose a category"); return; }
      if (!d.korean.trim()) { toast("Type the Korean word"); return; }
      if (!d.english.trim() && !d.mongolian.trim()) { toast("Add at least one meaning"); return; }
      const row = {
        category_id: Number(d.category_id), korean: d.korean.trim(),
        english: d.english.trim() || null, mongolian: d.mongolian.trim() || null,
        synonyms: [...new Set(parseSyn(d.synonyms))], note: d.note.trim() || null,
      };
      const res = d.id
        ? await sb.from("words").update(row).eq("id", d.id).select().single()
        : await sb.from("words").insert(row).select().single();
      if (res.error) { toast(res.error.message); return; }
      const saved = res.data;
      state.words = d.id ? state.words.map((w) => (w.id === saved.id ? saved : w)) : [saved, ...state.words];
      state.manage.draft = emptyDraft(saved.category_id);
      render();
      toast(d.id ? "Saved" : `Added "${saved.korean}"`);
      const k = document.querySelector('form[data-form="word"] [name="korean"]');
      if (k && !d.id) k.focus();
    },
  };

  // ---------- Events ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("form[data-form]");
    if (!f) return;
    e.preventDefault();
    const fn = forms[f.dataset.form];
    if (fn) fn(f);
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.closest('form[data-form="word"]')) { readDraftFromForm(); updateDraftHints(); return; }
    if (t.dataset.input === "search" || t.dataset.input === "browse-search") {
      const key = t.dataset.input;
      if (key === "search") { state.manage.search = t.value; readDraftFromForm(); }
      else state.browse.search = t.value;
      const pos = t.selectionStart;
      render();
      const s = document.querySelector(`[data-input="${key}"]`);
      if (s) { s.focus(); s.setSelectionRange(pos, pos); }
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.input === "filterCat") { state.manage.filterCat = t.value; readDraftFromForm(); render(); }
    if (t.name === "category_id" && t.closest('form[data-form="word"]')) readDraftFromForm();
  });
  // Keyboard: 1-4 to answer, Enter for next
  document.addEventListener("keydown", (e) => {
    if (state.view !== "test" || !state.test || state.test.done || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const q = state.test.questions[state.test.i];
    if (q.answered === null && /^[1-4]$/.test(e.key)) actions.answer({ dataset: { i: Number(e.key) - 1 } });
    else if (q.answered !== null && e.key === "Enter") actions.next();
  });

  // ---------- Auth ----------
  if (sb) {
    sb.auth.getSession().then(({ data }) => { state.user = data.session ? data.session.user : null; render(); });
    sb.auth.onAuthStateChange((_evt, session) => {
      const u = session ? session.user : null;
      if ((u && u.id) !== (state.user && state.user.id)) { state.user = u; render(); }
    });
  }

  // ---------- Demo data (only when config.js is not filled in) ----------
  function demoData() {
    const categories = [{ id: 1, name: "음식 Food" }, { id: 2, name: "병원 Hospital" }];
    const raw = [
      [1, "물", "water", "ус"], [1, "밥", "cooked rice; meal", "будаа; хоол"], [1, "빵", "bread", "талх"],
      [1, "사과", "apple", "алим"], [1, "우유", "milk", "сүү"], [1, "고기", "meat", "мах"], [1, "커피", "coffee", "кофе"],
      [2, "병원", "hospital", "эмнэлэг", ["의원"]], [2, "의원", "clinic", "эмнэлэг", ["병원"]], [2, "의사", "doctor", "эмч"],
      [2, "간호사", "nurse", "сувилагч"], [2, "약", "medicine", "эм"], [2, "감기", "a cold (illness)", "ханиад"], [2, "아프다", "to hurt; to be sick", "өвдөх"],
    ];
    const words = raw.map(([c, k, en, mn, syn], i) => ({ id: i + 1, category_id: c, korean: k, english: en, mongolian: mn, synonyms: syn || [], note: null }));
    return { categories, words };
  }

  render();
  loadData();
})();
