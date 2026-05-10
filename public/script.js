/**
 * script.js — Frontend RetAnnot
 * + Checklist 7 lésions avec contraintes cliniques et auto-sélection
 * + Sélecteur de confiance (Certain / Probable / Incertain)
 * + Système Admin Dr Sbai (accès direct aux comptes annotateurs)
 * + Sidebar épurée pour annotateurs normaux (pas de boutons d'action)
 */

'use strict';

// ─── État global ─────────────────────────────────────────────────────────────
const state = {
  annotateur:    null,
  role:          null,       // 'annotator' | 'admin'
  viaAdmin:      false,      // true si admin a pris le contrôle d'un compte
  adminName:     null,       // nom de l'admin connecté (pour retour)
  images:        [],
  annotations:   {},         // { imageId: { grade, lesions, confidence } }
  currentIdx:    0,
  zoomLevel:     1.0,
  isSaving:      false,
  pendingName:   null,
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 4.0;

const CLASSES = [
  'No DR','Mild','Moderate','Severe','Proliferative DR',
  'Impacts laser','Autre pathologie','Mauvaise qualité',
];
const CLASS_COUNT_IDS = ['count-0','count-1','count-2','count-3','count-4','count-5','count-6','count-7'];
const CLASS_COLORS    = ['#22c55e','#eab308','#f97316','#ef4444','#a855f7','#06b6d4','#ec4899','#6b7280'];

// 7 lésions dans l'ordre clinique
const LESIONS = [
  { key: 'MA',   label: 'Microanévrysmes',    short: 'MA'   },
  { key: 'HEM',  label: 'Hémorragies',         short: 'HEM'  },
  { key: 'HE',   label: 'Exsudats durs',       short: 'HE'   },
  { key: 'CWS',  label: 'Nodules cotonneux',   short: 'CWS'  },
  { key: 'IRMA', label: 'IRMA',                short: 'IRMA' },
  { key: 'VA',   label: 'Anomalies veineuses', short: 'VA'   },
  { key: 'NV',   label: 'Néovascularisation',  short: 'NV'   },
];

// Lésions activées (cochables) par grade
// true = activée, false = grisée
const LESION_ENABLED_BY_GRADE = {
  'No DR':           { MA: false, HEM: false, HE: false, CWS: false, IRMA: false, VA: false, NV: false },
  'Mild':            { MA: true,  HEM: false, HE: false, CWS: false, IRMA: false, VA: false, NV: false },
  'Moderate':        { MA: true,  HEM: true,  HE: true,  CWS: true,  IRMA: false, VA: false, NV: false },
  'Severe':          { MA: true,  HEM: true,  HE: true,  CWS: true,  IRMA: true,  VA: true,  NV: false },
  'Proliferative DR':{ MA: true,  HEM: true,  HE: true,  CWS: true,  IRMA: true,  VA: true,  NV: true  },
  'Impacts laser':   { MA: true,  HEM: true,  HE: true,  CWS: true,  IRMA: true,  VA: true,  NV: true  },
  'Autre pathologie':{ MA: true,  HEM: true,  HE: true,  CWS: true,  IRMA: true,  VA: true,  NV: true  },
  'Mauvaise qualité':{ MA: false, HEM: false, HE: false, CWS: false, IRMA: false, VA: false, NV: false },
};

// Auto-sélection hiérarchique : cocher X → auto-cocher les lésions antérieures
const LESION_IMPLIES = {
  'MA':   [],
  'HEM':  ['MA'],
  'HE':   ['MA', 'HEM'],
  'CWS':  ['MA', 'HEM'],
  'IRMA': ['MA', 'HEM'],
  'VA':   ['MA', 'HEM'],
  'NV':   ['MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA'],
};

const CONFIDENCE_LEVELS = [
  { label: 'Certain',   value: 1.0 },
  { label: 'Probable',  value: 0.7 },
  { label: 'Incertain', value: 0.3 },
];

const GRADE_TO_INT = {
  'No DR': 0, 'Mild': 1, 'Moderate': 2, 'Severe': 3, 'Proliferative DR': 4,
};

function imageFolder(name) {
  return name.replace(/[\s.]/g, '_');
}

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  screenSelect:   $('screen-select'),
  screenLogin:    $('screen-login'),
  screenAdmin:    $('screen-admin'),
  sidebar:        $('sidebar'),
  main:           $('main'),

  annotatorCards: $('annotator-cards'),

  loginBackBtn:   $('login-back-btn'),
  loginAvatar:    $('login-avatar'),
  loginName:      $('login-name'),
  loginUsername:  $('login-username'),
  loginPassword:  $('login-password'),
  loginSubmit:    $('login-submit'),
  loginError:     $('login-error'),
  loginErrorMsg:  $('login-error-msg'),
  pwdToggle:      $('pwd-toggle'),
  eyeOpen:        $('eye-open'),
  eyeClosed:      $('eye-closed'),

  // Admin screen
  adminName:      $('admin-name'),
  adminAvatar:    $('admin-avatar'),
  adminLogoutBtn: $('admin-logout-btn'),
  adminExportBtn: $('admin-export-btn'),
  adminDashBtn:   $('admin-dash-btn'),
  adminCardsList: $('admin-cards-list'),

  sidebarAvatar:  $('sidebar-avatar'),
  sidebarName:    $('sidebar-name'),
  logoutBtn:      $('logout-btn'),
  drawerAvatar:   $('drawer-avatar'),
  drawerName:     $('drawer-name'),
  mobLogoutBtn:   $('mob-logout-btn'),

  // Bouton retour admin (dans sidebar quand admin contrôle un compte)
  backAdminBtn:     $('back-admin-btn'),
  mobBackAdminBtn:  $('mob-back-admin-btn'),

  fundusImg:      $('fundus-img'),
  emptyState:     $('empty-state'),
  annotatedBadge: $('annotated-badge'),
  badgeLabel:     $('badge-label'),

  imageName:      $('image-name'),
  imageCounter:   $('image-counter'),
  zoomIn:         $('zoom-in'),
  zoomOut:        $('zoom-out'),
  zoomReset:      $('zoom-reset'),
  zoomLevel:      $('zoom-level'),

  statAnnotated:  $('stat-annotated'),
  statTotal:      $('stat-total'),
  statRemaining:  $('stat-remaining'),
  progressBar:    $('progress-bar'),
  progressPct:    $('progress-pct'),

  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  jumpInput:      $('jump-input'),
  jumpBtn:        $('jump-btn'),

  exportBtn:      $('export-btn'),
  dashboardBtn:   $('dashboard-btn'),
  deleteBtn:      $('delete-btn'),
  restoreBtn:     $('restore-btn'),
  resetBtn:       $('reset-btn'),

  // Panneau lésions
  lesionPanel:    $('lesion-panel'),
  lesionChecks:   {},   // rempli dynamiquement

  // Sélecteur confiance
  confidencePanel: $('confidence-panel'),
  confidenceBtns:  document.querySelectorAll('.confidence-btn'),

  resetModal:     $('reset-modal'),
  resetConfirm:   $('reset-confirm'),
  resetCancel:    $('reset-cancel'),

  loadingOverlay: $('loading-overlay'),
  toastWrap:      $('toast-wrap'),

  gradeBtns:      document.querySelectorAll('.grade-btn, .extra-btn'),

  mobMenuBtn:     $('mob-menu-btn'),
  drawer:         $('drawer'),
  drawerOverlay:  $('drawer-overlay'),
  drawerClose:    $('drawer-close'),
  mobStatAnnotated: $('mob-stat-annotated'),
  mobStatTotal:   $('mob-stat-total'),
  mobStatRemaining: $('mob-stat-remaining'),
  mobProgressBar: $('mob-progress-bar'),
  mobExportBtn:   $('mob-export-btn'),
  mobDashboardBtn:$('mob-dashboard-btn'),
  mobDeleteBtn:   $('mob-delete-btn'),
  mobRestoreBtn:  $('mob-restore-btn'),
  mobResetBtn:    $('mob-reset-btn'),
  mobJumpInput:   $('mob-jump-input'),
  mobJumpBtn:     $('mob-jump-btn'),

  dashboardModal:     $('dashboard-modal'),
  dashboardClose:     $('dashboard-close'),
  dashboardLoading:   $('dashboard-loading'),
  dashboardTableWrap: $('dashboard-table-wrap'),
  dashboardTable:     $('dashboard-table'),

  // Sidebar admin-only buttons section
  sidebarAdminActions: $('sidebar-admin-actions'),
  mobAdminActions:     $('mob-admin-actions'),
};

