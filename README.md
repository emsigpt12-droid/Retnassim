# RetAnnot — Application d'annotation de rétinopathie diabétique

Application web professionnelle pour l'annotation de fonds d'œil selon l'échelle DR à 5 classes.

---

## ⚡ Démarrage rapide

### 1. Installer les dépendances

```bash
cd retina-annotation-app
npm install
```

### 2. Ajouter vos images

Copiez vos images JPG/PNG dans le dossier `images/` :

```
retina-annotation-app/
└── images/
    ├── image_001.jpg
    ├── image_002.jpg
    └── ...
```

### 3. Lancer le serveur

```bash
npm start
```

Puis ouvrez http://localhost:3000 dans votre navigateur.

---

## 📁 Structure

```
retina-annotation-app/
├── images/              ← Vos images (JPG, PNG, BMP, TIFF, WebP)
├── data/
│   └── annotations.xlsx ← Généré automatiquement
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server.js
├── package.json
└── README.md
```

---

## 🩺 Classes DR

| Touche | Grade | Description |
|--------|-------|-------------|
| `1` | No DR | Pas de rétinopathie |
| `2` | Mild | Légère |
| `3` | Moderate | Modérée |
| `4` | Severe | Sévère |
| `5` | Proliferative DR | Proliférante |

---

## ⌨️ Raccourcis clavier

| Touche | Action |
|--------|--------|
| `1` – `5` | Annoter (grade 1 à 5) |
| `←` `→` | Image précédente / suivante |
| `+` `-` | Zoom |
| `0` | Réinitialiser zoom |

---

## 🔌 API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/images` | Liste des images |
| GET | `/api/annotations` | Toutes les annotations |
| POST | `/api/annotations` | Sauvegarder une annotation |
| GET | `/api/stats` | Statistiques de distribution |
| GET | `/api/export` | Télécharger le fichier Excel |

---

## 📊 Format Excel

Le fichier `data/annotations.xlsx` contient une feuille **Annotations** :

| image_id | annotation |
|----------|-----------|
| image_001.jpg | No DR |
| image_002.jpg | Moderate |

---

## 🔧 Configuration

Pour changer le port, définissez la variable d'environnement :

```bash
PORT=8080 npm start
```
