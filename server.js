/**
 * server.js — Backend Express pour RetAnnot
 * Gère : images, annotations (avec annotateur), dashboard, suppression, restauration
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;

const IMAGES_DIR = path.join(__dirname, 'images');
const BLURRY_DIR = path.join(__dirname, 'images_floues');
const DATA_DIR   = path.join(__dirname, 'data');
const XLSX_PATH  = path.join(DATA_DIR, 'annotations.xlsx');
const SHEET_NAME = 'Annotations';

// Liste des annotateurs (à personnaliser)
const ANNOTATORS = [
  'Dr El Bakkali',
  'Dr Boulanouar',
  'Dr El Moussaif',
  'Dr El Arabi',
  'Dr Essafi',
  'Dr Zekraoui',
  'Dr Hafidi',
];

// 8 classes valides
const VALID_CLASSES = [
  'No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR',
  'Impacts laser', 'Autre pathologie', 'Mauvaise qualité',
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(IMAGES_DIR));

// ─── Helpers Excel ───────────────────────────────────────────────────────────

/**
 * Lit toutes les annotations depuis le fichier Excel.
 * Retourne un tableau de { image_id, annotation, annotateur }
 */
function readAllRows() {
  if (!fs.existsSync(XLSX_PATH)) return [];
  try {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheet    = workbook.Sheets[SHEET_NAME];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (err) {
    console.error('[Excel] Erreur lecture :', err.message);
    return [];
  }
}

/**
 * Retourne les annotations d'un annotateur donné : { image_id: annotation }
 */
function readAnnotationsForUser(annotateur) {
  const rows   = readAllRows();
  const result = {};
  for (const row of rows) {
    if (row.image_id && row.annotateur === annotateur) {
      result[row.image_id] = row.annotation || '';
    }
  }
  return result;
}

/**
 * Écrit (ou met à jour) une annotation pour un annotateur donné.
 */
function writeAnnotation(imageId, annotation, annotateur) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let workbook;
  if (fs.existsSync(XLSX_PATH)) {
    workbook = XLSX.readFile(XLSX_PATH);
  } else {
    workbook = XLSX.utils.book_new();
  }

  let sheet = workbook.Sheets[SHEET_NAME];
  let rows  = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [];

  // Trouver la ligne correspondant à cet image_id ET cet annotateur
  const idx = rows.findIndex(r => r.image_id === imageId && r.annotateur === annotateur);
  if (idx >= 0) {
    rows[idx].annotation = annotation;
    rows[idx].annotateur = annotateur;
  } else {
    rows.push({ image_id: imageId, annotation, annotateur });
  }

  const newSheet = XLSX.utils.json_to_sheet(rows, {
    header: ['image_id', 'annotation', 'annotateur'],
  });
  workbook.Sheets[SHEET_NAME] = newSheet;
  if (!workbook.SheetNames.includes(SHEET_NAME)) workbook.SheetNames.push(SHEET_NAME);
  XLSX.writeFile(workbook, XLSX_PATH);
}

// ─── Routes API ───────────────────────────────────────────────────────────────

/**
 * GET /api/annotators
 * Retourne la liste des annotateurs configurés
 */
app.get('/api/annotators', (req, res) => {
  res.json({ annotators: ANNOTATORS });
});

/**
 * GET /api/images
 */
app.get('/api/images', (req, res) => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    return res.json({ images: [] });
  }
  const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'];
  try {
    const files = fs.readdirSync(IMAGES_DIR)
      .filter(f => EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    res.json({ images: files, total: files.length });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire le dossier images' });
  }
});

/**
 * GET /api/annotations?annotateur=xxx
 * Retourne les annotations d'un annotateur donné
 */
app.get('/api/annotations', (req, res) => {
  const { annotateur } = req.query;
  if (!annotateur) {
    return res.status(400).json({ error: 'Paramètre annotateur requis' });
  }
  try {
    const annotations = readAnnotationsForUser(annotateur);
    res.json({ annotations });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire les annotations' });
  }
});

/**
 * POST /api/annotations
 * Body : { image_id, annotation, annotateur }
 */
app.post('/api/annotations', (req, res) => {
  const { image_id, annotation, annotateur } = req.body;
  if (!image_id || !annotation || !annotateur) {
    return res.status(400).json({ error: 'image_id, annotation et annotateur sont requis' });
  }
  if (!VALID_CLASSES.includes(annotation)) {
    return res.status(400).json({ error: `Annotation invalide. Classes : ${VALID_CLASSES.join(', ')}` });
  }
  try {
    writeAnnotation(image_id, annotation, annotateur);
    console.log(`[API] Annoté : ${image_id} → ${annotation} (${annotateur})`);
    res.json({ success: true, image_id, annotation, annotateur });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de sauvegarder l\'annotation' });
  }
});

/**
 * GET /api/export
 */
