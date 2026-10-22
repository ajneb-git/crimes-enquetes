import { DEV_MODE, POINTS, MODULE_LABELS, PERF_LABELS } from './config.js';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  mode: null,           // 'solo' | 'multi' | 'ladder'
  players: [],          // [{ name, score }]
  currentPlayerIdx: 0,
  roundsPerPlayer: 5,
  questions: [],
  questionIdx: 0,
  soloScore: 0,
  soloMaxScore: 0,
  selectedModules: [],
  // Ladder
  ladderLives: 3,
  // QSJ
  qsjIndicesShown: 1,
  // Chronologie
  chronoEvents: [],
  chronoSelected: [],
  // replay
  lastSetup: null,
};

let allQuestions = [];

// ── Utils ─────────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(id) { return document.getElementById(id); }

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = el(id);
  if (target) {
    target.classList.add('active');
    target.scrollTop = 0;
  }
}

function setHidden(id, hidden) {
  const node = el(id);
  if (node) node.classList.toggle('hidden', hidden);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadAllQuestions() {
  let affaires;
  try {
    const r = await fetch('./data/affaires.json');
    affaires = (await r.json()).affaires;
  } catch {
    console.error('Impossible de charger affaires.json');
    return [];
  }

  const results = [];
  for (const affaire of affaires) {
    try {
      const r = await fetch(`./data/questions/${affaire.id}.json`);
      if (!r.ok) continue;
      const data = await r.json();
      const questions = data.questions.filter(q =>
        DEV_MODE ? true : q.statut === 'verifie'
      );
      results.push(...questions);
    } catch {
      console.warn(`Questions de "${affaire.id}" introuvables`);
    }
  }
  return results;
}

// ── Ladder localStorage helpers ───────────────────────────────────────────────

function getLadderBest() {
  try { return parseInt(localStorage.getItem('crimes_ladder_best') || '0', 10) || 0; }
  catch { return 0; }
}

function saveLadderBest(rank) {
  if (rank > getLadderBest()) {
    try { localStorage.setItem('crimes_ladder_best', rank); } catch {}
  }
}

function updateLadderBestDisplay() {
  const best = getLadderBest();
  const block = el('ladder-best-block');
  if (!block) return;
  if (best > 0) {
    block.textContent = `Ton record : ${best}/30`;
    block.classList.remove('hidden');
  } else {
    block.classList.add('hidden');
  }
  const homeRecord = el('ladder-home-record');
  if (homeRecord) {
    if (best > 0) {
      homeRecord.textContent = `🏅 Enquêteur — Record : ${best}/30`;
      homeRecord.classList.remove('hidden');
    } else {
      homeRecord.classList.add('hidden');
    }
  }
}

// ── Game setup ────────────────────────────────────────────────────────────────

function buildLadderTier(diff, count) {
  const key = `crimes_seen_d${diff}`;
  const pool = allQuestions.filter(q => q.difficulte === diff);
  if (!pool.length) return [];

  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { seen = new Set(); }

  let unseen = pool.filter(q => !seen.has(q.id));
  if (unseen.length < count) {
    seen = new Set();
    try { localStorage.removeItem(key); } catch {}
    unseen = pool;
  }

  const selected = shuffle(unseen).slice(0, count);
  selected.forEach(q => seen.add(q.id));
  try { localStorage.setItem(key, JSON.stringify([...seen])); } catch {}
  return selected;
}

function startLadder() {
  const questions = [
    ...buildLadderTier(1, 10),
    ...buildLadderTier(2, 10),
    ...buildLadderTier(3, 10),
  ];

  if (!questions.length) {
    alert('Aucune question disponible.');
    return;
  }

  state.mode = 'ladder';
  state.ladderLives = 3;
  state.questionIdx = 0;
  state.questions = questions;
  state.lastSetup = { type: 'ladder' };

  showNextQuestion();
}

function buildQuestionPool(modules, count) {
  const pool = modules.length
    ? allQuestions.filter(q => modules.includes(q.module))
    : allQuestions;

  if (!pool.length) return [];

  const shuffled = shuffle(pool);
  if (shuffled.length >= count) return shuffled.slice(0, count);

  // Cycle si pool trop petit
  const result = [];
  while (result.length < count) result.push(...shuffle(pool));
  return result.slice(0, count);
}

function startSolo(modules, rounds) {
  state.mode = 'solo';
  state.selectedModules = modules;
  state.roundsPerPlayer = rounds;
  state.soloScore = 0;
  state.questionIdx = 0;
  state.questions = buildQuestionPool(modules, rounds);
  state.soloMaxScore = state.questions.reduce((s, q) => s + (POINTS[q.difficulte] || 1), 0);
  state.lastSetup = { type: 'solo', modules, rounds };

  if (!state.questions.length) {
    alert('Aucune question disponible pour les modules sélectionnés.');
    return;
  }
  showNextQuestion();
}

function startMulti(players, rounds, modules) {
  state.mode = 'multi';
  state.players = players.map(name => ({ name, score: 0 }));
  state.currentPlayerIdx = 0;
  state.roundsPerPlayer = rounds;
  state.selectedModules = modules;
  state.questionIdx = 0;
  state.questions = buildQuestionPool(modules, players.length * rounds);
  state.lastSetup = { type: 'multi', players, rounds, modules };

  if (!state.questions.length) {
    alert('Aucune question disponible.');
    return;
  }
  showPrivacy();
}

// ── Screen: Privacy ───────────────────────────────────────────────────────────

function showPrivacy() {
  const player = state.players[state.currentPlayerIdx];
  el('privacy-name').textContent = player.name;
  show('screen-privacy');
}

// ── Screen: Question ──────────────────────────────────────────────────────────

function showNextQuestion() {
  if (state.questionIdx >= state.questions.length) {
    showEnd();
    return;
  }
  const q = state.questions[state.questionIdx];
  renderQuestion(q);
  show('screen-question');
}

// ── Question rendering ────────────────────────────────────────────────────────

function renderQuestion(q) {
  el('q-module-label').textContent = MODULE_LABELS[q.module] || q.module;
  el('q-difficulty').textContent = '⬥'.repeat(q.difficulte) + '⬦'.repeat(3 - q.difficulte);
  el('q-points').textContent = `${POINTS[q.difficulte]} pt${POINTS[q.difficulte] > 1 ? 's' : ''}`;
  el('q-counter').textContent = `${state.questionIdx + 1}/${state.questions.length}`;

  if (state.mode === 'ladder') {
    const lives = Math.max(0, state.ladderLives);
    el('q-lives').textContent = '❤️'.repeat(lives) + '🖤'.repeat(3 - lives);
    setHidden('q-lives', false);
  } else {
    setHidden('q-lives', true);
  }

  if (state.mode === 'multi') {
    el('q-player-name').textContent = state.players[state.currentPlayerIdx].name;
    setHidden('q-player-info', false);
    const scoresEl = el('q-scores');
    scoresEl.innerHTML = state.players.map(p =>
      `<span class="q-score-chip">${p.name} <strong>${p.score}</strong></span>`
    ).join('');
    setHidden('q-scores', false);
  } else {
    setHidden('q-player-info', true);
    setHidden('q-scores', true);
  }

  const content = el('question-content');
  content.innerHTML = '';

  switch (q.module) {
    case 'qcm':         renderQCM(q, content);       break;
    case 'vrai_faux':   renderVraiFaux(q, content);   break;
    case 'duel':        renderDuel(q, content);       break;
    case 'qui_suis_je': renderQSJ(q, content);        break;
    case 'chronologie': renderChrono(q, content);     break;
  }
}

function makeChoiceButtons(items, onSelect) {
  const div = document.createElement('div');
  div.className = 'choices';
  items.forEach(({ label, value }) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = label;
    btn.dataset.value = value;
    btn.addEventListener('click', () => {
      div.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
      onSelect(value, btn, div);
    });
    div.appendChild(btn);
  });
  return div;
}

