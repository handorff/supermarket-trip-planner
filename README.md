# Supermarket Trip Planner

A mobile-first MBTA bus trip planner for supermarket errands. Configure home stop pairs and supermarket stop pairs in the browser, then compare single-bus outbound and return combinations with enough time to shop.

## Features

- Client-only Vite, React, and TypeScript app.
- MBTA V3 schedules with real-time predictions preferred when available.
- In-app warnings for reduced shopping buffer, delays, statuses, and alerts.
- Local setup stored in `localStorage`.
- Optional MBTA API key stored only in the current browser.
- GitHub Pages deployment workflow.

## Local Development

```sh
npm install
npm run dev
npm test
npm run build
```

The production app uses the GitHub Pages base path `/supermarket-trip-planner/`.
