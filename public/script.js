/**
 * script.js — Frontend de l'application d'annotation rétinienne
 * Gère : navigation, annotation, zoom, raccourcis, reprise automatique
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
const ZOOM_STEP   = 0.25;
const ZOOM_MIN    = 0.25;
const ZOOM_MAX    = 4.0;
const CLASSES     = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR'];

const CLASS_COUNT_IDS = ['count-0', 'count-1', 'count-2', 'count-3', 'count-4'];
const CLASS_BAR_IDS   = ['grade-0', 'grade-1', 'grade-2', 'grade-3', 'grade-4'];

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  fundusImg:       $('fundus-img'),
  emptyState:      $('empty-state'),
  annotatedBadge:  $('annotated-badge'),
  badgeLabel:      $('badge-label'),

  imageName:       $('image-name'),
  imageCounter:    $('image-counter'),
  zoomIn:          $('zoom-in'),
  zoomOut:         $('zoom-out'),
  zoomReset:       $('zoom-reset'),
  zoomLevel:       $('zoom-level'),

  statAnnotated:   $('stat-annotated'),
  statTotal:       $('stat-total'),
  statRemaining:   $('stat-remaining'),
  progressBar:     $('progress-bar'),
  progressPct:     $('progress-pct'),

  btnPrev:         $('btn-prev'),
  btnNext:         $('btn-next'),
  jumpInput:       $('jump-input'),
  jumpBtn:         $('jump-btn'),
  skipAnnotated:   $('skip-annotated'),

  loadingOverlay:  $('loading-overlay'),
  toastWrap:       $('toast-wrap'),
  exportBtn:       $('export-btn'),

  resetBtn:        $('reset-btn'),
  resetModal:      $('reset-modal'),
  resetConfirm:    $('reset-confirm'),
  resetCancel:     $('reset-cancel'),

  deleteBtn:       $('delete-btn'),
  restoreBtn:      $('restore-btn'),   // ✅ NOUVEAU

  gradeBtns:       document.querySelectorAll('.grade-btn'),
  classBarFills:   [],
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

// ─── API calls ────────────────────────────────────────────────────────────────

async function loadImages() {
  const res  = await fetch('/api/images');
  if (!res.ok) throw new Error('Impossible de charger la liste des images');
  const data = await res.json();
  state.images = data.images || [];
  console.log(`[Images] ${state.images.length} image(s) chargée(s)`);
}

async function loadAnnotations() {
  const res  = await fetch('/api/annotations');
  if (!res.ok) throw new Error('Impossible de charger les annotations');
  const data = await res.json();
  state.annotations = data.annotations || {};
  console.log(`[Annotations] ${Object.keys(state.annotations).length} annotation(s) existante(s)`);
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

// ─── Navigation ───────────────────────────────────────────────────────────────

function goTo(idx) {
  if (state.images.length === 0) return;
  state.currentIdx = Math.max(0, Math.min(idx, state.images.length - 1));
  renderImage();
  renderTopbar();
  renderGradeButtons();
  renderBadge();
}

function goPrev() {
  const skip = dom.skipAnnotated.checked;
  let idx = state.currentIdx - 1;
  if (skip) {
    while (idx >= 0 && state.annotations[state.images[idx]]) idx--;
    if (idx < 0) { showToast('Aucune image non annotée avant celle-ci'); return; }
  }
  if (idx < 0) return;
  goTo(idx);
}

function goNext() {
  const skip = dom.skipAnnotated.checked;
  let idx = state.currentIdx + 1;
  if (skip) {
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
    showToast(`"${imageId}" déplacée vers images_supprimer/`, 'success');
  } catch (err) {
    console.error('[Delete] Erreur :', err);
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ─── ✅ NOUVEAU : Restaurer les images floues ─────────────────────────────────

async function restoreImages() {
  try {
    const res = await fetch('/api/restore-images', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur restauration');
    }

    const data  = await res.json();
    const count = data.restored || 0;

    if (count === 0) {
      showToast('Aucune image à restaurer', 'info');
      return;
    }

    // Recharger la liste complète depuis le serveur
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
    console.error('[Reset] Erreur :', err);
    showToast('Erreur lors de la réinitialisation : ' + err.message, 'error');
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
  const total      = state.images.length;
  const annotated  = Object.keys(state.annotations).length;
  const remaining  = total - annotated;
  const pct        = total > 0 ? Math.round((annotated / total) * 100) : 0;

  dom.statAnnotated.textContent = annotated.toLocaleString('fr');
  dom.statTotal.textContent     = total.toLocaleString('fr');
  dom.statRemaining.textContent = remaining.toLocaleString('fr');
  dom.progressBar.style.width   = pct + '%';
  dom.progressPct.textContent   = pct + '%';

  const mobFill  = $('mob-fill');
  const mobPct   = $('mob-pct');
  const mobCount = $('mob-count');
  if (mobFill)  mobFill.style.width  = pct + '%';
  if (mobPct)   mobPct.textContent   = pct + '%';
  if (mobCount) mobCount.textContent = `${annotated} / ${total}`;

  const counts = {};
  CLASSES.forEach(c => counts[c] = 0);
  Object.values(state.annotations).forEach(v => { if (counts[v] !== undefined) counts[v]++; });

  const maxCount = Math.max(...Object.values(counts), 1);
  CLASSES.forEach((cls, i) => {
    const countEl = $(CLASS_COUNT_IDS[i]);
    if (countEl) countEl.textContent = counts[cls];

    const fill = document.querySelector(`.class-bar-fill.grade-${i}`);
    if (fill) fill.style.width = (counts[cls] / maxCount * 100) + '%';
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  dom.gradeBtns.forEach(btn => {
    btn.addEventListener('click', () => annotate(btn.dataset.grade));
  });

  dom.btnPrev.addEventListener('click', goPrev);
  dom.btnNext.addEventListener('click', goNext);

  dom.jumpBtn.addEventListener('click', handleJump);
  dom.jumpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJump();
  });

  dom.zoomIn.addEventListener('click',    () => setZoom(state.zoomLevel + ZOOM_STEP));
  dom.zoomOut.addEventListener('click',   () => setZoom(state.zoomLevel - ZOOM_STEP));
  dom.zoomReset.addEventListener('click', () => setZoom(1.0));

  document.getElementById('viewer-wrap').addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(state.zoomLevel + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
  }, { passive: false });

  dom.exportBtn.addEventListener('click', () => {
    window.location.href = '/api/export';
  });

  dom.resetBtn.addEventListener('click', openResetModal);
  dom.resetCancel.addEventListener('click', closeResetModal);
  dom.resetConfirm.addEventListener('click', confirmReset);
  dom.resetModal.addEventListener('click', e => {
    if (e.target === dom.resetModal) closeResetModal();
  });

  dom.deleteBtn.addEventListener('click', deleteImage);

  // ✅ NOUVEAU
  dom.restoreBtn.addEventListener('click', restoreImages);

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