function renderQCM(q, container) {
  const p = document.createElement('p');
  p.className = 'question-text';
  p.textContent = q.question;
  container.appendChild(p);

  const btns = makeChoiceButtons(
    q.propositions.map(p => ({ label: p, value: p })),
    (val, btn) => {
      const correct = val === q.bonne_reponse;
      highlightAnswer(btn, correct, container.querySelector(`[data-value="${q.bonne_reponse}"]`));
      setTimeout(() => onAnswer(correct, q), 900);
    }
  );
  container.appendChild(btns);
}

function renderVraiFaux(q, container) {
  const label = document.createElement('p');
  label.className = 'q-type-label';
  label.textContent = 'Vrai ou faux ?';
  container.appendChild(label);

  const p = document.createElement('p');
  p.className = 'question-text';
  p.textContent = q.affirmation;
  container.appendChild(p);

  const btns = makeChoiceButtons(
    [{ label: 'VRAI', value: 'true' }, { label: 'FAUX', value: 'false' }],
    (val, btn, div) => {
      const answer = val === 'true';
      const correct = answer === q.bonne_reponse;
      const correctVal = q.bonne_reponse ? 'true' : 'false';
      highlightAnswer(btn, correct, div.querySelector(`[data-value="${correctVal}"]`));
      setTimeout(() => onAnswer(correct, q), 900);
    }
  );
  btns.classList.add('choices-2');
  container.appendChild(btns);
}

