/**
 * script.js — Frontend RetAnnot
 * Gère : sélection annotateur, navigation, annotation, zoom,
 *        raccourcis clavier, drawer mobile, tableau de bord
 */

'use strict';

// ─── État global ─────────────────────────────────────────────────────────────
const state = {
  annotateur:  null,   // nom de l'annotateur sélectionné
  images:      [],
  annotations: {},     // { filename: grade } pour l'annotateur courant
  currentIdx:  0,
  zoomLevel:   1.0,
  isSaving:    false,
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 4.0;

const CLASSES = [
  'No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR',
  'Impacts laser', 'Autre pathologie', 'Mauvaise qualité',
];
const CLASS_COUNT_IDS = [
  'count-0','count-1','count-2','count-3','count-4',
  'count-5','count-6','count-7',
];

// Couleurs pour le tableau de bord
const CLASS_COLORS = ['#22c55e','#eab308','#f97316','#ef4444','#a855f7','#06b6d4','#ec4899','#6b7280'];

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  // Écran accueil
  welcomeScreen:    $('welcome-screen'),
  annotatorCards:   $('annotator-cards'),

  // App principale
  sidebar:          $('sidebar'),
  main:             $('main'),

  // Badge annotateur
  currentAnnotatorName: $('current-annotator-name'),
  changeAnnotatorBtn:   $('change-annotator-btn'),
  mobAnnotatorName:     $('mob-annotator-name'),
  mobChangeAnnotatorBtn:$('mob-change-annotator-btn'),

  // Viewer
  fundusImg:        $('fundus-img'),
  emptyState:       $('empty-state'),
  annotatedBadge:   $('annotated-badge'),
  badgeLabel:       $('badge-label'),

  // Topbar
  imageName:        $('image-name'),
  imageCounter:     $('image-counter'),
  zoomIn:           $('zoom-in'),
  zoomOut:          $('zoom-out'),
  zoomReset:        $('zoom-reset'),
  zoomLevel:        $('zoom-level'),

  // Stats
  statAnnotated:    $('stat-annotated'),
  statTotal:        $('stat-total'),
  statRemaining:    $('stat-remaining'),
  progressBar:      $('progress-bar'),
  progressPct:      $('progress-pct'),

  // Navigation
  btnPrev:          $('btn-prev'),
  btnNext:          $('btn-next'),
  jumpInput:        $('jump-input'),
  jumpBtn:          $('jump-btn'),
  skipAnnotated:    $('skip-annotated'),

  // Boutons sidebar
  exportBtn:        $('export-btn'),
  dashboardBtn:     $('dashboard-btn'),
  deleteBtn:        $('delete-btn'),
  restoreBtn:       $('restore-btn'),
  resetBtn:         $('reset-btn'),

  // Modal reset
  resetModal:       $('reset-modal'),
  resetConfirm:     $('reset-confirm'),
  resetCancel:      $('reset-cancel'),

  // Loading
  loadingOverlay:   $('loading-overlay'),
  toastWrap:        $('toast-wrap'),

  // Boutons annotation
  gradeBtns:        document.querySelectorAll('.grade-btn, .extra-btn'),

  // Mobile
  mobMenuBtn:       $('mob-menu-btn'),
  drawer:           $('drawer'),
  drawerOverlay:    $('drawer-overlay'),
  drawerClose:      $('drawer-close'),
  mobStatAnnotated: $('mob-stat-annotated'),
  mobStatTotal:     $('mob-stat-total'),
  mobStatRemaining: $('mob-stat-remaining'),
  mobProgressBar:   $('mob-progress-bar'),
  mobExportBtn:     $('mob-export-btn'),
  mobDashboardBtn:  $('mob-dashboard-btn'),
  mobDeleteBtn:     $('mob-delete-btn'),
  mobRestoreBtn:    $('mob-restore-btn'),
  mobResetBtn:      $('mob-reset-btn'),
  mobJumpInput:     $('mob-jump-input'),
  mobJumpBtn:       $('mob-jump-btn'),
  mobSkip:          $('mob-skip-annotated'),

  // Dashboard
  dashboardModal:   $('dashboard-modal'),
  dashboardClose:   $('dashboard-close'),
  dashboardLoading: $('dashboard-loading'),
  dashboardTableWrap: $('dashboard-table-wrap'),
  dashboardTable:   $('dashboard-table'),
};

