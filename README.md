# Générateur de planning de garde — RecoMédicales

Application web statique (SvelteKit 3 + Svelte 5) qui génère le planning annuel de garde
d'un secteur de médecine générale, avec répartition équitable automatique, jours fériés
français, gestion des absences, échanges manuels et export Excel.

Toutes les données restent dans le navigateur (`localStorage`) : aucun serveur, aucun compte,
aucune donnée envoyée sur Internet.

---

## Fonctionnalités

### 1. Médecins & répartition

- Nom du profil et du secteur, année.
- Option **Alsace-Moselle** à la création du profil (et modifiable dans les paramètres) : ajoute le
  Vendredi saint et la Saint-Étienne (26 décembre) aux jours fériés.
- Liste des médecins : nom, téléphone, ordre, plage d'absence unique (du / au).
- Une colonne par jour (lundi–vendredi) combinant indisponibilité (max 4 jours) et préférence
  de garde (1 = jour préféré … 5 = moins préféré). Les jours fériés restent disponibles et les
  week-ends ne sont pas concernés.
- Le générateur applique un ordre de priorité strict : **équilibre du nombre total de jours**,
  puis **équilibre par catégorie**, puis **espacement**, puis **jours préférés**.
- Import CSV (`Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés`),
  ajout/suppression, réordonnancement par glisser-déposer (poignée au survol de la ligne).
- Répartition **automatique et en lecture seule** par semestre et par catégorie : semaine,
  vendredi, samedi, dimanche, veille de férié, jour férié. Le total de jours est réparti aussi
  équitablement que possible (au prorata des absences) ; un médecin qui ne peut jamais travailler
  un jour donné reçoit davantage de gardes dans les catégories qu'il peut couvrir.
- Les objectifs ne sont plus saisis à la main : ils servent de référence au générateur et aux
  rapports d'équité.

### 2. Synthèse & équité

- Totaux par semestre et sur l'année : jours, gardes, week-ends, weekdays, vendredis,
  samedis, dimanches, veilles de férié et jours fériés.
- Écart maximal à la répartition équitable, écart max par catégorie, espacement minimum et
  moyen entre deux gardes.
- Barre d'équilibre visuelle par médecin.

### 3. Calendrier