function renderDuel(q, container) {
  const label = document.createElement('p');
  label.className = 'q-type-label';
  label.textContent = 'Duel';
  container.appendChild(label);

  const p = document.createElement('p');
  p.className = 'question-text';
  p.textContent = q.question;
  container.appendChild(p);

  const btns = makeChoiceButtons(
    [{ label: q.item_a, value: 'a' }, { label: q.item_b, value: 'b' }],
    (val, btn, div) => {
      const correct = val === q.bonne_reponse;
      highlightAnswer(btn, correct, div.querySelector(`[data-value="${q.bonne_reponse}"]`));
      setTimeout(() => onAnswer(correct, q), 900);
    }
  );
  btns.classList.add('choices-2');
  container.appendChild(btns);
}

function renderQSJ(q, container) {
  state.qsjIndicesShown = 1;

  const label = document.createElement('p');
  label.className = 'q-type-label';
  label.textContent = 'Qui suis-je ?';
  container.appendChild(label);

  const ul = document.createElement('ul');
  ul.className = 'indices-list';
  ul.id = 'indices-list';
  q.indices.forEach((ind, i) => {
    const li = document.createElement('li');
    li.className = 'indice' + (i >= state.qsjIndicesShown ? ' hidden' : '');
    li.dataset.idx = i;
    li.textContent = ind;
    ul.appendChild(li);
  });
  container.appendChild(ul);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn-hint';
  moreBtn.id = 'btn-more-indices';
  moreBtn.textContent = `Voir un autre indice (${state.qsjIndicesShown}/${q.indices.length})`;
  moreBtn.disabled = state.qsjIndicesShown >= q.indices.length;
  moreBtn.addEventListener('click', () => {
    state.qsjIndicesShown = Math.min(state.qsjIndicesShown + 1, q.indices.length);
    ul.querySelectorAll('.indice').forEach((li, i) => {
      if (i < state.qsjIndicesShown) li.classList.remove('hidden');
    });
    moreBtn.textContent = `Voir un autre indice (${state.qsjIndicesShown}/${q.indices.length})`;
    moreBtn.disabled = state.qsjIndicesShown >= q.indices.length;
  });
  container.appendChild(moreBtn);

  const btns = makeChoiceButtons(
    q.propositions.map(p => ({ label: p, value: p })),
    (val, btn, div) => {
      const correct = val === q.bonne_reponse;
      highlightAnswer(btn, correct, div.querySelector(`[data-value="${q.bonne_reponse}"]`));
      setTimeout(() => onAnswer(correct, q), 900);
    }
  );
  container.appendChild(btns);
}

