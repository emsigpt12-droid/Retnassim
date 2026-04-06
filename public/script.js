/**
 * script.js — Frontend RetAnnot
 * Gère : sélection annotateur, navigation, annotation, zoom,
 *        raccourcis clavier, drawer mobile, tableau de bord,
 *        polling temps réel (file de travail partagée)
 */

'use strict';

// ─── État global ─────────────────────────────────────────────────────────────
const state = {
  annotateur:      null,   // nom de l'annotateur sélectionné
  images:          [],
  annotations:     {},     // { filename: grade } — annotations de CET annotateur
  allAnnotations:  {},     // { filename: grade } — toutes annotations tous annotateurs
  currentIdx:      0,
  zoomLevel:       1.0,
  isSaving:        false,
  pollingTimer:    null,   // référence au setInterval de polling
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const ZOOM_STEP      = 0.25;
const ZOOM_MIN       = 0.25;
const ZOOM_MAX       = 4.0;
const POLLING_MS     = 10000; // vérification toutes les 10 secondes

const CLASSES = [
  'No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR',
  'Impacts laser', 'Autre pathologie', 'Mauvaise qualité',
];
const CLASS_COUNT_IDS = [
  'count-0','count-1','count-2','count-3','count-4',
  'count-5','count-6','count-7',
];

const CLASS_COLORS = ['#22c55e','#eab308','#f97316','#ef4444','#a855f7','#06b6d4','#ec4899','#6b7280'];

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  welcomeScreen:        $('welcome-screen'),
  annotatorCards:       $('annotator-cards'),
  sidebar:              $('sidebar'),
  main:                 $('main'),
  currentAnnotatorName: $('current-annotator-name'),
  changeAnnotatorBtn:   $('change-annotator-btn'),
  mobAnnotatorName:     $('mob-annotator-name'),
  mobChangeAnnotatorBtn:$('mob-change-annotator-btn'),
  fundusImg:            $('fundus-img'),
  emptyState:           $('empty-state'),
  annotatedBadge:       $('annotated-badge'),
  badgeLabel:           $('badge-label'),
  imageName:            $('image-name'),
  imageCounter:         $('image-counter'),
  zoomIn:               $('zoom-in'),
  zoomOut:              $('zoom-out'),
  zoomReset:            $('zoom-reset'),
  zoomLevel:            $('zoom-level'),
  statAnnotated:        $('stat-annotated'),
  statTotal:            $('stat-total'),
  statRemaining:        $('stat-remaining'),
  progressBar:          $('progress-bar'),
  progressPct:          $('progress-pct'),
  btnPrev:              $('btn-prev'),
  btnNext:              $('btn-next'),
  jumpInput:            $('jump-input'),
  jumpBtn:              $('jump-btn'),
  skipAnnotated:        $('skip-annotated'),
  exportBtn:            $('export-btn'),
  dashboardBtn:         $('dashboard-btn'),
  deleteBtn:            $('delete-btn'),
  restoreBtn:           $('restore-btn'),
  resetBtn:             $('reset-btn'),
  resetModal:           $('reset-modal'),
  resetConfirm:         $('reset-confirm'),
  resetCancel:          $('reset-cancel'),
  loadingOverlay:       $('loading-overlay'),
  toastWrap:            $('toast-wrap'),
  gradeBtns:            document.querySelectorAll('.grade-btn, .extra-btn'),
  mobMenuBtn:           $('mob-menu-btn'),
  drawer:               $('drawer'),
  drawerOverlay:        $('drawer-overlay'),
  drawerClose:          $('drawer-close'),
  mobStatAnnotated:     $('mob-stat-annotated'),
  mobStatTotal:         $('mob-stat-total'),
  mobStatRemaining:     $('mob-stat-remaining'),
  mobProgressBar:       $('mob-progress-bar'),
  mobExportBtn:         $('mob-export-btn'),
  mobDashboardBtn:      $('mob-dashboard-btn'),
  mobDeleteBtn:         $('mob-delete-btn'),
  mobRestoreBtn:        $('mob-restore-btn'),
  mobResetBtn:          $('mob-reset-btn'),
  mobJumpInput:         $('mob-jump-input'),
  mobJumpBtn:           $('mob-jump-btn'),
  mobSkip:              $('mob-skip-annotated'),
  dashboardModal:       $('dashboard-modal'),
  dashboardClose:       $('dashboard-close'),
  dashboardLoading:     $('dashboard-loading'),
  dashboardTableWrap:   $('dashboard-table-wrap'),
  dashboardTable:       $('dashboard-table'),
};