- Vue calendrier annuelle (12 mois) ou vue liste.
- Le nom du médecin est affiché dans chaque case ; clic sur une garde pour l'échanger.
- Changement de médecin directement depuis la liste, avec échange automatique de la garde
  la plus proche du même semestre (pour préserver l'équité).
- Verrouillage d'une garde : elle est conservée lors de la prochaine génération.

### 4. Par médecin

- Sélection du médecin, statistiques détaillées par semestre.
- Calendrier filtré (les gardes des autres médecins apparaissent en fondu).
- Liste de ses gardes, avec verrouillage.

### Transverse

- Export Excel de **chaque vue** (médecins/répartition, synthèse, planning, par médecin).
- Thème clair/sombre, mise en page imprimable.
- Profils multiples, duplication vers l'année suivante, sauvegarde/restauration JSON.
- Enregistrement automatique à chaque modification (debounce de 250 ms).
- Interface entièrement en français, code et identifiants en anglais.

---

## Règles de génération

| Règle                             | Détail                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Semestres                         | 01/01 → 30/06 (S1) et 01/07 → 31/12 (S2)                                                                   |
| Jours fériés                      | 11 fériés métropolitains, ou 13 avec l'option Alsace-Moselle (Vendredi saint + Saint-Étienne)              |
| Week-ends                         | Mode global par profil : **1 garde** (samedi + dimanche) ou **2 gardes** séparées                          |
| Attribution                       | 1 praticien par garde ; tous les jours de l'année sont couverts                                            |
| Équité                            | Priorité absolue : nombre total de jours identique (au prorata des absences), puis équilibre par catégorie |
| Objectifs                         | Calculés automatiquement ; les jours des médecins indisponibles un jour donné sont compensés ailleurs      |
| Espacement                        | Objectif secondaire : pénalise les gardes à moins de 14 jours, évite deux week-ends consécutifs            |
| Préférences                       | Objectif tertiaire : départage les solutions déjà équilibrées et espacées                                  |
| Absences                          | Une plage « du / au » par médecin ; un médecin absent toute l'année est exclu de la génération             |
| Prorata des absences              | Les jours dus sont réduits au prorata de la durée d'absence sur l'année                                    |
| Veille de férié                   | Un jour qui précède un férié est compté dans la catégorie « veille de férié »                              |
| Férié un vendredi/samedi/dimanche | Compté dans sa catégorie principale « férié » ; un férié en week-end compte aussi un jour de week-end      |
| Verrouillage                      | Une garde verrouillée est réattribuée au même médecin lors de la régénération                              |

Le générateur combine un remplissage glouton (priorité aux week-ends et fériés), une
recherche locale recuite (recuit simulé) déterministe pour une graine donnée, puis des passes
de réparation déterministes. Les passes égalisent d'abord le nombre total de jours, puis les
écarts par catégorie, puis l'espacement, puis les préférences. Les restes d'arrondi des
objectifs tournent entre les médecins et les jours d'un médecin indisponible un jour donné
sont compensés dans les catégories qu'il peut couvrir. Une génération annuelle prend environ
1 s pour une douzaine de médecins.

---

## Démarrage

Prérequis : **Node.js 22.17 ou supérieur** (voir `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
```

### Scripts

| Commande             | Rôle                                  |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Serveur de développement              |
| `npm run build`      | Build statique dans `build/`          |
| `npm run preview`    | Prévisualisation du build             |
| `npm run check`      | Vérification TypeScript/Svelte        |
| `npm test`           | Tests unitaires Vitest (domaine + IO) |
| `npm run test:watch` | Tests en mode watch                   |
| `npm run format`     | Formatage Prettier                    |

### Conseillé: RTK

- `winget install rtk-ai.rtk`
- `rtk init --global --opencode`

---

## Format CSV

Une ligne par médecin, séparateur `;` (ou `,` / tabulation, détection automatique).
L'en-tête est optionnel. Les colonnes `Téléphone`, `Absence du`, `Absence au`,
`Jours indisponibles` et `Jours préférés` sont optionnelles ; sans en-tête, les colonnes sont
dans l'ordre `Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés`.
Les dates d'absence utilisent le format `AAAA-MM-JJ`.

```csv
Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés
Dr Alice Martin;06 12 34 56 78;2026-03-01;2026-03-31;lun,mer;mar=1,jeu=2
Dr Benoît Petit;06 98 76 54 32;;;;ven=1
Dr Chloé Durand;06 11 22 33 44;;;ven;lun=1,mer=3
```

Le motif de jours indisponibles est annuel et ne concerne que **lundi à vendredi**.
Les jours fériés restent disponibles (ils annulent la règle hebdomadaire), mais pas les
veilles de férié. Les codes acceptés sont strictement `lun`, `mar`, `mer`, `jeu`, `ven`,
séparés par une virgule, un point-virgule, une barre oblique, une barre verticale ou des
espaces. Au maximum **4 jours indisponibles** par médecin.

Les préférences s'écrivent en paires `jour=rang` : `lun=1,mer=3`. Le rang va de **1 (jour
préféré) à 5 (jour le moins préféré)**. Les rangs doivent être uniques, portent uniquement
sur un jour disponible, et un classement partiel est accepté (les jours non renseignés sont
neutres). En cas de doublon, le premier jour (ordre lundi→vendredi) est conservé.

Les valeurs inconnues (`sam`, `dim`, `lundi`, rang hors 1–5, préférence sur un jour
indisponible, 5e jour indisponible…) sont ignorées et signalées dans l'aperçu d'import :
les valeurs valides de la ligne sont conservées.

Les dates d'absence invalides, incomplètes ou dont la fin précède le début sont ignorées et
signalées dans l'aperçu. Les anciens fichiers contenant une colonne `Exempté` ne sont **pas**
compatibles : utilisez les colonnes `Absence du` / `Absence au`.
Les guillemets sont gérés (`"Dr; A"`). Un BOM UTF-8 est ignoré.

---

## Stockage local

| Clé                    | Contenu                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `gpgm:v1:index`        | Liste des profils + profil actif                              |
| `gpgm:v1:ui`           | Onglet, thème, médecin sélectionné                            |
| `gpgm:v1:profile:<id>` | Profil complet (médecins, répartition, affectations, verrous) |
| `gpgm:v1:corrupt:<id>` | Copie de secours d'un profil illisible (quarantaine)          |

Le bouton **Données → Exporter tous les profils (.json)** produit une sauvegarde complète,
restaurable sur un autre navigateur. Vider le stockage du navigateur supprime les profils.

---

## Déploiement Netlify

Le fichier `netlify.toml` est prêt :

- commande de build : `npm run build`
- dossier publié : `build`
- Node.js 22.17 ou supérieur
- redirection SPA vers `index.html`
- en-têtes de sécurité de base

Il suffit de connecter le dépôt à Netlify, ou de lancer :

```bash
npx netlify deploy --prod
```

---

## Architecture

```
src/
├─ app.scss                 # Bootstrap + thème (variables, dark mode, impression)
├─ lib/
│  ├─ components/           # UI réutilisable (modales, calendrier, en-tête, toasts)
│  ├─ domain/               # Cœur métier sans dépendance UI
│  │  ├─ calendar.ts        # Créneaux (jours, week-ends, semestres)
│  │  ├─ holidays.ts        # Fériés français (Pâques, veilles)
│  │  ├─ generator.ts       # Greedy + recuit simulé (déterministe)
│  │  ├─ quotas.ts          # Répartition équitable, capacités
│  │  ├─ stats.ts           # Statistiques et espacement
│  │  └─ types.ts
│  ├─ io/                   # CSV, JSON, Excel, localStorage, schémas Zod
│  ├─ stores/app.svelte.ts  # Store Svelte 5 (runes), persistance, actions
│  ├─ styles/_components.scss
│  ├─ utils/                # Dates, téléchargements
│  └─ views/                # Les 4 vues
├─ routes/                  # +layout / +page (SPA prerendue)
└─ app.html
tests/                      # Vitest : fériés, calendrier, quotas, CSV, générateur
```

---

## Tests

```bash
npm test
```

La suite couvre le calcul de Pâques et des fériés, la construction des créneaux (modes
groupé/séparé, veilles, fériés en week-end), la répartition équitable, le CSV et le
générateur (remplissage complet, déterminisme, absences, équilibre du total de jours,
compensation des jours indisponibles, équité par catégorie, priorité sur les préférences,
verrous, espacement).

---

## Limites connues

- L'équilibre parfait n'est pas toujours possible : le nombre total de jours ne peut pas être
  divisé exactement (365 jours pour 12 médecins donne 30 ou 31 jours), et les gardes de
  week-end groupé comptent deux jours indivisibles. Absences, jours indisponibles et verrous
  peuvent aussi imposer un écart. Le générateur minimise l'écart total et affiche un
  avertissement lorsque l'écart aux cibles dépasse un jour.
- L'espacement est un objectif secondaire : l'équité peut rapprocher deux gardes.
- Les plannings générés avant le passage à la répartition automatique sont marqués « à
  régénérer » : leurs anciens objectifs saisis ne sont plus utilisés.
- Un jour férié en week-end compte un jour férié **et** un jour de week-end dans les
  colonnes de la synthèse ; la somme des colonnes reste égale au nombre de jours.
- L'export Excel charge ExcelJS à la demande (chunk d'environ 1 Mo) : le premier export
  peut prendre une seconde.
- Les données étant locales, elles ne sont pas synchronisées entre appareils.