function renderChrono(q, container) {
  state.chronoEvents = shuffle([...q.evenements]);
  state.chronoSelected = [];

  const label = document.createElement('p');
  label.className = 'q-type-label';
  label.textContent = 'Chronologie';
  container.appendChild(label);

  const p = document.createElement('p');
  p.className = 'question-text';
  p.textContent = q.question;
  container.appendChild(p);

  const eventsDiv = document.createElement('div');
  eventsDiv.className = 'chrono-events';
  eventsDiv.id = 'chrono-events';
  state.chronoEvents.forEach((ev, i) => {
    const card = document.createElement('div');
    card.className = 'chrono-card';
    card.dataset.idx = i;
    card.textContent = ev.label;
    card.addEventListener('click', () => onChronoTap(i, card, container));
    eventsDiv.appendChild(card);
  });
  container.appendChild(eventsDiv);

  const orderDiv = document.createElement('div');
  orderDiv.className = 'chrono-order';
  orderDiv.innerHTML = '<p class="order-label">Votre ordre :</p><div class="order-slots" id="order-slots"></div>';
  container.appendChild(orderDiv);

  const actions = document.createElement('div');
  actions.className = 'chrono-actions';

  const undoBtn = document.createElement('button');
  undoBtn.className = 'btn-hint';
  undoBtn.id = 'btn-chrono-undo';
  undoBtn.textContent = '↩ Annuler';
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', () => {
    if (!state.chronoSelected.length) return;
    const lastIdx = state.chronoSelected.pop();
    const card = eventsDiv.querySelector(`[data-idx="${lastIdx}"]`);
    card.classList.remove('selected');
    card.textContent = state.chronoEvents[lastIdx].label;
    updateChronoUI(eventsDiv);
  });

  const validateBtn = document.createElement('button');
  validateBtn.className = 'choice-btn btn-validate';
  validateBtn.id = 'btn-chrono-validate';
  validateBtn.textContent = 'Valider';
  validateBtn.disabled = true;
  validateBtn.addEventListener('click', () => {
    const selectedDates = state.chronoSelected.map(i => state.chronoEvents[i].date_iso);
    const sortedDates   = [...selectedDates].sort();
    const correct = JSON.stringify(selectedDates) === JSON.stringify(sortedDates);
    eventsDiv.querySelectorAll('.chrono-card').forEach(c => c.style.pointerEvents = 'none');
    validateBtn.disabled = true;
    undoBtn.disabled = true;
    setTimeout(() => onAnswer(correct, q), 400);
  });

  actions.appendChild(undoBtn);
  actions.appendChild(validateBtn);
  container.appendChild(actions);
}

function onChronoTap(idx, card, container) {
  if (state.chronoSelected.includes(idx)) return;
  state.chronoSelected.push(idx);
  const pos = state.chronoSelected.length;
  card.classList.add('selected');
  card.textContent = `${pos}. ${state.chronoEvents[idx].label}`;
  const eventsDiv = container.querySelector('#chrono-events');
  updateChronoUI(eventsDiv);
}

function updateChronoUI(eventsDiv) {
  const n = state.chronoSelected.length;
  const undoBtn     = el('btn-chrono-undo');
  const validateBtn = el('btn-chrono-validate');
  if (undoBtn)     undoBtn.disabled     = n === 0;
  if (validateBtn) validateBtn.disabled = n < 4;

  const slots = el('order-slots');
  if (slots) {
    slots.innerHTML = state.chronoSelected.map((idx, pos) => {
      const label = state.chronoEvents[idx].label;
      return `<span class="order-slot">${pos + 1}. ${label}</span>`;
    }).join('');
  }
}

function highlightAnswer(chosenBtn, correct, correctBtn) {
  chosenBtn.classList.add(correct ? 'correct' : 'wrong');
  if (!correct && correctBtn) correctBtn.classList.add('reveal');
}

// ── Answer handling ────────────────────────────────────────────────────────────

function onAnswer(isCorrect, q) {
  const pts = isCorrect ? (POINTS[q.difficulte] || 1) : 0;

  if (state.mode === 'ladder') {
    if (!isCorrect) {
      state.ladderLives = Math.max(0, state.ladderLives - 1);
    }
    showResult(isCorrect, pts, q);
    return;
  }

  if (state.mode === 'multi') {
    state.players[state.currentPlayerIdx].score += pts;
  } else {
    state.soloScore += pts;
  }

  showResult(isCorrect, pts, q);
}