// ═══════════════════════════════════════════════════════════
// ÉCRAN D'ACCUEIL — Sélection annotateur
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

  // Mettre à jour les badges
  dom.currentAnnotatorName.textContent = name;
  dom.mobAnnotatorName.textContent     = name;

  // Masquer l'écran d'accueil, afficher l'app
  dom.welcomeScreen.style.animation = 'fade-out 250ms ease forwards';
  setTimeout(() => {
    dom.welcomeScreen.classList.add('hidden');
    dom.sidebar.classList.remove('hidden');
    dom.main.classList.remove('hidden');
  }, 240);

  // Charger les données
  showLoading(true);
  try {
    await Promise.all([loadImages(), loadAnnotations()]);
    jumpToFirstUnannotated();
    renderAll();
  } catch (err) {
    showToast('Erreur au chargement : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }

  bindEvents();
}

function returnToWelcome() {
  closeDrawer();
  state.annotateur  = null;
  state.annotations = {};
  state.currentIdx  = 0;

  dom.sidebar.classList.add('hidden');
  dom.main.classList.add('hidden');
  dom.welcomeScreen.classList.remove('hidden');
  dom.welcomeScreen.style.animation = 'fade-in 250ms ease forwards';
}

// ─── Style fade-out dynamique ─────────────────────────────────────────────────
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes fade-out { from { opacity:1; } to { opacity:0; } }';
document.head.appendChild(styleEl);

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

async function loadImages() {
  const res  = await fetch('/api/images');
  if (!res.ok) throw new Error('Impossible de charger la liste des images');
  const data = await res.json();
  state.images = data.images || [];
}

async function loadAnnotations() {
  const res  = await fetch(`/api/annotations?annotateur=${encodeURIComponent(state.annotateur)}`);
  if (!res.ok) throw new Error('Impossible de charger les annotations');
  const data = await res.json();
  state.annotations = data.annotations || {};
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
    while (idx >= 0 && state.annotations[state.images[idx]]) idx--;
    if (idx < 0) { showToast('Aucune image non annotée avant celle-ci'); return; }
  }
  if (idx < 0) return;
  goTo(idx);
}

function goNext() {
  let idx = state.currentIdx + 1;
  if (getSkip()) {
    while (idx < state.images.length && state.annotations[state.images[idx]]) idx++;
    if (idx >= state.images.length) { showToast('Toutes les images ont été annotées ! 🎉', 'success'); return; }
  }
  if (idx >= state.images.length) return;
  goTo(idx);
}

function jumpToFirstUnannotated() {
  const idx = state.images.findIndex(name => !state.annotations[name]);
  state.currentIdx = idx === -1 ? 0 : idx;
}

// ═══════════════════════════════════════════════════════════
// ANNOTATION
// ═══════════════════════════════════════════════════════════

