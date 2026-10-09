# Preview asset

`town-preview.png` is an actual paused seed-1337 founding town at midday, captured in a disposable Playwright browser. It contains no live provider conversation or user run.

With Vite running, regenerate it from the repository root:

```powershell
$env:APP_URL = 'http://localhost:5173'
npm run docs:preview
```

Review the result before committing. The project generally ignores generated PNG files; this deliberate documentation asset is force-added separately.
