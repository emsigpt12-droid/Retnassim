/**
 * script.js — Frontend de l'application d'annotation rétinienne
 * Gère : navigation, annotation, zoom, raccourcis, reprise automatique
 */

'use strict';

// ─── État global ─────────────────────────────────────────────────────────────
const state = {
  images:      [],          // Liste des noms de fichiers
  annotations: {},          // { filename: grade }
  currentIdx:  0,           // Index courant
  zoomLevel:   1.0,         // Niveau de zoom (0.5 – 4.0)
  isSaving:    false,       // Verrou de sauvegarde
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const ZOOM_STEP   = 0.25;
const ZOOM_MIN    = 0.25;
const ZOOM_MAX    = 4.0;
const CLASSES     = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR'];
const AUTO_NEXT_DELAY_MS = 260;   // délai après annotation avant passage suivant

// Compteurs sidebar par classe (index = position dans CLASSES)
const CLASS_COUNT_IDS = ['count-0', 'count-1', 'count-2', 'count-3', 'count-4'];
const CLASS_BAR_IDS   = ['grade-0', 'grade-1', 'grade-2', 'grade-3', 'grade-4'];


// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  // Image viewer
  fundusImg:       $('fundus-img'),
  emptyState:      $('empty-state'),
  annotatedBadge:  $('annotated-badge'),
  badgeLabel:      $('badge-label'),

  // Topbar
  imageName:       $('image-name'),
  imageCounter:    $('image-counter'),
  zoomIn:          $('zoom-in'),
  zoomOut:         $('zoom-out'),
  zoomReset:       $('zoom-reset'),
  zoomLevel:       $('zoom-level'),

  // Stats sidebar
  statAnnotated:   $('stat-annotated'),
  statTotal:       $('stat-total'),
  statRemaining:   $('stat-remaining'),
  progressBar:     $('progress-bar'),
  progressPct:     $('progress-pct'),

  // Navigation
  btnPrev:         $('btn-prev'),
  btnNext:         $('btn-next'),
  jumpInput:       $('jump-input'),
  jumpBtn:         $('jump-btn'),
  skipAnnotated:   $('skip-annotated'),

  // Misc
  loadingOverlay:  $('loading-overlay'),
  toastWrap:       $('toast-wrap'),
  exportBtn:       $('export-btn'),

  // ✅ NOUVEAU : Reset
  resetBtn:        $('reset-btn'),
  resetModal:      $('reset-modal'),
  resetConfirm:    $('reset-confirm'),
  resetCancel:     $('reset-cancel'),

  // Grade buttons (NodeList)
  gradeBtns:       document.querySelectorAll('.grade-btn'),
  classBarFills:   [],   // rempli après init
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

  // Mise à jour locale optimiste
  state.annotations[imageId] = grade;
  renderGradeButtons();
  renderBadge();
  renderStats();

  // Flash visuel sur le bouton
  const btn = document.querySelector(`.grade-btn[data-grade="${grade}"]`);
  if (btn) {
    btn.classList.add('flashing');
    setTimeout(() => btn.classList.remove('flashing'), 200);
  }

  // Sauvegarde
  state.isSaving = true;
  try {
    await saveAnnotation(imageId, grade);
    // Passage automatique après délai
    setTimeout(() => {
      goNext();
      state.isSaving = false;
    }, AUTO_NEXT_DELAY_MS);
  } catch (err) {
    console.error('[Annotate] Erreur :', err);
    showToast('Erreur sauvegarde : ' + err.message, 'error');
    state.isSaving = false;
  }
}

// ─── Reset annotations ────────────────────────────────────────────────────────

/**
 * Ouvre la modal de confirmation avant de réinitialiser
 */
function openResetModal() {
  dom.resetModal.classList.remove('hidden');
}

function closeResetModal() {
  dom.resetModal.classList.add('hidden');
}

/**
 * Exécute la réinitialisation complète après confirmation
 */
async function confirmReset() {
  closeResetModal();
  showLoading(true);

  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Échec de la réinitialisation serveur');

    // Reset état local
    state.annotations = {};
    state.currentIdx  = 0;
    state.isSaving    = false;

    // Reset UI complète
    renderAll();

    showToast('Toutes les annotations ont été supprimées', 'success');
    console.log('[Reset] ✅ Annotations réinitialisées');
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
  setZoom(state.zoomLevel); // ré-appliquer le zoom
}