// ═══════════════════════════════════════════════════════════
// ÉTAPE 1 — Chargement des cartes annotateurs
// ═══════════════════════════════════════════════════════════

async function loadWelcomeScreen() {
  try {
    const res  = await fetch('/api/annotators');
    const data = await res.json();
    renderAnnotatorCards(data.annotators || []);
  } catch {
    showToast('Erreur chargement des annotateurs', 'error');
  }
}

function renderAnnotatorCards(annotators) {
  dom.annotatorCards.innerHTML = '';
  annotators.forEach((name, i) => {
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const card = document.createElement('button');
    card.className = 'annotator-card';
    card.style.animationDelay = `${i * 60}ms`;
    card.innerHTML = `
      <div class="annotator-card-icon">${initials}</div>
      <span class="annotator-card-name">${name}</span>
    `;
    card.addEventListener('click', () => goToLogin(name));
    dom.annotatorCards.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
// ÉTAPE 2 — Écran de connexion
// ═══════════════════════════════════════════════════════════

function goToLogin(name) {
  state.pendingName = name;
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  dom.loginAvatar.textContent  = initials;
  dom.loginName.textContent    = name;
  dom.loginUsername.value      = '';
  dom.loginPassword.value      = '';
  dom.loginError.classList.add('hidden');
  dom.loginUsername.classList.remove('error');
  dom.loginPassword.classList.remove('error');
  dom.loginSubmit.disabled     = false;

  dom.screenSelect.style.animation = 'fade-out 200ms ease forwards';
  setTimeout(() => {
    dom.screenSelect.classList.add('hidden');
    dom.screenLogin.classList.remove('hidden');
    dom.screenLogin.style.animation = 'fade-in 200ms ease forwards';
    dom.loginUsername.focus();
  }, 190);
}

function goBackToSelect() {
  dom.screenLogin.style.animation = 'fade-out 200ms ease forwards';
  setTimeout(() => {
    dom.screenLogin.classList.add('hidden');
    dom.screenSelect.classList.remove('hidden');
    dom.screenSelect.style.animation = 'fade-in 200ms ease forwards';
  }, 190);
}

async function submitLogin() {
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;

  if (!username || !password) {
    showLoginError('Veuillez remplir tous les champs');
    return;
  }

  dom.loginSubmit.disabled = true;
  dom.loginError.classList.add('hidden');

  try {
    const res  = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showLoginError(data.error || 'Identifiants incorrects');
      dom.loginPassword.value = '';
      dom.loginPassword.classList.add('error');
      dom.loginSubmit.disabled = false;
      return;
    }

    if (data.role === 'admin') {
      await enterAdmin(data.name);
    } else {
      await enterApp(data.name, 'annotator', false);
    }

  } catch {
    showLoginError('Erreur de connexion au serveur');
    dom.loginSubmit.disabled = false;
  }
}

function showLoginError(msg) {
  dom.loginErrorMsg.textContent = msg;
  dom.loginError.classList.remove('hidden');
  dom.loginUsername.classList.add('error');
  dom.loginPassword.classList.add('error');
}

// ═══════════════════════════════════════════════════════════
// ÉCRAN ADMIN
// ═══════════════════════════════════════════════════════════

async function enterAdmin(name) {
  state.annotateur = name;
  state.role       = 'admin';
  state.adminName  = name;

  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  dom.adminAvatar.textContent = initials;
  dom.adminName.textContent   = name;

  dom.screenLogin.style.animation = 'fade-out 200ms ease forwards';
  setTimeout(() => {
    dom.screenLogin.classList.add('hidden');
    dom.screenAdmin.classList.remove('hidden');
    dom.screenAdmin.style.animation = 'fade-in 200ms ease forwards';
  }, 190);

  await loadAdminAnnotatorCards();
}

async function loadAdminAnnotatorCards() {
  try {
    const res  = await fetch('/api/annotators');
    const data = await res.json();
    dom.adminCardsList.innerHTML = '';

    // Stats pour chaque annotateur
    let dashData = null;
    try {
      const dr = await fetch('/api/dashboard');
      dashData = await dr.json();
    } catch {}

    const list = (dashData?.annotators || data.annotators || [])
      .filter(name => name !== state.adminName);

    list.forEach((name, i) => {
      const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const total = dashData ? (dashData.stats[name]?.total || 0) : 0;

      const card = document.createElement('button');
      card.className = 'admin-annotator-card';
      card.style.animationDelay = `${i * 60}ms`;
      card.innerHTML = `
        <div class="admin-card-avatar">${initials}</div>
        <div class="admin-card-info">
          <span class="admin-card-name">${name}</span>
          <span class="admin-card-stat">${total} annotation${total > 1 ? 's' : ''}</span>
        </div>
        <div class="admin-card-arrow">
          <svg viewBox="0 0 16 16" fill="none"><polyline points="6,3 12,8 6,13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      `;
      card.addEventListener('click', () => adminEnterAnnotator(name));
      dom.adminCardsList.appendChild(card);
    });
  } catch {
    showToast('Erreur chargement annotateurs', 'error');
  }
}

async function adminEnterAnnotator(annotatorName) {
  try {
    const res = await fetch('/api/admin/enter-annotator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_name: state.adminName, annotateur: annotatorName }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erreur accès', 'error'); return; }

    dom.screenAdmin.style.animation = 'fade-out 200ms ease forwards';
    setTimeout(() => {
      dom.screenAdmin.classList.add('hidden');
    }, 190);

    await enterApp(annotatorName, 'annotator', true);
  } catch {
    showToast('Erreur connexion', 'error');
  }
}

function logoutAdmin() {
  state.annotateur = null;
  state.role       = null;
  state.adminName  = null;

  dom.screenAdmin.style.animation = 'fade-out 200ms ease forwards';
  setTimeout(() => {
    dom.screenAdmin.classList.add('hidden');
    dom.screenSelect.classList.remove('hidden');
    dom.screenSelect.style.animation = 'fade-in 250ms ease forwards';
  }, 190);
}

function backToAdmin() {
  closeDrawer();
  // Réinitialiser l'état annotateur
  state.annotateur  = state.adminName;
  state.role        = 'admin';
  state.viaAdmin    = false;
  state.annotations = {};
  state.currentIdx  = 0;
  state.images      = [];

  dom.sidebar.classList.add('hidden');
  dom.main.classList.add('hidden');

  dom.screenAdmin.classList.remove('hidden');
  dom.screenAdmin.style.animation = 'fade-in 250ms ease forwards';

  // Rafraîchir les stats
  loadAdminAnnotatorCards();
}

// ═══════════════════════════════════════════════════════════
// ÉTAPE 3 — Entrée dans l'application
// ═══════════════════════════════════════════════════════════

let eventsBound = false;

async function enterApp(name, role, viaAdmin) {
  state.annotateur = name;
  state.role       = role;
  state.viaAdmin   = viaAdmin;

  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  dom.sidebarAvatar.textContent = initials;
  dom.sidebarName.textContent   = name;
  dom.drawerAvatar.textContent  = initials;
  dom.drawerName.textContent    = name;

  // Montrer/cacher les boutons selon le rôle
  updateSidebarForRole(viaAdmin);

  dom.screenLogin.classList.add('hidden');
  dom.sidebar.classList.remove('hidden');
  dom.main.classList.remove('hidden');

  showLoading(true);
  try {
    await Promise.all([loadImages(), loadAnnotations()]);
    jumpToFirstUnannotated();
    renderAll();
  } catch (err) {
    showToast('Erreur chargement : ' + err.message, 'error');
  } finally {
    showLoading(false);
  }

  if (!eventsBound) {
    bindAppEvents();
    eventsBound = true;
  }
}

function updateSidebarForRole(isAdminMode) {
  // Boutons admin (supprimer, restaurer, reset)
  if (dom.sidebarAdminActions) {
    dom.sidebarAdminActions.classList.toggle('hidden', !isAdminMode);
  }
  if (dom.mobAdminActions) {
    dom.mobAdminActions.classList.toggle('hidden', !isAdminMode);
  }
  // Bouton retour admin
  if (dom.backAdminBtn) {
    dom.backAdminBtn.classList.toggle('hidden', !isAdminMode);
  }
  if (dom.mobBackAdminBtn) {
    dom.mobBackAdminBtn.classList.toggle('hidden', !isAdminMode);
  }
}

function logout() {
  closeDrawer();
  state.annotateur  = null;
  state.role        = null;
  state.viaAdmin    = false;
  state.adminName   = null;
  state.annotations = {};
  state.currentIdx  = 0;
  state.images      = [];

  dom.sidebar.classList.add('hidden');
  dom.main.classList.add('hidden');
  dom.screenSelect.classList.remove('hidden');
  dom.screenSelect.style.animation = 'fade-in 250ms ease forwards';
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

async function loadImages() {
  const res  = await fetch(`/api/images?annotateur=${encodeURIComponent(state.annotateur)}`);
  if (!res.ok) throw new Error('Impossible de charger les images');
  const data = await res.json();
  state.images = data.images || [];
}

async function loadAnnotations() {
  const res  = await fetch(`/api/annotations?annotateur=${encodeURIComponent(state.annotateur)}`);
  if (!res.ok) throw new Error('Impossible de charger les annotations');
  const data = await res.json();
  // Normaliser : supporter l'ancien format (string) et le nouveau (objet)
  const raw = data.annotations || {};
  state.annotations = {};
  for (const [imgId, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      state.annotations[imgId] = { grade: val, lesions: emptyLesions(), confidence: 1.0 };
    } else {
      state.annotations[imgId] = {
        grade:      val.grade || '',
        lesions:    val.lesions || emptyLesions(),
        confidence: val.confidence !== undefined ? val.confidence : 1.0,
      };
    }
  }
}

function emptyLesions() {
  const l = {};
  LESIONS.forEach(le => l[le.key] = 0);
  return l;
}

async function saveAnnotation(imageId, grade, lesions, confidence) {
  const res = await fetch('/api/annotations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      image_id:   imageId,
      annotation: grade,
      annotateur: state.annotateur,
      lesions,
      confidence,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erreur sauvegarde');
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
  renderLesionPanel();
  renderConfidencePanel();
}

function goPrev() {
  if (state.currentIdx <= 0) return;
  goTo(state.currentIdx - 1);
}

function goNext() {
  if (state.currentIdx >= state.images.length - 1) return;
  goTo(state.currentIdx + 1);
}

function jumpToFirstUnannotated() {
  const idx = state.images.findIndex(name => !state.annotations[name]);
  state.currentIdx = idx === -1 ? 0 : idx;
}

// ═══════════════════════════════════════════════════════════
// ANNOTATION — GRADE
// ═══════════════════════════════════════════════════════════

async function annotate(grade) {
  if (state.images.length === 0 || state.isSaving) return;
  const imageId = state.images[state.currentIdx];

  // Récupérer l'annotation existante ou créer une nouvelle
  const existing = state.annotations[imageId] || { grade: '', lesions: emptyLesions(), confidence: 1.0 };

  // Si changement de grade, recalculer les lésions
  let lesions = existing.lesions;
  if (existing.grade !== grade) {
    lesions = computeDefaultLesions(grade, existing.lesions);
  }

  const confidence = existing.confidence || 1.0;

  state.annotations[imageId] = { grade, lesions, confidence };

  renderGradeButtons();
  renderBadge();
  renderStats();
  renderLesionPanel();
  renderConfidencePanel();

  const btn = document.querySelector(`[data-grade="${CSS.escape(grade)}"]`);
  if (btn) {
    btn.classList.add('flashing');
    setTimeout(() => btn.classList.remove('flashing'), 200);
  }

  state.isSaving = true;
  try {
    await saveAnnotation(imageId, grade, lesions, confidence);
  } catch (err) {
    showToast('Erreur sauvegarde : ' + err.message, 'error');
  } finally {
    state.isSaving = false;
  }
}

// Calculer les lésions par défaut selon le grade
function computeDefaultLesions(grade, existingLesions) {
  const enabled = LESION_ENABLED_BY_GRADE[grade] || {};
  const lesions = emptyLesions();

  // Auto-cocher MA pour Mild
  if (grade === 'Mild') {
    lesions['MA'] = 1;
    return lesions;
  }

  // Pour les autres grades, garder les lésions existantes si elles sont encore activées
  if (existingLesions) {
    LESIONS.forEach(l => {
      if (enabled[l.key] && existingLesions[l.key]) {
        lesions[l.key] = existingLesions[l.key];
      }
    });
  }

  return lesions;
}

// ═══════════════════════════════════════════════════════════
// ANNOTATION — LÉSIONS
// ═══════════════════════════════════════════════════════════

function toggleLesion(key, checked) {
  const imageId = state.images[state.currentIdx];
  if (!imageId) return;

  const ann = state.annotations[imageId] || { grade: '', lesions: emptyLesions(), confidence: 1.0 };
  const lesions = { ...ann.lesions };

  if (checked) {
    // Auto-sélection hiérarchique : cocher les lésions antérieures
    lesions[key] = 1;
    const implies = LESION_IMPLIES[key] || [];
    implies.forEach(k => { lesions[k] = 1; });
  } else {
    lesions[key] = 0;
  }

  state.annotations[imageId] = { ...ann, lesions };
  renderLesionCheckboxes(ann.grade, lesions);
  debounceSave(imageId);
}

let saveTimer = null;
function debounceSave(imageId) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ann = state.annotations[imageId];
    if (!ann) return;
    state.isSaving = true;
    try {
      await saveAnnotation(imageId, ann.grade, ann.lesions, ann.confidence);
    } catch (err) {
      showToast('Erreur sauvegarde : ' + err.message, 'error');
    } finally {
      state.isSaving = false;
    }
  }, 400);
}

