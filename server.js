/**
 * server.js — Backend Express pour l'application d'annotation rétinienne
 * Gère : listing d'images, sauvegarde/lecture des annotations (Excel)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Chemins ────────────────────────────────────────────────────────────────
const IMAGES_DIR = path.join(__dirname, 'images');
const BLURRY_DIR = path.join(__dirname, 'images_supprimer'); // Dossier pour les images "supprimées" (floues)
const DATA_DIR   = path.join(__dirname, 'data');
const XLSX_PATH  = path.join(DATA_DIR, 'annotations.xlsx');
const SHEET_NAME = 'Annotations';

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(IMAGES_DIR));

// ─── Helpers Excel ───────────────────────────────────────────────────────────

function readAnnotations() {
  if (!fs.existsSync(XLSX_PATH)) return {};
  try {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheet    = workbook.Sheets[SHEET_NAME];
    if (!sheet) return {};
    const rows   = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const result = {};
    for (const row of rows) {
      if (row.image_id) result[row.image_id] = row.annotation || '';
    }
    return result;
  } catch (err) {
    console.error('[Excel] Erreur lecture :', err.message);
    return {};
  }
}

function writeAnnotation(imageId, annotation) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let workbook;
  if (fs.existsSync(XLSX_PATH)) {
    workbook = XLSX.readFile(XLSX_PATH);
  } else {
    workbook = XLSX.utils.book_new();
  }

  let sheet = workbook.Sheets[SHEET_NAME];
  let rows  = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [];

  const idx = rows.findIndex(r => r.image_id === imageId);
  if (idx >= 0) {
    rows[idx].annotation = annotation;
  } else {
    rows.push({ image_id: imageId, annotation });
  }

  const newSheet = XLSX.utils.json_to_sheet(rows, { header: ['image_id', 'annotation'] });
  workbook.Sheets[SHEET_NAME] = newSheet;
  if (!workbook.SheetNames.includes(SHEET_NAME)) workbook.SheetNames.push(SHEET_NAME);

  XLSX.writeFile(workbook, XLSX_PATH);
}

// ─── Routes API ───────────────────────────────────────────────────────────────

/**
 * GET /api/images
 * Retourne la liste triée des fichiers image dans images/
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
    console.log(`[API] ${files.length} image(s) trouvée(s)`);
    res.json({ images: files, total: files.length });
  } catch (err) {
    console.error('[API] Erreur lecture images :', err.message);
    res.status(500).json({ error: 'Impossible de lire le dossier images' });
  }
});

/**
 * GET /api/annotations
 */
app.get('/api/annotations', (req, res) => {
  try {
    res.json({ annotations: readAnnotations() });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire les annotations' });
  }
});

/**
 * POST /api/annotations
 * Body : { image_id, annotation }
 */
app.post('/api/annotations', (req, res) => {
  const { image_id, annotation } = req.body;
  if (!image_id || !annotation) {
    return res.status(400).json({ error: 'image_id et annotation sont requis' });
  }
  const VALID_CLASSES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR'];
  if (!VALID_CLASSES.includes(annotation)) {
    return res.status(400).json({ error: `Annotation invalide. Classes : ${VALID_CLASSES.join(', ')}` });
  }
  try {
    writeAnnotation(image_id, annotation);
    console.log(`[API] Annoté : ${image_id} → ${annotation}`);
    res.json({ success: true, image_id, annotation });
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
 * GET /api/stats
 */
app.get('/api/stats', (req, res) => {
  try {
    const annotations = readAnnotations();
    const counts = {};
    for (const v of Object.values(annotations)) counts[v] = (counts[v] || 0) + 1;
    res.json({ total_annotated: Object.keys(annotations).length, by_class: counts });
  } catch (err) {
    res.status(500).json({ error: 'Erreur stats' });
  }
});

/**
 * POST /api/reset
 * Supprime toutes les annotations
 */
app.post('/api/reset', (req, res) => {
  try {
    if (fs.existsSync(XLSX_PATH)) {
      const workbook   = XLSX.utils.book_new();
      const emptySheet = XLSX.utils.json_to_sheet([], { header: ['image_id', 'annotation'] });
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
 * Body : { image_id }
 * Déplace l'image vers images_floues/ et retire son annotation
 */
app.post('/api/delete-image', (req, res) => {
  const { image_id } = req.body;
  if (!image_id) return res.status(400).json({ error: 'image_id requis' });

  const safeName = path.basename(image_id);
  const srcPath  = path.join(IMAGES_DIR, safeName);

  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'Image introuvable' });
  }

  if (!fs.existsSync(BLURRY_DIR)) fs.mkdirSync(BLURRY_DIR, { recursive: true });

  try {
    fs.renameSync(srcPath, path.join(BLURRY_DIR, safeName));

    // Supprimer l'annotation associée
    if (fs.existsSync(XLSX_PATH)) {
      const workbook = XLSX.readFile(XLSX_PATH);
      const sheet    = workbook.Sheets[SHEET_NAME];
      if (sheet) {
        let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows = rows.filter(r => r.image_id !== safeName);
        workbook.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(rows, { header: ['image_id', 'annotation'] });
        XLSX.writeFile(workbook, XLSX_PATH);
      }
    }

    console.log(`[API] 🗑️  Image déplacée : ${safeName} → images_supprimer/`);
    res.json({ success: true, image_id: safeName });
  } catch (err) {
    console.error('[API] Erreur suppression image :', err.message);
    res.status(500).json({ error: 'Impossible de déplacer l\'image' });
  }
});

/**
 * ✅ NOUVEAU : POST /api/restore-images
 * Remet toutes les images de images_floues/ dans images/
 */
app.post('/api/restore-images', (req, res) => {
  // Si le dossier images_floues/ n'existe pas, rien à faire
  if (!fs.existsSync(BLURRY_DIR)) {
    return res.json({ success: true, restored: 0 });
  }

  const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'];

  try {
    const files = fs.readdirSync(BLURRY_DIR)
      .filter(f => EXTENSIONS.includes(path.extname(f).toLowerCase()));

    if (files.length === 0) {
      return res.json({ success: true, restored: 0 });
    }

    // Créer le dossier images/ si absent
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

    let restoredCount = 0;
    for (const file of files) {
      const src  = path.join(BLURRY_DIR, file);
      const dest = path.join(IMAGES_DIR, file);
      fs.renameSync(src, dest);
      restoredCount++;
    }

    console.log(`[API] ♻️  ${restoredCount} image(s) restaurée(s) depuis images_supprimer/`);
    res.json({ success: true, restored: restoredCount });
  } catch (err) {
    console.error('[API] Erreur restauration :', err.message);
    res.status(500).json({ error: 'Impossible de restaurer les images' });
  }
});

// ─── Fallback SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🩺 Retina Annotation App démarrée`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → Dossier images        : ${IMAGES_DIR}`);
  console.log(`   → Dossier images floues : ${BLURRY_DIR}`);
  console.log(`   → Annotations           : ${XLSX_PATH}\n`);
});