async function annotate(grade) {
  if (state.images.length === 0 || state.isSaving) return;
  const imageId = state.images[state.currentIdx];

  state.annotations[imageId] = grade;
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
  } catch (err) {
    showToast('Erreur sauvegarde : ' + err.message, 'error');
  } finally {
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

function openResetModal() { closeDrawer(); dom.resetModal.classList.remove('hidden'); }
function closeResetModal() { dom.resetModal.classList.add('hidden'); }

async function confirmReset() {
  closeResetModal();
  showLoading(true);
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Échec reset');
    state.annotations = {};
    state.currentIdx  = 0;
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

  // ── En-tête ──────────────────────────────────────────────
  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');

  // Colonne Annotateur
  const thName = document.createElement('th');
  thName.textContent = 'Annotateur';
  hRow.appendChild(thName);

  // Colonne Total
  const thTotal = document.createElement('th');
  thTotal.textContent = 'Total';
  thTotal.className = 'num';
  hRow.appendChild(thTotal);

  // Une colonne par classe
  classes.forEach((cls, i) => {
    const th = document.createElement('th');
    th.className = 'num';
    th.innerHTML = `<span class="th-dot" style="background:${CLASS_COLORS[i]}"></span>${cls}`;
    hRow.appendChild(th);
  });

  thead.appendChild(hRow);
  table.appendChild(thead);

  // ── Corps ────────────────────────────────────────────────
  const tbody = document.createElement('tbody');

  for (const ann of annotators) {
    const s   = stats[ann] || { total: 0, classes: {} };
    const row = document.createElement('tr');

    // Nom
    const tdName = document.createElement('td');
    tdName.className = 'annotator-name';
    tdName.textContent = ann;
    row.appendChild(tdName);

    // Total
    const tdTotal = document.createElement('td');
    tdTotal.className = 'total-num';
    tdTotal.textContent = s.total;
    row.appendChild(tdTotal);

    // Comptes par classe
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

  // ── Pied — ligne Total ────────────────────────────────────
  const tfoot = document.createElement('tfoot');
  const fRow  = document.createElement('tr');

  const tdLabel = document.createElement('td');
  tdLabel.className = 'total-label';
  tdLabel.textContent = 'Total';
  fRow.appendChild(tdLabel);

  const tdGrandTotal = document.createElement('td');
  tdGrandTotal.className = 'num';
  tdGrandTotal.textContent = grandTotal.total;
  fRow.appendChild(tdGrandTotal);

  classes.forEach(cls => {
    const td = document.createElement('td');
    td.className = 'num';
    td.textContent = grandTotal.classes[cls] || 0;
    fRow.appendChild(td);
  });

  tfoot.appendChild(fRow);
  table.appendChild(tfoot);

  // Afficher
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
  const annotated = Object.keys(state.annotations).length;
  const remaining = total - annotated;
  const pct       = total > 0 ? Math.round((annotated / total) * 100) : 0;

  // Desktop
  if (dom.statAnnotated) dom.statAnnotated.textContent = annotated.toLocaleString('fr');
  if (dom.statTotal)     dom.statTotal.textContent     = total.toLocaleString('fr');
  if (dom.statRemaining) dom.statRemaining.textContent = remaining.toLocaleString('fr');
  if (dom.progressBar)   dom.progressBar.style.width   = pct + '%';
  if (dom.progressPct)   dom.progressPct.textContent   = pct + '%';

  // Mobile drawer
  if (dom.mobStatAnnotated) dom.mobStatAnnotated.textContent = annotated.toLocaleString('fr');
  if (dom.mobStatTotal)     dom.mobStatTotal.textContent     = total.toLocaleString('fr');
  if (dom.mobStatRemaining) dom.mobStatRemaining.textContent = remaining.toLocaleString('fr');
  if (dom.mobProgressBar)   dom.mobProgressBar.style.width   = pct + '%';

  // Barre mobile
  const mobFill  = $('mob-fill');
  const mobPct   = $('mob-pct');
  const mobCount = $('mob-count');
  if (mobFill)  mobFill.style.width  = pct + '%';
  if (mobPct)   mobPct.textContent   = pct + '%';
  if (mobCount) mobCount.textContent = `${annotated} / ${total}`;

  // Distribution 8 classes
  const counts = {};
  CLASSES.forEach(c => counts[c] = 0);
  Object.values(state.annotations).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
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
  if (eventsBound) return; // éviter double-bind si l'utilisateur change d'annotateur
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

  // Boutons desktop
  dom.exportBtn.addEventListener('click',    () => { window.location.href = '/api/export'; });
  dom.dashboardBtn.addEventListener('click', openDashboard);
  dom.deleteBtn.addEventListener('click',    deleteImage);
  dom.restoreBtn.addEventListener('click',   restoreImages);
  dom.resetBtn.addEventListener('click',     openResetModal);

  // Boutons mobile
  dom.mobExportBtn.addEventListener('click',    () => { closeDrawer(); window.location.href = '/api/export'; });
  dom.mobDashboardBtn.addEventListener('click', openDashboard);
  dom.mobDeleteBtn.addEventListener('click',    deleteImage);
  dom.mobRestoreBtn.addEventListener('click',   restoreImages);
  dom.mobResetBtn.addEventListener('click',     openResetModal);

  // Changer annotateur
  dom.changeAnnotatorBtn.addEventListener('click',    returnToWelcome);
  dom.mobChangeAnnotatorBtn.addEventListener('click', returnToWelcome);

  // Drawer
  dom.mobMenuBtn.addEventListener('click',    openDrawer);
  dom.drawerClose.addEventListener('click',   closeDrawer);
  dom.drawerOverlay.addEventListener('click', closeDrawer);

  // Reset modal
  dom.resetCancel.addEventListener('click',  closeResetModal);
  dom.resetConfirm.addEventListener('click', confirmReset);
  dom.resetModal.addEventListener('click', e => { if (e.target === dom.resetModal) closeResetModal(); });

  // Dashboard modal
  dom.dashboardClose.addEventListener('click', closeDashboard);
  dom.dashboardModal.addEventListener('click', e => { if (e.target === dom.dashboardModal) closeDashboard(); });

  // Raccourcis clavier
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