// ═══════════════════════════════════════════════════════════
// ANNOTATION — CONFIANCE
// ═══════════════════════════════════════════════════════════

function setConfidence(value) {
  const imageId = state.images[state.currentIdx];
  if (!imageId) return;

  const ann = state.annotations[imageId] || { grade: '', lesions: emptyLesions(), confidence: 1.0 };
  state.annotations[imageId] = { ...ann, confidence: value };

  renderConfidenceButtons(value);
  debounceSave(imageId);
}

// ═══════════════════════════════════════════════════════════
// SUPPRIMER / RESTAURER (admin only)
// ═══════════════════════════════════════════════════════════

async function deleteImage() {
  if (state.images.length === 0) return;
  const imageId = state.images[state.currentIdx];
  closeDrawer();
  try {
    const res = await fetch('/api/delete-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, annotateur: state.annotateur }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur');
    state.images.splice(state.currentIdx, 1);
    delete state.annotations[imageId];
    if (state.currentIdx >= state.images.length) state.currentIdx = Math.max(0, state.images.length - 1);
    renderAll();
    showToast(`"${imageId}" déplacée vers images_floues/`, 'success');
  } catch (err) { showToast('Erreur : ' + err.message, 'error'); }
}

async function restoreImages() {
  closeDrawer();
  try {
    const res  = await fetch('/api/restore-images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotateur: state.annotateur }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur');
    const data  = await res.json();
    const count = data.restored || 0;
    if (count === 0) { showToast('Aucune image à restaurer', 'info'); return; }
    await loadImages();
    renderAll();
    showToast(`${count} image(s) restaurée(s)`, 'success');
  } catch (err) { showToast('Erreur : ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
// RESET (admin only)
// ═══════════════════════════════════════════════════════════

function openResetModal() { closeDrawer(); dom.resetModal.classList.remove('hidden'); }
function closeResetModal() { dom.resetModal.classList.add('hidden'); }

async function confirmReset() {
  closeResetModal(); showLoading(true);
  try {
    const res = await fetch('/api/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotateur: state.annotateur }),
    });
    if (!res.ok) throw new Error('Échec reset');
    state.annotations = {};
    state.currentIdx  = 0;
    renderAll();
    showToast('Annotations réinitialisées', 'success');
  } catch (err) { showToast('Erreur : ' + err.message, 'error'); }
  finally { showLoading(false); }
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
    if (!res.ok) throw new Error('Erreur');
    renderDashboardTable(await res.json());
  } catch (err) {
    showToast('Erreur tableau de bord : ' + err.message, 'error');
    dom.dashboardModal.classList.add('hidden');
  }
}

function closeDashboard() { dom.dashboardModal.classList.add('hidden'); }

function renderDashboardTable({ annotators, classes, stats, grandTotal }) {
  const table = dom.dashboardTable;
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');
  const thName = document.createElement('th');
  thName.textContent = 'Annotateur';
  hRow.appendChild(thName);
  const thTotal = document.createElement('th');
  thTotal.textContent = 'Total'; thTotal.className = 'num';
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
    tdName.className = 'annotator-name'; tdName.textContent = ann;
    row.appendChild(tdName);
    const tdTotal = document.createElement('td');
    tdTotal.className = 'total-num'; tdTotal.textContent = s.total;
    row.appendChild(tdTotal);
    classes.forEach(cls => {
      const td = document.createElement('td');
      td.className = 'num';
      const c = s.classes[cls] || 0;
      td.textContent = c > 0 ? c : '—';
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const fRow  = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.className = 'total-label'; tdLabel.textContent = 'Total';
  fRow.appendChild(tdLabel);
  const tdGrand = document.createElement('td');
  tdGrand.className = 'num'; tdGrand.textContent = grandTotal.total;
  fRow.appendChild(tdGrand);
  classes.forEach(cls => {
    const td = document.createElement('td');
    td.className = 'num'; td.textContent = grandTotal.classes[cls] || 0;
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
  renderLesionPanel();
  renderConfidencePanel();
}

function renderImage() {
  if (state.images.length === 0) {
    dom.emptyState.classList.remove('hidden');
    dom.fundusImg.classList.add('hidden');
    return;
  }
  dom.emptyState.classList.add('hidden');
  dom.fundusImg.classList.remove('hidden');
  const name   = state.images[state.currentIdx];
  const folder = imageFolder(state.annotateur);
  dom.fundusImg.src = `/images/${folder}/${encodeURIComponent(name)}`;
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
  const ann      = current ? state.annotations[current] : null;
  const existing = ann ? ann.grade : null;
  dom.gradeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.grade === existing));
}

function renderBadge() {
  const current    = state.images[state.currentIdx];
  const ann        = current ? state.annotations[current] : null;
  const annotation = ann ? ann.grade : null;
  if (annotation) {
    dom.annotatedBadge.classList.remove('hidden');
    dom.badgeLabel.textContent = annotation;
  } else {
    dom.annotatedBadge.classList.add('hidden');
  }
}

// ─── Panneau lésions ──────────────────────────────────────

function renderLesionPanel() {
  const current = state.images[state.currentIdx];
  const ann     = current ? state.annotations[current] : null;
  const grade   = ann ? ann.grade : null;
  const lesions = ann ? ann.lesions : emptyLesions();

  // Afficher le panneau seulement si grade est un grade DR (pas Mauvaise qualité, etc.)
  const showPanel = grade && grade !== 'No DR' && grade !== 'Mauvaise qualité';

  if (dom.lesionPanel) {
    dom.lesionPanel.classList.toggle('hidden', !showPanel);
    if (showPanel) {
      renderLesionCheckboxes(grade, lesions);
    }
  }

  // Panneau confiance
  if (dom.confidencePanel) {
    dom.confidencePanel.classList.toggle('hidden', !grade);
    if (grade) {
      renderConfidenceButtons(ann ? ann.confidence : 1.0);
    }
  }
}

function renderLesionCheckboxes(grade, lesions) {
  const enabled = LESION_ENABLED_BY_GRADE[grade] || {};
  const container = $('lesion-checks-container');
  if (!container) return;

  LESIONS.forEach(l => {
    const wrap = $(`lesion-wrap-${l.key}`);
    const cb   = $(`lesion-cb-${l.key}`);
    if (!wrap || !cb) return;

    const isEnabled = enabled[l.key] === true;
    const isChecked = lesions[l.key] === 1;

    cb.checked  = isChecked;
    cb.disabled = !isEnabled;
    wrap.classList.toggle('lesion-disabled', !isEnabled);
    wrap.classList.toggle('lesion-checked',  isChecked && isEnabled);
  });
}

function renderConfidencePanel() {
  const current = state.images[state.currentIdx];
  const ann     = current ? state.annotations[current] : null;
  const grade   = ann ? ann.grade : null;

  if (dom.confidencePanel) {
    dom.confidencePanel.classList.toggle('hidden', !grade);
    if (grade) {
      renderConfidenceButtons(ann ? ann.confidence : 1.0);
    }
  }
}

function renderConfidenceButtons(value) {
  document.querySelectorAll('.confidence-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.confidence) === value);
  });
}

function renderStats() {
  const total     = state.images.length;
  const annotated = Object.keys(state.annotations).length;
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
  Object.values(state.annotations).forEach(v => {
    const grade = typeof v === 'string' ? v : v.grade;
    if (counts[grade] !== undefined) counts[grade]++;
  });
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
// EVENTS — LOGIN
// ═══════════════════════════════════════════════════════════

function bindLoginEvents() {
  dom.loginBackBtn.addEventListener('click', goBackToSelect);
  dom.loginSubmit.addEventListener('click', submitLogin);
  dom.loginPassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });
  dom.loginUsername.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.loginPassword.focus();
    dom.loginUsername.classList.remove('error');
    dom.loginPassword.classList.remove('error');
  });
  dom.loginPassword.addEventListener('input', () => {
    dom.loginUsername.classList.remove('error');
    dom.loginPassword.classList.remove('error');
  });
  dom.pwdToggle.addEventListener('click', () => {
    const isText = dom.loginPassword.type === 'text';
    dom.loginPassword.type = isText ? 'password' : 'text';
    dom.eyeOpen.classList.toggle('hidden', !isText);
    dom.eyeClosed.classList.toggle('hidden', isText);
  });

  // Admin screen events
  if (dom.adminLogoutBtn) dom.adminLogoutBtn.addEventListener('click', logoutAdmin);
  if (dom.adminExportBtn) dom.adminExportBtn.addEventListener('click', () => { window.location.href = '/api/export'; });
  if (dom.adminDashBtn)   dom.adminDashBtn.addEventListener('click', openDashboard);

  // Dashboard modal must also work from the admin screen before app events are bound
  if (dom.dashboardClose) dom.dashboardClose.addEventListener('click', closeDashboard);
  if (dom.dashboardModal) dom.dashboardModal.addEventListener('click', e => { if (e.target === dom.dashboardModal) closeDashboard(); });
}

