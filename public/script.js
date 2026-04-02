/**
 * script.js — Frontend RetAnnot
 * Gère : navigation, annotation, zoom, raccourcis, drawer mobile
 */

'use strict';

// ─── État global ─────────────────────────────────────────────────────────────
const state = {
  images:      [],
  annotations: {},
  currentIdx:  0,
  zoomLevel:   1.0,
  isSaving:    false,
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 4.0;
const CLASSES   = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR'];
const CLASS_COUNT_IDS = ['count-0', 'count-1', 'count-2', 'count-3', 'count-4'];

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  // Viewer
  fundusImg:      $('fundus-img'),
  emptyState:     $('empty-state'),
  annotatedBadge: $('annotated-badge'),
  badgeLabel:     $('badge-label'),

  // Topbar
  imageName:      $('image-name'),
  imageCounter:   $('image-counter'),
  zoomIn:         $('zoom-in'),
  zoomOut:        $('zoom-out'),
  zoomReset:      $('zoom-reset'),
  zoomLevel:      $('zoom-level'),

  // Stats desktop
  statAnnotated:  $('stat-annotated'),
  statTotal:      $('stat-total'),
  statRemaining:  $('stat-remaining'),
  progressBar:    $('progress-bar'),
  progressPct:    $('progress-pct'),

  // Navigation desktop
  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  jumpInput:      $('jump-input'),
  jumpBtn:        $('jump-btn'),
  skipAnnotated:  $('skip-annotated'),

  // Boutons desktop sidebar
  exportBtn:      $('export-btn'),
  deleteBtn:      $('delete-btn'),
  restoreBtn:     $('restore-btn'),
  resetBtn:       $('reset-btn'),

  // Modal reset
  resetModal:     $('reset-modal'),
  resetConfirm:   $('reset-confirm'),
  resetCancel:    $('reset-cancel'),

  // Misc
  loadingOverlay: $('loading-overlay'),
  toastWrap:      $('toast-wrap'),

  // Grade buttons
  gradeBtns:      document.querySelectorAll('.grade-btn'),

  // ── MOBILE ──
  mobMenuBtn:     $('mob-menu-btn'),
  drawer:         $('drawer'),
  drawerOverlay:  $('drawer-overlay'),
  drawerClose:    $('drawer-close'),

  // Stats dans le drawer
  mobStatAnnotated:  $('mob-stat-annotated'),
  mobStatTotal:      $('mob-stat-total'),
  mobStatRemaining:  $('mob-stat-remaining'),
  mobProgressBar:    $('mob-progress-bar'),

  // Boutons drawer mobile
  mobExportBtn:   $('mob-export-btn'),
  mobDeleteBtn:   $('mob-delete-btn'),
  mobRestoreBtn:  $('mob-restore-btn'),
  mobResetBtn:    $('mob-reset-btn'),

  // Jump drawer
  mobJumpInput:   $('mob-jump-input'),
  mobJumpBtn:     $('mob-jump-btn'),
  mobSkip:        $('mob-skip-annotated'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadImages(), loadAnnotations()]);
    jumpToFirstUnannotated();
    renderAll();
  } catch (err) {
    console.error('[Init] Erreur :', err);
    showToast('Erreur au chargement : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
  bindEvents();
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadImages() {
  const res  = await fetch('/api/images');
  if (!res.ok) throw new Error('Impossible de charger la liste des images');
  const data = await res.json();
  state.images = data.images || [];
}

async function loadAnnotations() {
  const res  = await fetch('/api/annotations');
  if (!res.ok) throw new Error('Impossible de charger les annotations');
  const data = await res.json();
  state.annotations = data.annotations || {};
}

async function saveAnnotation(imageId, grade) {
  const res = await fetch('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, annotation: grade }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erreur de sauvegarde');
  }
  return res.json();
}

// ─── Drawer mobile ────────────────────────────────────────────────────────────

function openDrawer() {
  dom.drawer.classList.remove('hidden');
  dom.drawerOverlay.classList.remove('hidden');
  // Forcer le reflow avant d'ajouter la classe open (animation)
  requestAnimationFrame(() => {
    dom.drawer.classList.add('open');
  });
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

// ─── Navigation ───────────────────────────────────────────────────────────────

function goTo(idx) {
  if (state.images.length === 0) return;
  state.currentIdx = Math.max(0, Math.min(idx, state.images.length - 1));
  renderImage();
  renderTopbar();
  renderGradeButtons();
  renderBadge();
}

function getSkip() {
  // Lire depuis desktop ou mobile selon lequel est visible
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

// ─── Annotation ───────────────────────────────────────────────────────────────

async function annotate(grade) {
  if (state.images.length === 0 || state.isSaving) return;
  const imageId = state.images[state.currentIdx];

  state.annotations[imageId] = grade;
  renderGradeButtons();
  renderBadge();
  renderStats();

  const btn = document.querySelector(`.grade-btn[data-grade="${grade}"]`);
  if (btn) {
    btn.classList.add('flashing');
    setTimeout(() => btn.classList.remove('flashing'), 200);
  }

  state.isSaving = true;
  try {
    await saveAnnotation(imageId, grade);
  } catch (err) {
    console.error('[Annotate] Erreur :', err);
    showToast('Erreur sauvegarde : ' + err.message, 'error');
  } finally {
    state.isSaving = false;
  }
}

// ─── Supprimer image floue ────────────────────────────────────────────────────

async function deleteImage() {
  if (state.images.length === 0) return;
  const imageId = state.images[state.currentIdx];
  closeDrawer();

  try {
    const res = await fetch('/api/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur suppression');
    }
    state.images.splice(state.currentIdx, 1);
    delete state.annotations[imageId];
    if (state.currentIdx >= state.images.length) {
      state.currentIdx = Math.max(0, state.images.length - 1);
    }
    renderAll();
    showToast(`"${imageId}" déplacée vers images_floues/`, 'success');
  } catch (err) {
    console.error('[Delete] Erreur :', err);
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ─── Restaurer images floues ──────────────────────────────────────────────────

async function restoreImages() {
  closeDrawer();
  try {
    const res = await fetch('/api/restore-images', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur restauration');
    }
    const data  = await res.json();
    const count = data.restored || 0;
    if (count === 0) { showToast('Aucune image à restaurer', 'info'); return; }
    await loadImages();
    renderAll();
    showToast(`${count} image(s) restaurée(s) dans images/`, 'success');
  } catch (err) {
    console.error('[Restore] Erreur :', err);
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ─── Reset annotations ────────────────────────────────────────────────────────

function openResetModal() {
  closeDrawer();
  dom.resetModal.classList.remove('hidden');
}

function closeResetModal() {
  dom.resetModal.classList.add('hidden');
}

async function confirmReset() {
  closeResetModal();
  showLoading(true);
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Échec de la réinitialisation serveur');
    state.annotations = {};
    state.currentIdx  = 0;
    state.isSaving    = false;
    renderAll();
    showToast('Toutes les annotations ont été supprimées', 'success');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

function setZoom(level) {
  state.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  dom.fundusImg.style.transform = `scale(${state.zoomLevel})`;
  dom.zoomLevel.textContent = Math.round(state.zoomLevel * 100) + '%';
}

// ─── Render ───────────────────────────────────────────────────────────────────

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

  // Desktop sidebar
  if (dom.statAnnotated)  dom.statAnnotated.textContent  = annotated.toLocaleString('fr');
  if (dom.statTotal)      dom.statTotal.textContent      = total.toLocaleString('fr');
  if (dom.statRemaining)  dom.statRemaining.textContent  = remaining.toLocaleString('fr');
  if (dom.progressBar)    dom.progressBar.style.width    = pct + '%';
  if (dom.progressPct)    dom.progressPct.textContent    = pct + '%';

  // Mobile drawer stats
  if (dom.mobStatAnnotated) dom.mobStatAnnotated.textContent = annotated.toLocaleString('fr');
  if (dom.mobStatTotal)     dom.mobStatTotal.textContent     = total.toLocaleString('fr');
  if (dom.mobStatRemaining) dom.mobStatRemaining.textContent = remaining.toLocaleString('fr');
  if (dom.mobProgressBar)   dom.mobProgressBar.style.width   = pct + '%';

  // Barre progression mobile
  const mobFill  = $('mob-fill');
  const mobPct   = $('mob-pct');
  const mobCount = $('mob-count');
  if (mobFill)  mobFill.style.width  = pct + '%';
  if (mobPct)   mobPct.textContent   = pct + '%';
  if (mobCount) mobCount.textContent = `${annotated} / ${total}`;

  // Distribution par classe
  const counts = {};
  CLASSES.forEach(c => counts[c] = 0);
  Object.values(state.annotations).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
  const maxCount = Math.max(...Object.values(counts), 1);

  CLASSES.forEach((cls, i) => {
    // Desktop
    const countEl = $(CLASS_COUNT_IDS[i]);
    if (countEl) countEl.textContent = counts[cls];
    const fill = document.querySelector(`.class-bar-fill.grade-${i}`);
    if (fill) fill.style.width = (counts[cls] / maxCount * 100) + '%';

    // Mobile drawer
    const mobCountEl = $(`mob-count-${i}`);
    if (mobCountEl) mobCountEl.textContent = counts[cls];
    const mobFillEl = $(`mob-grade-${i}`);
    if (mobFillEl) mobFillEl.style.width = (counts[cls] / maxCount * 100) + '%';
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Grade buttons
  dom.gradeBtns.forEach(btn => {
    btn.addEventListener('click', () => annotate(btn.dataset.grade));
  });

  // Navigation
  dom.btnPrev.addEventListener('click', goPrev);
  dom.btnNext.addEventListener('click', goNext);

  // Jump desktop
  dom.jumpBtn.addEventListener('click', handleJump);
  dom.jumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleJump(); });

  // Jump mobile drawer
  dom.mobJumpBtn.addEventListener('click', handleMobJump);
  dom.mobJumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleMobJump(); });

  // Zoom
  dom.zoomIn.addEventListener('click',    () => setZoom(state.zoomLevel + ZOOM_STEP));
  dom.zoomOut.addEventListener('click',   () => setZoom(state.zoomLevel - ZOOM_STEP));
  dom.zoomReset.addEventListener('click', () => setZoom(1.0));
  $('viewer-wrap').addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(state.zoomLevel + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
  }, { passive: false });

  // Boutons desktop
  dom.exportBtn.addEventListener('click',  () => { window.location.href = '/api/export'; });
  dom.deleteBtn.addEventListener('click',  deleteImage);
  dom.restoreBtn.addEventListener('click', restoreImages);
  dom.resetBtn.addEventListener('click',   openResetModal);

  // Boutons drawer mobile
  dom.mobExportBtn.addEventListener('click',  () => { closeDrawer(); window.location.href = '/api/export'; });
  dom.mobDeleteBtn.addEventListener('click',  deleteImage);
  dom.mobRestoreBtn.addEventListener('click', restoreImages);
  dom.mobResetBtn.addEventListener('click',   openResetModal);

  // Drawer
  dom.mobMenuBtn.addEventListener('click',    openDrawer);
  dom.drawerClose.addEventListener('click',   closeDrawer);
  dom.drawerOverlay.addEventListener('click', closeDrawer);

  // Modal reset
  dom.resetCancel.addEventListener('click',  closeResetModal);
  dom.resetConfirm.addEventListener('click', confirmReset);
  dom.resetModal.addEventListener('click', e => {
    if (e.target === dom.resetModal) closeResetModal();
  });

  // Raccourcis clavier
  document.addEventListener('keydown', handleKeydown);
}

function handleJump() {
  const val = parseInt(dom.jumpInput.value, 10);
  if (!isNaN(val) && val >= 1 && val <= state.images.length) {
    goTo(val - 1);
    dom.jumpInput.value = '';
  } else {
    showToast('Numéro invalide', 'error');
  }
}

function handleMobJump() {
  const val = parseInt(dom.mobJumpInput.value, 10);
  if (!isNaN(val) && val >= 1 && val <= state.images.length) {
    goTo(val - 1);
    dom.mobJumpInput.value = '';
    closeDrawer();
  } else {
    showToast('Numéro invalide', 'error');
  }
}

function handleKeydown(e) {
  if (e.target.tagName === 'INPUT') return;
  if (!dom.resetModal.classList.contains('hidden')) return;

  switch (e.key) {
    case '1': annotate('No DR');            break;
    case '2': annotate('Mild');             break;
    case '3': annotate('Moderate');         break;
    case '4': annotate('Severe');           break;
    case '5': annotate('Proliferative DR'); break;
    case 'ArrowLeft':  e.preventDefault(); goPrev(); break;
    case 'ArrowRight': e.preventDefault(); goNext(); break;
    case '+':
    case '=': setZoom(state.zoomLevel + ZOOM_STEP); break;
    case '-': setZoom(state.zoomLevel - ZOOM_STEP); break;
    case '0': setZoom(1.0); break;
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
document.addEventListener('DOMContentLoaded', init);