// ═══════════════════════════════════════════════════════════
// ÉCRAN D'ACCUEIL
// ═══════════════════════════════════════════════════════════

async function loadWelcomeScreen() {
  try {
    const res  = await fetch('/api/annotators');
    const data = await res.json();
    renderAnnotatorCards(data.annotators || []);
  } catch (err) {
    showToast('Erreur chargement des annotateurs', 'error');
  }
}

function renderAnnotatorCards(annotators) {
  dom.annotatorCards.innerHTML = '';
  for (const name of annotators) {
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const card = document.createElement('button');
    card.className = 'annotator-card';
    card.innerHTML = `
      <div class="annotator-card-icon">${initials}</div>
      <span class="annotator-card-name">${name}</span>
    `;
    card.addEventListener('click', () => selectAnnotator(name));
    dom.annotatorCards.appendChild(card);
  }
}

async function selectAnnotator(name) {
  state.annotateur = name;
  dom.currentAnnotatorName.textContent = name;
  dom.mobAnnotatorName.textContent     = name;

  // Activer "Ignorer annotées" par défaut (file partagée)
  dom.skipAnnotated.checked = true;
  dom.mobSkip.checked       = true;

  dom.welcomeScreen.style.animation = 'fade-out 250ms ease forwards';
  setTimeout(() => {
    dom.welcomeScreen.classList.add('hidden');
    dom.sidebar.classList.remove('hidden');
    dom.main.classList.remove('hidden');
  }, 240);

  showLoading(true);
  try {
    await Promise.all([loadImages(), loadAllAnnotations()]);
    // annotations perso = sous-ensemble du total
    filterMyAnnotations();
    jumpToFirstUnannotated();
    renderAll();
  } catch (err) {
    showToast('Erreur au chargement : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }

  bindEvents();
  startPolling(); // ← démarrer le polling dès la connexion
}

function returnToWelcome() {
  stopPolling(); // ← arrêter le polling quand on quitte
  closeDrawer();
  state.annotateur     = null;
  state.annotations    = {};
  state.allAnnotations = {};
  state.currentIdx     = 0;

  dom.sidebar.classList.add('hidden');
  dom.main.classList.add('hidden');
  dom.welcomeScreen.classList.remove('hidden');
  dom.welcomeScreen.style.animation = 'fade-in 250ms ease forwards';
}

const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes fade-out { from { opacity:1; } to { opacity:0; } }';
document.head.appendChild(styleEl);

// ═══════════════════════════════════════════════════════════
// POLLING — FILE DE TRAVAIL PARTAGÉE EN TEMPS RÉEL
// ═══════════════════════════════════════════════════════════

/**
 * Démarre le polling toutes les POLLING_MS millisecondes.
 * À chaque tick, on récupère TOUTES les annotations (tous annotateurs).
 * Si l'image courante vient d'être annotée par quelqu'un d'autre,
 * on passe automatiquement à la prochaine image disponible.
 */
function startPolling() {
  stopPolling(); // éviter les doublons
  state.pollingTimer = setInterval(pollAnnotations, POLLING_MS);
  console.log(`[Polling] Démarré — vérification toutes les ${POLLING_MS / 1000}s`);
}

function stopPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
    console.log('[Polling] Arrêté');
  }
}

async function pollAnnotations() {
  if (!state.annotateur) return;
  try {
    const res  = await fetch('/api/annotations/all');
    if (!res.ok) return;
    const data = await res.json();
    const newAll = data.annotations || {};

    // Compter les nouvelles annotations faites par d'autres
    let newCount = 0;
    for (const [imgId, grade] of Object.entries(newAll)) {
      if (!state.allAnnotations[imgId]) {
        newAll[imgId] = grade;
        newCount++;
      }
    }

    if (newCount === 0) return; // rien de nouveau

    // Mettre à jour l'état global
    state.allAnnotations = newAll;
    filterMyAnnotations();

    console.log(`[Polling] ${newCount} nouvelle(s) annotation(s) détectée(s)`);

    // Vérifier si l'image courante est maintenant annotée par quelqu'un d'autre
    const currentImage = state.images[state.currentIdx];
    if (currentImage && state.allAnnotations[currentImage] && !state.annotations[currentImage]) {
      // Cette image vient d'être prise par un autre annotateur
      showToast('Image annotée par un autre annotateur — passage à la suivante', 'info');
      autoSkipToNext();
    }

    // Mettre à jour les stats
    renderStats();

  } catch (err) {
    console.warn('[Polling] Erreur :', err.message);
  }
}