app.get('/api/export', (req, res) => {
  if (!fs.existsSync(XLSX_PATH)) {
    return res.status(404).json({ error: 'Aucun fichier d\'annotations trouvé' });
  }
  res.download(XLSX_PATH, 'annotations.xlsx');
});

/**
 * GET /api/dashboard
 * Retourne les stats par annotateur
 */
app.get('/api/dashboard', (req, res) => {
  try {
    const rows = readAllRows();

    // Construire les stats par annotateur
    const stats = {};

    // Initialiser tous les annotateurs configurés (même ceux sans annotation)
    for (const ann of ANNOTATORS) {
      stats[ann] = { total: 0, classes: {} };
      for (const cls of VALID_CLASSES) stats[ann].classes[cls] = 0;
    }

    // Remplir avec les données réelles
    for (const row of rows) {
      const ann = row.annotateur;
      const cls = row.annotation;
      if (!ann || !cls) continue;

      if (!stats[ann]) {
        stats[ann] = { total: 0, classes: {} };
        for (const c of VALID_CLASSES) stats[ann].classes[c] = 0;
      }

      if (VALID_CLASSES.includes(cls)) {
        stats[ann].classes[cls] = (stats[ann].classes[cls] || 0) + 1;
        stats[ann].total++;
      }
    }

    // Calculer le total global
    const grandTotal = { total: 0, classes: {} };
    for (const cls of VALID_CLASSES) grandTotal.classes[cls] = 0;
    for (const ann of Object.keys(stats)) {
      grandTotal.total += stats[ann].total;
      for (const cls of VALID_CLASSES) {
        grandTotal.classes[cls] += stats[ann].classes[cls] || 0;
      }
    }

    res.json({
      annotators: ANNOTATORS,
      classes:    VALID_CLASSES,
      stats,
      grandTotal,
    });
  } catch (err) {
    console.error('[API] Erreur dashboard :', err.message);
    res.status(500).json({ error: 'Erreur dashboard' });
  }
});

/**
 * POST /api/reset
 * Réinitialise TOUTES les annotations (tous annotateurs)
 */
app.post('/api/reset', (req, res) => {
  try {
    if (fs.existsSync(XLSX_PATH)) {
      const workbook   = XLSX.utils.book_new();
      const emptySheet = XLSX.utils.json_to_sheet([], {
        header: ['image_id', 'annotation', 'annotateur'],
      });
      XLSX.utils.book_append_sheet(workbook, emptySheet, SHEET_NAME);
      XLSX.writeFile(workbook, XLSX_PATH);
    }
    console.log('[API] ⚠️  Annotations réinitialisées');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de réinitialiser les annotations' });
  }
});

/**
 * POST /api/delete-image
 * Déplace l'image vers images_floues/ et retire son annotation
 */
app.post('/api/delete-image', (req, res) => {
  const { image_id } = req.body;
  if (!image_id) return res.status(400).json({ error: 'image_id requis' });

  const safeName = path.basename(image_id);
  const srcPath  = path.join(IMAGES_DIR, safeName);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Image introuvable' });

  if (!fs.existsSync(BLURRY_DIR)) fs.mkdirSync(BLURRY_DIR, { recursive: true });

  try {
    fs.renameSync(srcPath, path.join(BLURRY_DIR, safeName));

    // Supprimer toutes les annotations liées à cette image (tous annotateurs)
    if (fs.existsSync(XLSX_PATH)) {
      const workbook = XLSX.readFile(XLSX_PATH);
      const sheet    = workbook.Sheets[SHEET_NAME];
      if (sheet) {
        let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows = rows.filter(r => r.image_id !== safeName);
        workbook.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(rows, {
          header: ['image_id', 'annotation', 'annotateur'],
        });
        XLSX.writeFile(workbook, XLSX_PATH);
      }
    }
    console.log(`[API] 🗑️  Image déplacée : ${safeName} → images_floues/`);
    res.json({ success: true, image_id: safeName });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de déplacer l\'image' });
  }
});

/**
 * POST /api/restore-images
 * Remet les images de images_floues/ dans images/
 */
app.post('/api/restore-images', (req, res) => {
  if (!fs.existsSync(BLURRY_DIR)) return res.json({ success: true, restored: 0 });

  const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'];
  try {
    const files = fs.readdirSync(BLURRY_DIR)
      .filter(f => EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (files.length === 0) return res.json({ success: true, restored: 0 });

    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

    let count = 0;
    for (const file of files) {
      fs.renameSync(path.join(BLURRY_DIR, file), path.join(IMAGES_DIR, file));
      count++;
    }
    console.log(`[API] ♻️  ${count} image(s) restaurée(s)`);
    res.json({ success: true, restored: count });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de restaurer les images' });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🩺 RetAnnot démarrée`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → Images        : ${IMAGES_DIR}`);
  console.log(`   → Images floues : ${BLURRY_DIR}`);
  console.log(`   → Annotations   : ${XLSX_PATH}`);
  console.log(`   → Annotateurs   : ${ANNOTATORS.join(', ')}\n`);
});