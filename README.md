# LexiGarden

Local-first English vocabulary practice app built with React, Vite, TypeScript, and IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite in your browser.

## Features

- Add English + translated words with optional group, text hint, and image hint
- Study by all words, last added, group, less known, or less seen
- Flexible answer checking with consecutive-correct mastery tracking
- Review history, daily snooze, export/import backup, and local stats
- Optional OpenRouter AI for sentence hints, related word suggestions, and vocabulary-aware chat

## AI setup

1. Open **Settings** inside the app.
2. Add your OpenRouter API key.
3. Refresh models and choose a model.
4. Save settings and test the connection.

Your API key stays in local browser storage and is excluded from exported backups by default.