// ═══════════════════════════════════════════════════════════
// EVENTS — APPLICATION
// ═══════════════════════════════════════════════════════════

function bindAppEvents() {
  // Logout / Back to admin
  dom.logoutBtn.addEventListener('click', logout);
  dom.mobLogoutBtn.addEventListener('click', logout);
  if (dom.backAdminBtn)    dom.backAdminBtn.addEventListener('click', backToAdmin);
  if (dom.mobBackAdminBtn) dom.mobBackAdminBtn.addEventListener('click', backToAdmin);

  // Grade buttons
  dom.gradeBtns.forEach(btn => btn.addEventListener('click', () => annotate(btn.dataset.grade)));

  // Lésion checkboxes
  LESIONS.forEach(l => {
    const cb = $(`lesion-cb-${l.key}`);
    if (cb) {
      cb.addEventListener('change', e => toggleLesion(l.key, e.target.checked));
    }
  });

  // Confidence buttons
  document.querySelectorAll('.confidence-btn').forEach(btn => {
    btn.addEventListener('click', () => setConfidence(parseFloat(btn.dataset.confidence)));
  });

  // Navigation
  dom.btnPrev.addEventListener('click', goPrev);
  dom.btnNext.addEventListener('click', goNext);

  // Jump
  dom.jumpBtn.addEventListener('click', handleJump);
  dom.jumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleJump(); });
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

  // Boutons admin-only desktop
  if (dom.deleteBtn)  dom.deleteBtn.addEventListener('click',  deleteImage);
  if (dom.restoreBtn) dom.restoreBtn.addEventListener('click', restoreImages);
  if (dom.resetBtn)   dom.resetBtn.addEventListener('click',   openResetModal);

  // Boutons admin-only mobile
  if (dom.mobDeleteBtn)  dom.mobDeleteBtn.addEventListener('click',  deleteImage);
  if (dom.mobRestoreBtn) dom.mobRestoreBtn.addEventListener('click', restoreImages);
  if (dom.mobResetBtn)   dom.mobResetBtn.addEventListener('click',   openResetModal);

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
  if (!dom.dashboardModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeDashboard();
    return;
  }
  if (!dom.resetModal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeResetModal();
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
  }
}

// ─── Toast / Loading ──────────────────────────────────────────────────────────
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

function showLoading(visible) {
  dom.loadingOverlay.classList.toggle('hidden', !visible);
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindLoginEvents();
  loadWelcomeScreen();
});