/**
 * Passe automatiquement à la prochaine image non annotée par personne.
 */
function autoSkipToNext() {
  let idx = state.currentIdx + 1;
  while (idx < state.images.length && state.allAnnotations[state.images[idx]]) {
    idx++;
  }
  if (idx >= state.images.length) {
    showToast('Toutes les images ont été annotées ! 🎉', 'success');
    renderGradeButtons();
    renderBadge();
    return;
  }
  goTo(idx);
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

async function loadImages() {
  const res  = await fetch('/api/images');
  if (!res.ok) throw new Error('Impossible de charger la liste des images');
  const data = await res.json();
  state.images = data.images || [];
}

/**
 * Charge TOUTES les annotations (tous annotateurs confondus).
 * Utilisé au démarrage et lors du polling.
 */
async function loadAllAnnotations() {
  const res  = await fetch('/api/annotations/all');
  if (!res.ok) throw new Error('Impossible de charger les annotations');
  const data = await res.json();
  state.allAnnotations = data.annotations || {};
}

/**
 * Filtre les annotations de l'annotateur courant depuis le pool global.
 */
function filterMyAnnotations() {
  // On recharge depuis l'API pour avoir les annotations perso
  fetch(`/api/annotations?annotateur=${encodeURIComponent(state.annotateur)}`)
    .then(r => r.json())
    .then(data => {
      state.annotations = data.annotations || {};
    })
    .catch(() => {});
}

async function saveAnnotation(imageId, grade) {
  const res = await fetch('/api/annotations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      image_id:   imageId,
      annotation: grade,
      annotateur: state.annotateur,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erreur de sauvegarde');
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// DRAWER MOBILE
// ═══════════════════════════════════════════════════════════

function openDrawer() {
  dom.drawer.classList.remove('hidden');
  dom.drawerOverlay.classList.remove('hidden');
  requestAnimationFrame(() => dom.drawer.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  dom.drawer.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    dom.drawer.classList.add('hidden');
    dom.drawerOverlay.classList.add('hidden');
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════

function goTo(idx) {
  if (state.images.length === 0) return;
  state.currentIdx = Math.max(0, Math.min(idx, state.images.length - 1));
  renderImage();
  renderTopbar();
  renderGradeButtons();
  renderBadge();
}

function getSkip() {
  return dom.skipAnnotated.checked || dom.mobSkip.checked;
}

function goPrev() {
  let idx = state.currentIdx - 1;
  if (getSkip()) {
    // Ignorer les images déjà annotées par N'IMPORTE QUEL annotateur
    while (idx >= 0 && state.allAnnotations[state.images[idx]]) idx--;
    if (idx < 0) { showToast('Aucune image non annotée avant celle-ci'); return; }
  }
  if (idx < 0) return;
  goTo(idx);
}

function goNext() {
  let idx = state.currentIdx + 1;
  if (getSkip()) {
    // Ignorer les images déjà annotées par N'IMPORTE QUEL annotateur
    while (idx < state.images.length && state.allAnnotations[state.images[idx]]) idx++;
    if (idx >= state.images.length) { showToast('Toutes les images ont été annotées ! 🎉', 'success'); return; }
  }
  if (idx >= state.images.length) return;
  goTo(idx);
}

/**
 * Sauter à la première image non annotée par personne.
 */
function jumpToFirstUnannotated() {
  const idx = state.images.findIndex(name => !state.allAnnotations[name]);
  state.currentIdx = idx === -1 ? 0 : idx;
}

// ═══════════════════════════════════════════════════════════
// ANNOTATION
// ═══════════════════════════════════════════════════════════

async function annotate(grade) {
  if (state.images.length === 0 || state.isSaving) return;
  const imageId = state.images[state.currentIdx];

  // Vérifier si l'image a été entre-temps annotée par quelqu'un d'autre
  if (state.allAnnotations[imageId] && !state.annotations[imageId]) {
    showToast('Cette image a déjà été annotée par un autre annotateur !', 'error');
    autoSkipToNext();
    return;
  }

  // Mise à jour locale optimiste
  state.annotations[imageId]    = grade;
  state.allAnnotations[imageId] = grade; // mise à jour du pool global aussi
  renderGradeButtons();
  renderBadge();
  renderStats();

  const btn = document.querySelector(`[data-grade="${grade}"]`);
  if (btn) {
    btn.classList.add('flashing');
    setTimeout(() => btn.classList.remove('flashing'), 200);
  }

  state.isSaving = true;
  try {
    await saveAnnotation(imageId, grade);
    // Passage automatique à l'image suivante après sauvegarde
    setTimeout(() => {
      goNext();
      state.isSaving = false;
    }, 260);
  } catch (err) {
    showToast('Erreur sauvegarde : ' + err.message, 'error');
    state.isSaving = false;
  }
}

// ═══════════════════════════════════════════════════════════
// SUPPRIMER / RESTAURER
// ═══════════════════════════════════════════════════════════

async function deleteImage() {
  if (state.images.length === 0) return;
  const imageId = state.images[state.currentIdx];
  closeDrawer();
  try {
    const res = await fetch('/api/delete-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur');
    state.images.splice(state.currentIdx, 1);
    delete state.annotations[imageId];
    delete state.allAnnotations[imageId];
    if (state.currentIdx >= state.images.length) state.currentIdx = Math.max(0, state.images.length - 1);
    renderAll();
    showToast(`"${imageId}" déplacée vers images_floues/`, 'success');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}

async function restoreImages() {
  closeDrawer();
  try {
    const res  = await fetch('/api/restore-images', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur');
    const data  = await res.json();
    const count = data.restored || 0;
    if (count === 0) { showToast('Aucune image à restaurer', 'info'); return; }
    await loadImages();
    renderAll();
    showToast(`${count} image(s) restaurée(s)`, 'success');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// RESET ANNOTATIONS
// ═══════════════════════════════════════════════════════════

function openResetModal()  { closeDrawer(); dom.resetModal.classList.remove('hidden'); }
function closeResetModal() { dom.resetModal.classList.add('hidden'); }

async function confirmReset() {
  closeResetModal();
  showLoading(true);
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Échec reset');
    state.annotations    = {};
    state.allAnnotations = {};
    state.currentIdx     = 0;
    renderAll();
    showToast('Annotations réinitialisées', 'success');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
// TABLEAU DE BORD
// ═══════════════════════════════════════════════════════════

async function openDashboard() {
  closeDrawer();
  dom.dashboardModal.classList.remove('hidden');
  dom.dashboardLoading.classList.remove('hidden');
  dom.dashboardTableWrap.classList.add('hidden');

  try {
    const res  = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Erreur dashboard');
    const data = await res.json();
    renderDashboardTable(data);
  } catch (err) {
    showToast('Erreur tableau de bord : ' + err.message, 'error');
    dom.dashboardModal.classList.add('hidden');
  }
}

function closeDashboard() {
  dom.dashboardModal.classList.add('hidden');
}

function renderDashboardTable(data) {
  const { annotators, classes, stats, grandTotal } = data;
  const table = dom.dashboardTable;
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');
  const thName = document.createElement('th');
  thName.textContent = 'Annotateur';
  hRow.appendChild(thName);
  const thTotal = document.createElement('th');
  thTotal.textContent = 'Total';
  thTotal.className = 'num';
  hRow.appendChild(thTotal);
  classes.forEach((cls, i) => {
    const th = document.createElement('th');
    th.className = 'num';
    th.innerHTML = `<span class="th-dot" style="background:${CLASS_COLORS[i]}"></span>${cls}`;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const ann of annotators) {
    const s   = stats[ann] || { total: 0, classes: {} };
    const row = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'annotator-name';
    tdName.textContent = ann;
    row.appendChild(tdName);
    const tdTotal = document.createElement('td');
    tdTotal.className = 'total-num';
    tdTotal.textContent = s.total;
    row.appendChild(tdTotal);
    classes.forEach(cls => {
      const td = document.createElement('td');
      td.className = 'num';
      const count = s.classes[cls] || 0;
      td.textContent = count > 0 ? count : '—';
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const tfoot   = document.createElement('tfoot');
  const fRow    = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.className   = 'total-label';
  tdLabel.textContent = 'Total';
  fRow.appendChild(tdLabel);
  const tdGrand = document.createElement('td');
  tdGrand.className   = 'num';
  tdGrand.textContent = grandTotal.total;
  fRow.appendChild(tdGrand);
  classes.forEach(cls => {
    const td = document.createElement('td');
    td.className   = 'num';
    td.textContent = grandTotal.classes[cls] || 0;
    fRow.appendChild(td);
  });
  tfoot.appendChild(fRow);
  table.appendChild(tfoot);

  dom.dashboardLoading.classList.add('hidden');
  dom.dashboardTableWrap.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════
// ZOOM
// ═══════════════════════════════════════════════════════════

function setZoom(level) {
  state.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  dom.fundusImg.style.transform = `scale(${state.zoomLevel})`;
  dom.zoomLevel.textContent = Math.round(state.zoomLevel * 100) + '%';
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════

function renderAll() {
  renderImage();
  renderTopbar();
  renderGradeButtons();
  renderBadge();
  renderStats();
}

function renderImage() {
  if (state.images.length === 0) {
    dom.emptyState.classList.remove('hidden');
    dom.fundusImg.classList.add('hidden');
    return;
  }
  dom.emptyState.classList.add('hidden');
  dom.fundusImg.classList.remove('hidden');
  const name = state.images[state.currentIdx];
  dom.fundusImg.src = `/images/${encodeURIComponent(name)}`;
  dom.fundusImg.alt = name;
  setZoom(state.zoomLevel);
}

function renderTopbar() {
  if (state.images.length === 0) {
    dom.imageName.textContent    = '—';
    dom.imageCounter.textContent = '— / —';
    return;
  }
  dom.imageName.textContent    = state.images[state.currentIdx];
  dom.imageCounter.textContent = `${state.currentIdx + 1} / ${state.images.length}`;
  dom.btnPrev.disabled = state.currentIdx === 0;
  dom.btnNext.disabled = state.currentIdx === state.images.length - 1;
}

function renderGradeButtons() {
  const current  = state.images[state.currentIdx];
  const existing = current ? state.annotations[current] : null;
  dom.gradeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.grade === existing);
  });
}

function renderBadge() {
  const current    = state.images[state.currentIdx];
  const annotation = current ? state.annotations[current] : null;
  if (annotation) {
    dom.annotatedBadge.classList.remove('hidden');
    dom.badgeLabel.textContent = annotation;
  } else {
    dom.annotatedBadge.classList.add('hidden');
  }
}

function renderStats() {
  const total     = state.images.length;
  // Stats basées sur TOUTES les annotations (tous annotateurs)
  const annotated = Object.keys(state.allAnnotations).length;
  const remaining = total - annotated;
  const pct       = total > 0 ? Math.round((annotated / total) * 100) : 0;

  if (dom.statAnnotated) dom.statAnnotated.textContent = annotated.toLocaleString('fr');
  if (dom.statTotal)     dom.statTotal.textContent     = total.toLocaleString('fr');
  if (dom.statRemaining) dom.statRemaining.textContent = remaining.toLocaleString('fr');
  if (dom.progressBar)   dom.progressBar.style.width   = pct + '%';
  if (dom.progressPct)   dom.progressPct.textContent   = pct + '%';

  if (dom.mobStatAnnotated) dom.mobStatAnnotated.textContent = annotated.toLocaleString('fr');
  if (dom.mobStatTotal)     dom.mobStatTotal.textContent     = total.toLocaleString('fr');
  if (dom.mobStatRemaining) dom.mobStatRemaining.textContent = remaining.toLocaleString('fr');
  if (dom.mobProgressBar)   dom.mobProgressBar.style.width   = pct + '%';

  const mobFill  = $('mob-fill');
  const mobPct   = $('mob-pct');
  const mobCount = $('mob-count');
  if (mobFill)  mobFill.style.width  = pct + '%';
  if (mobPct)   mobPct.textContent   = pct + '%';
  if (mobCount) mobCount.textContent = `${annotated} / ${total}`;

  const counts = {};
  CLASSES.forEach(c => counts[c] = 0);
  Object.values(state.allAnnotations).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
  const maxCount = Math.max(...Object.values(counts), 1);

  CLASSES.forEach((cls, i) => {
    const pctBar = counts[cls] / maxCount * 100;
    const countEl = $(CLASS_COUNT_IDS[i]);
    if (countEl) countEl.textContent = counts[cls];
    const fill = document.querySelector(`.class-bar-fill.grade-${i}`);
    if (fill) fill.style.width = pctBar + '%';
    const mobCountEl = $(`mob-count-${i}`);
    if (mobCountEl) mobCountEl.textContent = counts[cls];
    const mobFillEl = $(`mob-grade-${i}`);
    if (mobFillEl) mobFillEl.style.width = pctBar + '%';
  });
}

// ═══════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════

let eventsBound = false;

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  dom.gradeBtns.forEach(btn => btn.addEventListener('click', () => annotate(btn.dataset.grade)));
  dom.btnPrev.addEventListener('click', goPrev);
  dom.btnNext.addEventListener('click', goNext);
  dom.jumpBtn.addEventListener('click', handleJump);
  dom.jumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleJump(); });
  dom.mobJumpBtn.addEventListener('click', handleMobJump);
  dom.mobJumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleMobJump(); });

  dom.zoomIn.addEventListener('click',    () => setZoom(state.zoomLevel + ZOOM_STEP));
  dom.zoomOut.addEventListener('click',   () => setZoom(state.zoomLevel - ZOOM_STEP));
  dom.zoomReset.addEventListener('click', () => setZoom(1.0));
  $('viewer-wrap').addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(state.zoomLevel + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
  }, { passive: false });

  dom.exportBtn.addEventListener('click',    () => { window.location.href = '/api/export'; });
  dom.dashboardBtn.addEventListener('click', openDashboard);
  dom.deleteBtn.addEventListener('click',    deleteImage);
  dom.restoreBtn.addEventListener('click',   restoreImages);
  dom.resetBtn.addEventListener('click',     openResetModal);

  dom.mobExportBtn.addEventListener('click',    () => { closeDrawer(); window.location.href = '/api/export'; });
  dom.mobDashboardBtn.addEventListener('click', openDashboard);
  dom.mobDeleteBtn.addEventListener('click',    deleteImage);
  dom.mobRestoreBtn.addEventListener('click',   restoreImages);
  dom.mobResetBtn.addEventListener('click',     openResetModal);

  dom.changeAnnotatorBtn.addEventListener('click',    returnToWelcome);
  dom.mobChangeAnnotatorBtn.addEventListener('click', returnToWelcome);

  dom.mobMenuBtn.addEventListener('click',    openDrawer);
  dom.drawerClose.addEventListener('click',   closeDrawer);
  dom.drawerOverlay.addEventListener('click', closeDrawer);

  dom.resetCancel.addEventListener('click',  closeResetModal);
  dom.resetConfirm.addEventListener('click', confirmReset);
  dom.resetModal.addEventListener('click', e => { if (e.target === dom.resetModal) closeResetModal(); });

  dom.dashboardClose.addEventListener('click', closeDashboard);
  dom.dashboardModal.addEventListener('click', e => { if (e.target === dom.dashboardModal) closeDashboard(); });

  document.addEventListener('keydown', handleKeydown);
}

function handleJump() {
  const val = parseInt(dom.jumpInput.value, 10);
  if (!isNaN(val) && val >= 1 && val <= state.images.length) {
    goTo(val - 1); dom.jumpInput.value = '';
  } else { showToast('Numéro invalide', 'error'); }
}

function handleMobJump() {
  const val = parseInt(dom.mobJumpInput.value, 10);
  if (!isNaN(val) && val >= 1 && val <= state.images.length) {
    goTo(val - 1); dom.mobJumpInput.value = ''; closeDrawer();
  } else { showToast('Numéro invalide', 'error'); }
}

function handleKeydown(e) {
  if (e.target.tagName === 'INPUT') return;
  if (!dom.resetModal.classList.contains('hidden')) return;
  if (!dom.dashboardModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeDashboard();
    return;
  }
  switch (e.key) {
    case '1': annotate('No DR');            break;
    case '2': annotate('Mild');             break;
    case '3': annotate('Moderate');         break;
    case '4': annotate('Severe');           break;
    case '5': annotate('Proliferative DR'); break;
    case '6': annotate('Impacts laser');    break;
    case '7': annotate('Autre pathologie'); break;
    case '8': annotate('Mauvaise qualité'); break;
    case 'ArrowLeft':  e.preventDefault(); goPrev(); break;
    case 'ArrowRight': e.preventDefault(); goNext(); break;
    case '+': case '=': setZoom(state.zoomLevel + ZOOM_STEP); break;
    case '-': setZoom(state.zoomLevel - ZOOM_STEP); break;
    case '0': setZoom(1.0); break;
    case 'Escape': closeResetModal(); break;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 2800) {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = message;
  dom.toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out 250ms ease forwards';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function showLoading(visible) {
  dom.loadingOverlay.classList.toggle('hidden', !visible);
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadWelcomeScreen);