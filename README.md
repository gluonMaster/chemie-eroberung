# Chemie-Eroberung

A browser-based chemistry practice game for German-speaking school settings, with Russian explanations. It combines short exercises with a hex-map conquest game and revision tools for **air as a mixture** and **water as a chemical compound**.

The project is a local learning tool aimed at grade 8 material. It is not a complete chemistry curriculum or an official assessment system.

## Features

- 55 questions: 25 on air and 30 on water.
- Eight exercise formats, including multiple choice, matching, ordering, formula entry and short answers.
- Configurable game size, question types and optional soft or strict timers.
- Explanations after mistakes, a searchable German terminology dictionary and model answers.
- Revision of previous mistakes and progress stored in the current browser.

Short written answers use guided self-assessment and terminology hints; the application does not claim to grade unrestricted prose automatically.

## Run locally

Open [chemie-trainer/index.html](chemie-trainer/index.html) in a browser. All application resources are included in the repository. There is no npm install, build step, backend, API key or account to configure.

Alternatively, if Python is available, serve the repository locally:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/chemie-trainer/`.

## Source layout

| Path | Purpose |
| --- | --- |
| [chemie-trainer/index.html](chemie-trainer/index.html) | Application entry point |
| [chemie-trainer/js/data.js](chemie-trainer/js/data.js) | Questions, terminology and model answers |
| [chemie-trainer/js/chemistry-engine.js](chemie-trainer/js/chemistry-engine.js) | Data validation, answer checking and question selection |
| [chemie-trainer/js/app.js](chemie-trainer/js/app.js) | Screens, exercise controls and game flow |
| `chemie-trainer/js/map-*.js` | Procedurally generated hex map and SVG rendering |
| [chemie-trainer/js/storage.js](chemie-trainer/js/storage.js) | Browser-local settings, session and progress |
| [chemie-trainer/js/timer.js](chemie-trainer/js/timer.js) | Exercise timer |
| `chemie-trainer/css/` | Layout and map styles |
| `chemie_klasse8_*_fragen.md` | Editable educational source material |

## Data and limitations

The application has no server-side storage or external service calls. Settings, the current game and progress use `localStorage`; they remain in that browser and are not synchronized between devices. Clearing browser storage removes them. If storage is unavailable, the application falls back to the current tab's memory.

The interface mixes Russian explanations with German chemistry vocabulary. Layout and browser interaction should be checked on the intended device before classroom use. The educational content is limited to the included topics.

## Existing checks

The chemistry engine includes a data and answer-checking self-check. After opening the application, it can be called from the browser console:

```js
ChemistryEngine.runSelfCheck(window.CHEMIE_DATA, { log: true })
```

This checks question counts, supported formats, data references and representative answer normalization. It is not a complete browser or curriculum review.

## License

No software license has been selected for this repository.
