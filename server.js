/**
 * server.js — Backend Express RetAnnot
 * Auth par annotateur, images séparées par dossier, annotations Excel enrichi
 * + Système admin Dr Sbai
 * + Annotations de lésions (MA, HEM, HE, CWS, IRMA, VA, NV)
 * + Sélecteur de confiance (Certain/Probable/Incertain)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;

const IMAGES_BASE = path.join(__dirname, 'images');
const BLURRY_BASE = path.join(__dirname, 'images_floues');
const DATA_DIR    = path.join(__dirname, 'data');
const XLSX_PATH   = path.join(DATA_DIR, 'annotations.xlsx');
const SHEET_NAME  = 'Annotations';

// ─── Annotateurs & mots de passe ─────────────────────────────────────────────
const ANNOTATORS = [
  { name: 'Dr El Bakkali',  username: 'elbakkali',  password: 'elbakkali123',  role: 'annotator' },
  { name: 'Dr Boulanouar',  username: 'boulanouar', password: 'boulanouar123', role: 'annotator' },
  { name: 'Dr El Moussaif', username: 'elmoussaif', password: 'elmoussaif123', role: 'annotator' },
  { name: 'Dr El Arabi',    username: 'elarabi',    password: 'elarabi123',    role: 'annotator' },
  { name: 'Dr Essafi',      username: 'essafi',     password: 'essafi123',     role: 'annotator' },
  { name: 'Dr Zekraoui',    username: 'zekraoui',   password: 'zekraoui123',   role: 'annotator' },
  { name: 'Dr Hafidi',      username: 'hafidi',     password: 'hafidi123',     role: 'annotator' },
  { name: 'Dr Sbai',        username: 'sbai',        password: 'sbai123',       role: 'admin'     },
];

const GRADE_TO_INT = {
  'No DR': 0, 'Mild': 1, 'Moderate': 2, 'Severe': 3, 'Proliferative DR': 4,
};

const VALID_CLASSES = [
  'No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR',
  'Impacts laser', 'Autre pathologie', 'Mauvaise qualité',
];

const LESION_KEYS = ['MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA', 'NV'];
const CONFIDENCE_VALUES = [1.0, 0.7, 0.3];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(IMAGES_BASE));

function authenticate(username, password) {
  return ANNOTATORS.find(a => a.username === username && a.password === password) || null;
}

function imagesDir(annotateur) {
  return path.join(IMAGES_BASE, annotateur.replace(/[\s.]/g, '_'));
}

function blurryDir(annotateur) {
  return path.join(BLURRY_BASE, annotateur.replace(/[\s.]/g, '_'));
}

function readAllRows() {
  if (!fs.existsSync(XLSX_PATH)) return [];
  try {
    const wb    = XLSX.readFile(XLSX_PATH);
    const sheet = wb.Sheets[SHEET_NAME];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    console.error('[Excel] Erreur lecture :', e.message);
    return [];
  }
}

function readAnnotationsForUser(annotateur) {
  const result = {};
  for (const row of readAllRows()) {
    if (row.image_id && row.annotateur === annotateur) {
      result[row.image_id] = {
        grade:      row.annotation || '',
        lesions: {
          MA:   row.MA   !== undefined ? Number(row.MA)   : 0,
          HEM:  row.HEM  !== undefined ? Number(row.HEM)  : 0,
          HE:   row.HE   !== undefined ? Number(row.HE)   : 0,
          CWS:  row.CWS  !== undefined ? Number(row.CWS)  : 0,
          IRMA: row.IRMA !== undefined ? Number(row.IRMA) : 0,
          VA:   row.VA   !== undefined ? Number(row.VA)   : 0,
          NV:   row.NV   !== undefined ? Number(row.NV)   : 0,
        },
        confidence: row.confidence !== undefined ? Number(row.confidence) : 1.0,
      };
    }
  }
  return result;
}

function writeAnnotation(imageId, annotation, annotateur, lesions, confidence) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let wb = fs.existsSync(XLSX_PATH) ? XLSX.readFile(XLSX_PATH) : XLSX.utils.book_new();
  let sheet = wb.Sheets[SHEET_NAME];
  let rows  = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [];

  const gradeInt = GRADE_TO_INT[annotation] !== undefined ? GRADE_TO_INT[annotation] : null;

  const newRow = {
    image_id:   imageId,
    annotation,
    grade:      gradeInt !== null ? gradeInt : '',
    MA:         lesions ? (lesions.MA   || 0) : 0,
    HEM:        lesions ? (lesions.HEM  || 0) : 0,
    HE:         lesions ? (lesions.HE   || 0) : 0,
    CWS:        lesions ? (lesions.CWS  || 0) : 0,
    IRMA:       lesions ? (lesions.IRMA || 0) : 0,
    VA:         lesions ? (lesions.VA   || 0) : 0,
    NV:         lesions ? (lesions.NV   || 0) : 0,
    confidence: confidence !== undefined ? confidence : 1.0,
    annotateur,
  };

  const idx = rows.findIndex(r => r.image_id === imageId && r.annotateur === annotateur);
  if (idx >= 0) { rows[idx] = newRow; }
  else { rows.push(newRow); }

  const headers = ['image_id', 'annotation', 'grade', 'MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA', 'NV', 'confidence', 'annotateur'];
  wb.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(rows, { header: headers });
  if (!wb.SheetNames.includes(SHEET_NAME)) wb.SheetNames.push(SHEET_NAME);
  XLSX.writeFile(wb, XLSX_PATH);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// ✅ FIX : Retourne TOUS les utilisateurs (annotateurs + admin)
// pour que Dr Sbai apparaisse dans l'écran de sélection
app.get('/api/annotators', (req, res) => {
  res.json({ annotators: ANNOTATORS.map(a => a.name) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username et mot de passe requis' });
  const user = authenticate(username.trim(), password);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  console.log(`[Auth] Connexion : ${user.name} (${user.role})`);
  res.json({ success: true, name: user.name, role: user.role });
});

// Accès admin direct à un compte annotateur (sans mot de passe)
app.post('/api/admin/enter-annotator', (req, res) => {
  const { admin_name, annotateur } = req.body;
  const admin = ANNOTATORS.find(a => a.name === admin_name && a.role === 'admin');
  if (!admin) return res.status(403).json({ error: 'Accès refusé' });
  const annotatorUser = ANNOTATORS.find(a => a.name === annotateur && a.role === 'annotator');
  if (!annotatorUser) return res.status(404).json({ error: 'Annotateur introuvable' });
  res.json({ success: true, name: annotateur, role: 'annotator', via_admin: true });
});

app.get('/api/images', (req, res) => {
  const { annotateur } = req.query;
  if (!annotateur) return res.status(400).json({ error: 'Parametre annotateur requis' });
  const dir = imagesDir(annotateur);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ images: [], total: 0 }); }
  const EXT = ['.jpg','.jpeg','.png','.bmp','.tiff','.tif','.webp'];
  try {
    const files = fs.readdirSync(dir)
      .filter(f => EXT.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    res.json({ images: files, total: files.length });
  } catch (err) { res.status(500).json({ error: 'Impossible de lire le dossier images' }); }
});

app.get('/api/annotations', (req, res) => {
  const { annotateur } = req.query;
  if (!annotateur) return res.status(400).json({ error: 'Parametre annotateur requis' });
  try { res.json({ annotations: readAnnotationsForUser(annotateur) }); }
  catch (err) { res.status(500).json({ error: 'Impossible de lire les annotations' }); }
});

app.post('/api/annotations', (req, res) => {
  const { image_id, annotation, annotateur, lesions, confidence } = req.body;
  if (!image_id || !annotation || !annotateur) return res.status(400).json({ error: 'Parametres requis' });
  if (!VALID_CLASSES.includes(annotation)) return res.status(400).json({ error: 'Annotation invalide' });
  if (confidence !== undefined && !CONFIDENCE_VALUES.includes(confidence))
    return res.status(400).json({ error: 'Confiance invalide' });
  try {
    writeAnnotation(image_id, annotation, annotateur, lesions || {}, confidence !== undefined ? confidence : 1.0);
    console.log(`[API] Annote : ${image_id} -> ${annotation} (${annotateur}) conf=${confidence}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Impossible de sauvegarder' }); }
});

// Export enrichi (admin uniquement côté client)
app.get('/api/export', (req, res) => {
  if (!fs.existsSync(XLSX_PATH)) return res.status(404).json({ error: 'Aucun fichier' });
  try {
    const rows = readAllRows();
    const exportRows = rows.map(row => ({
      image_id:   row.image_id,
      grade:      row.grade !== '' ? Number(row.grade) : (GRADE_TO_INT[row.annotation] !== undefined ? GRADE_TO_INT[row.annotation] : ''),
      MA:         Number(row.MA   || 0),
      HEM:        Number(row.HEM  || 0),
      HE:         Number(row.HE   || 0),
      CWS:        Number(row.CWS  || 0),
      IRMA:       Number(row.IRMA || 0),
      VA:         Number(row.VA   || 0),
      NV:         Number(row.NV   || 0),
      confidence: Number(row.confidence || 1.0),
      annotator:  row.annotateur,
    }));

    const wb = XLSX.utils.book_new();
    const headers = ['image_id', 'grade', 'MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA', 'NV', 'confidence', 'annotator'];
    const sheet = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    XLSX.utils.book_append_sheet(wb, sheet, 'Annotations');

    const tmpPath = path.join(DATA_DIR, 'annotations_export.xlsx');
    XLSX.writeFile(wb, tmpPath);
    res.download(tmpPath, 'annotations_data.xlsx');
  } catch (err) {
    res.status(500).json({ error: 'Erreur export' });
  }
});

app.post('/api/delete-image', (req, res) => {
  const { image_id, annotateur } = req.body;
  if (!image_id || !annotateur) return res.status(400).json({ error: 'Parametres requis' });
  const safeName = path.basename(image_id);
  const srcPath  = path.join(imagesDir(annotateur), safeName);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Image introuvable' });
  const bDir = blurryDir(annotateur);
  if (!fs.existsSync(bDir)) fs.mkdirSync(bDir, { recursive: true });
  try {
    fs.renameSync(srcPath, path.join(bDir, safeName));
    if (fs.existsSync(XLSX_PATH)) {
      const wb = XLSX.readFile(XLSX_PATH);
      const sheet = wb.Sheets[SHEET_NAME];
      if (sheet) {
        let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows = rows.filter(r => !(r.image_id === safeName && r.annotateur === annotateur));
        const headers = ['image_id', 'annotation', 'grade', 'MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA', 'NV', 'confidence', 'annotateur'];
        wb.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(rows, { header: headers });
        XLSX.writeFile(wb, XLSX_PATH);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Impossible de deplacer l'image" }); }
});

app.post('/api/restore-images', (req, res) => {
  const { annotateur } = req.body;
  if (!annotateur) return res.status(400).json({ error: 'Parametre annotateur requis' });
  const bDir = blurryDir(annotateur);
  if (!fs.existsSync(bDir)) return res.json({ success: true, restored: 0 });
  const EXT = ['.jpg','.jpeg','.png','.bmp','.tiff','.tif','.webp'];
  try {
    const files = fs.readdirSync(bDir).filter(f => EXT.includes(path.extname(f).toLowerCase()));
    if (files.length === 0) return res.json({ success: true, restored: 0 });
    const iDir = imagesDir(annotateur);
    if (!fs.existsSync(iDir)) fs.mkdirSync(iDir, { recursive: true });
    let count = 0;
    for (const file of files) { fs.renameSync(path.join(bDir, file), path.join(iDir, file)); count++; }
    res.json({ success: true, restored: count });
  } catch (err) { res.status(500).json({ error: 'Impossible de restaurer' }); }
});

app.post('/api/reset', (req, res) => {
  const { annotateur } = req.body;
  try {
    if (fs.existsSync(XLSX_PATH)) {
      const wb = XLSX.readFile(XLSX_PATH);
      const sheet = wb.Sheets[SHEET_NAME];
      if (sheet) {
        let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows = annotateur ? rows.filter(r => r.annotateur !== annotateur) : [];
        const headers = ['image_id', 'annotation', 'grade', 'MA', 'HEM', 'HE', 'CWS', 'IRMA', 'VA', 'NV', 'confidence', 'annotateur'];
        wb.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(rows, { header: headers });
        XLSX.writeFile(wb, XLSX_PATH);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Impossible de reinitialiser' }); }
});

app.get('/api/dashboard', (req, res) => {
  try {
    const rows  = readAllRows();
    // Dashboard : uniquement les annotateurs (pas l'admin)
    const annotatorList = ANNOTATORS.filter(a => a.role === 'annotator');
    const stats = {};
    for (const ann of annotatorList) {
      stats[ann.name] = { total: 0, classes: {} };
      for (const cls of VALID_CLASSES) stats[ann.name].classes[cls] = 0;
    }
    for (const row of rows) {
      const ann = row.annotateur; const cls = row.annotation;
      if (!ann || !cls) continue;
      if (!stats[ann]) { stats[ann] = { total: 0, classes: {} }; for (const c of VALID_CLASSES) stats[ann].classes[c] = 0; }
      if (VALID_CLASSES.includes(cls)) { stats[ann].classes[cls]++; stats[ann].total++; }
    }
    const grandTotal = { total: 0, classes: {} };
    for (const cls of VALID_CLASSES) grandTotal.classes[cls] = 0;
    for (const ann of Object.keys(stats)) {
      grandTotal.total += stats[ann].total;
      for (const cls of VALID_CLASSES) grandTotal.classes[cls] += stats[ann].classes[cls] || 0;
    }
    res.json({ annotators: annotatorList.map(a => a.name), classes: VALID_CLASSES, stats, grandTotal });
  } catch (err) { res.status(500).json({ error: 'Erreur dashboard' }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\nRetAnnot demarree -> http://localhost:${PORT}`);
  console.log(`   Utilisateurs :`);
  ANNOTATORS.forEach(a => {
    if (a.role === 'annotator') {
      const dir = imagesDir(a.name);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    console.log(`     - ${a.name} (${a.username}) [${a.role}]`);
  });
  console.log('');
});