function showResult(isCorrect, pts, q) {
  el('result-icon').textContent = isCorrect ? '✓' : '✗';
  el('result-icon').className   = `result-icon ${isCorrect ? 'correct' : 'wrong'}`;
  el('result-explication').textContent = q.explication || '';

  if (state.mode === 'ladder') {
    const nextRank = state.questionIdx + 1;
    if (isCorrect) {
      const milestone = nextRank === 10 || nextRank === 20;
      if (milestone) {
        el('result-pts').textContent = nextRank === 10 ? '🏅 Palier Inspecteur !' : '🏅 Palier Commissaire !';
      } else {
        el('result-pts').textContent = `Niveau ${nextRank}/30`;
      }
    } else {
      el('result-pts').textContent = state.ladderLives <= 0
        ? 'Plus de vies !'
        : `${state.ladderLives} vie${state.ladderLives !== 1 ? 's' : ''} restante${state.ladderLives !== 1 ? 's' : ''}`;
    }
    el('result-pts').className = `result-pts ${isCorrect ? 'correct' : 'wrong'}`;
    const lives = Math.max(0, state.ladderLives);
    el('result-player-score').textContent = '❤️'.repeat(lives) + '🖤'.repeat(3 - lives);
    setHidden('result-player-score', false);
    show('screen-result');
    return;
  }

  el('result-pts').textContent = isCorrect ? `+${pts} pt${pts > 1 ? 's' : ''}` : '0 point';
  el('result-pts').className   = `result-pts ${isCorrect ? 'correct' : 'wrong'}`;

  if (state.mode === 'multi') {
    const player = state.players[state.currentPlayerIdx];
    el('result-player-score').textContent = `${player.name} : ${player.score} pt${player.score !== 1 ? 's' : ''}`;
    setHidden('result-player-score', false);
  } else {
    setHidden('result-player-score', true);
  }

  show('screen-result');
}

// ── Continue ──────────────────────────────────────────────────────────────────

function onContinue() {
  if (state.mode === 'ladder') {
    if (state.ladderLives <= 0) {
      saveLadderBest(state.questionIdx);
      showLadderEnd(false);
      return;
    }
    state.questionIdx++;
    if (state.questionIdx >= state.questions.length) {
      saveLadderBest(30);
      showLadderEnd(true);
      return;
    }
    showNextQuestion();
    return;
  }

  state.questionIdx++;

  if (state.questionIdx >= state.questions.length) {
    showEnd();
    return;
  }

  if (state.mode === 'multi') {
    state.currentPlayerIdx = state.questionIdx % state.players.length;
    showPrivacy();
  } else {
    showNextQuestion();
  }
}

// ── Ladder end ────────────────────────────────────────────────────────────────

function showLadderEnd(victory) {
  const rank = victory ? 30 : state.questionIdx;
  const prev = getLadderBest();
  saveLadderBest(rank);
  const best = getLadderBest();

  setHidden('end-ladder', false);
  setHidden('end-solo', true);
  setHidden('end-multi', true);

  el('end-ladder-title').textContent = victory ? '🏆 Grand Détective !' : 'Partie terminée !';
  el('end-ladder-rank').textContent  = rank;

  if (rank > prev && prev > 0) {
    el('end-ladder-best').textContent = `🏅 Nouveau record ! (était ${prev}/30)`;
  } else if (rank === 30) {
    el('end-ladder-best').textContent = 'Tu as atteint le rang maximum !';
  } else if (best > 0) {
    el('end-ladder-best').textContent = `Record : ${best}/30`;
  } else {
    el('end-ladder-best').textContent = '';
  }

  updateLadderBestDisplay();
  show('screen-end');
}

// ── End screen ────────────────────────────────────────────────────────────────

function showEnd() {
  if (state.mode === 'solo') {
    setHidden('end-solo', false);
    setHidden('end-multi', true);
    el('end-score-value').textContent = state.soloScore;
    el('end-score-max').textContent   = state.soloMaxScore;
    const ratio = state.soloMaxScore > 0 ? state.soloScore / state.soloMaxScore : 0;
    const perf  = PERF_LABELS.find(p => ratio >= p.min) || PERF_LABELS[PERF_LABELS.length - 1];
    el('end-perf-label').textContent = perf.label;
  } else {
    setHidden('end-solo', true);
    setHidden('end-multi', false);
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    el('end-podium').innerHTML = sorted.map((p, i) => `
      <div class="podium-row ${i === 0 ? 'winner' : ''}">
        <span class="podium-rank">${i === 0 ? '🏆' : `${i + 1}.`}</span>
        <span class="podium-name">${p.name}</span>
        <span class="podium-score">${p.score} pt${p.score !== 1 ? 's' : ''}</span>
      </div>
    `).join('');
  }
  show('screen-end');
}

// ── Setup screens ─────────────────────────────────────────────────────────────

function buildModuleCheckboxes(containerId) {
  const container = el(containerId);
  if (!container) return;
  container.innerHTML = Object.entries(MODULE_LABELS).map(([key, label]) => `
    <label class="module-check">
      <input type="checkbox" value="${key}" checked>
      <span>${label}</span>
    </label>
  `).join('');
}