function renderTopbar() {
  if (state.images.length === 0) {
    dom.imageName.textContent = '—';
    dom.imageCounter.textContent = '— / —';
    return;
  }
  dom.imageName.textContent = state.images[state.currentIdx];
  dom.imageCounter.textContent = `${state.currentIdx + 1} / ${state.images.length}`;

  dom.btnPrev.disabled = state.currentIdx === 0;
  dom.btnNext.disabled = state.currentIdx === state.images.length - 1;
}

function renderGradeButtons() {
  const current = state.images[state.currentIdx];
  const existing = current ? state.annotations[current] : null;

  dom.gradeBtns.forEach(btn => {
    const grade = btn.dataset.grade;
    btn.classList.toggle('active', grade === existing);
  });
}

function renderBadge() {
  const current = state.images[state.currentIdx];
  const annotation = current ? state.annotations[current] : null;

  if (annotation) {
    dom.annotatedBadge.classList.remove('hidden');
    dom.badgeLabel.textContent = annotation;
  } else {
    dom.annotatedBadge.classList.add('hidden');
  }
}

function renderStats() {
  const total = state.images.length;
  const annotated = Object.keys(state.annotations).length;
  const remaining = total - annotated;
  const pct = total > 0 ? Math.round((annotated / total) * 100) : 0;

  dom.statAnnotated.textContent  = annotated.toLocaleString('fr');
  dom.statTotal.textContent      = total.toLocaleString('fr');
  dom.statRemaining.textContent  = remaining.toLocaleString('fr');
  dom.progressBar.style.width    = pct + '%';
  dom.progressPct.textContent    = pct + '%';

  // Barre mobile
  const mobFill  = $('mob-fill');
  const mobPct   = $('mob-pct');
  const mobCount = $('mob-count');
  if (mobFill)  mobFill.style.width   = pct + '%';
  if (mobPct)   mobPct.textContent    = pct + '%';
  if (mobCount) mobCount.textContent  = `${annotated} / ${total}`;

  // Distribution par classe
  const counts = {};
  CLASSES.forEach(c => counts[c] = 0);
  Object.values(state.annotations).forEach(v => { if (counts[v] !== undefined) counts[v]++; });

  const maxCount = Math.max(...Object.values(counts), 1);
  CLASSES.forEach((cls, i) => {
    const countEl = $(CLASS_COUNT_IDS[i]);
    if (countEl) countEl.textContent = counts[cls];

    // Barre de distribution
    const fill = document.querySelector(`.class-bar-fill.grade-${i}`);
    if (fill) fill.style.width = (counts[cls] / maxCount * 100) + '%';
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Boutons d'annotation
  dom.gradeBtns.forEach(btn => {
    btn.addEventListener('click', () => annotate(btn.dataset.grade));
  });

  // Navigation
  dom.btnPrev.addEventListener('click', goPrev);
  dom.btnNext.addEventListener('click', goNext);

  // Jump
  dom.jumpBtn.addEventListener('click', handleJump);
  dom.jumpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJump();
  });

  // Zoom
  dom.zoomIn.addEventListener('click',    () => setZoom(state.zoomLevel + ZOOM_STEP));
  dom.zoomOut.addEventListener('click',   () => setZoom(state.zoomLevel - ZOOM_STEP));
  dom.zoomReset.addEventListener('click', () => setZoom(1.0));

  // Scroll to zoom
  document.getElementById('viewer-wrap').addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(state.zoomLevel + delta);
  }, { passive: false });

  // Export
  dom.exportBtn.addEventListener('click', () => {
    window.location.href = '/api/export';
  });

  // ✅ NOUVEAU : Reset
  dom.resetBtn.addEventListener('click', openResetModal);
  dom.resetCancel.addEventListener('click', closeResetModal);
  dom.resetConfirm.addEventListener('click', confirmReset);

  // Fermer la modal en cliquant sur l'overlay
  dom.resetModal.addEventListener('click', e => {
    if (e.target === dom.resetModal) closeResetModal();
  });

  // Fermer la modal avec Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !dom.resetModal.classList.contains('hidden')) {
      closeResetModal();
    }
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

function handleKeydown(e) {
  // Éviter les raccourcis lors de la saisie dans un input
  if (e.target.tagName === 'INPUT') return;
  // Éviter les raccourcis si la modal est ouverte
  if (!dom.resetModal.classList.contains('hidden')) return;

  switch (e.key) {
    case '1': annotate('No DR');           break;
    case '2': annotate('Mild');            break;
    case '3': annotate('Moderate');        break;
    case '4': annotate('Severe');          break;
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