function getSelectedModules(containerId) {
  return [...el(containerId).querySelectorAll('input:checked')].map(i => i.value);
}

function buildPlayerInputs(count) {
  const section = el('player-names-section');
  section.innerHTML = Array.from({ length: count }, (_, i) => `
    <div class="player-input-row">
      <label for="player-name-${i}">Joueur ${i + 1}</label>
      <input id="player-name-${i}" type="text" class="player-name-input" placeholder="Prénom…" maxlength="20">
    </div>
  `).join('');
}

function getPlayerNames() {
  return [...document.querySelectorAll('.player-name-input')]
    .map((inp, i) => inp.value.trim() || `Joueur ${i + 1}`);
}

// ── Count button groups ───────────────────────────────────────────────────────

function makeCountGroup(groupId, defaultValue = null) {
  const group = el(groupId);
  if (!group) return;
  const btns = group.querySelectorAll('.count-btn');
  if (defaultValue !== null) {
    btns.forEach(b => b.classList.toggle('active', b.dataset.count == defaultValue));
  }
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function getActiveCount(groupId) {
  const active = el(groupId)?.querySelector('.count-btn.active');
  return active ? parseInt(active.dataset.count) : null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  el('loading-status').textContent = 'Chargement des questions…';
  allQuestions = await loadAllQuestions();
  el('loading-status').textContent =
    allQuestions.length
      ? `${allQuestions.length} question${allQuestions.length > 1 ? 's' : ''} disponible${allQuestions.length > 1 ? 's' : ''}`
      : 'Aucune question disponible';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Build module checkboxes
  buildModuleCheckboxes('solo-module-checks');
  buildModuleCheckboxes('multi-module-checks');

  // Count button groups
  makeCountGroup('solo-count-btns', 5);
  makeCountGroup('multi-rounds-btns', 5);
  makeCountGroup('multi-player-count-btns', 2);

  // Player count → rebuild name inputs
  let playerCount = 2;
  buildPlayerInputs(playerCount);
  el('multi-player-count-btns').addEventListener('click', e => {
    const btn = e.target.closest('.count-btn');
    if (!btn) return;
    playerCount = parseInt(btn.dataset.count);
    buildPlayerInputs(playerCount);
  });

  updateLadderBestDisplay();

  // ── Button bindings ───────────────────────────────────────────────────────

  el('btn-ladder').addEventListener('click', () => {
    updateLadderBestDisplay();
    show('screen-ladder-start');
  });

  el('btn-back-ladder').addEventListener('click', () => show('screen-home'));

  el('btn-ladder-start').addEventListener('click', () => startLadder());

  el('btn-solo').addEventListener('click', () => {
    show('screen-solo-setup');
  });

  el('btn-multi').addEventListener('click', () => {
    show('screen-multi-setup');
  });

  el('btn-back-solo').addEventListener('click', () => show('screen-home'));
  el('btn-back-multi').addEventListener('click', () => show('screen-home'));

  el('btn-solo-start').addEventListener('click', () => {
    const modules = getSelectedModules('solo-module-checks');
    const rounds  = getActiveCount('solo-count-btns') || 5;
    startSolo(modules, rounds);
  });

  el('btn-multi-start').addEventListener('click', () => {
    const names   = getPlayerNames();
    const rounds  = getActiveCount('multi-rounds-btns') || 5;
    const modules = getSelectedModules('multi-module-checks');
    startMulti(names, rounds, modules);
  });

  el('btn-privacy-continue').addEventListener('click', () => showNextQuestion());

  el('btn-result-continue').addEventListener('click', () => onContinue());

  el('btn-end-solo').addEventListener('click', () => {
    updateLadderBestDisplay();
    show('screen-ladder-start');
  });
  el('btn-end-home').addEventListener('click', () => show('screen-home'));

  el('btn-end-replay').addEventListener('click', () => {
    if (!state.lastSetup) { show('screen-home'); return; }
    const s = state.lastSetup;
    if (s.type === 'ladder') {
      startLadder();
    } else if (s.type === 'solo') {
      startSolo(s.modules, s.rounds);
    } else {
      startMulti(s.players, s.rounds, s.modules);
    }
  });

  show('screen-home');
}

document.addEventListener('DOMContentLoaded', init);
