# Getting started

## Install

Use Node.js 22.12 or newer, npm, Git, and a WebGL-capable browser. The app uses JavaScript ES modules, Vite and Three.js. Browser regressions use Playwright.

```sh
git clone https://github.com/abanerjee84/town-of-many-minds.git
cd town-of-many-minds
npm ci
npm run dev
```

Open the URL printed by Vite. Its configured port is 5173, but it selects another port if that one is busy. Do not open `index.html` directly from the filesystem.

## Connect the Council

The default adapter expects an OpenAI-compatible `POST /v1/chat/completions` service. A local server such as LM Studio can supply that interface.

1. Load a model in your local server and start its HTTP API at `http://localhost:1234`.
2. Keep the Vite dev server running. It proxies `/lm/v1` to the local API.
3. Open TOMM. Automatic Council is enabled by default. The first eligible scheduled sitting starts the five minister calls and the Council synthesis call.
4. Inspect the connection indicator and decision descriptions. A connected endpoint can still return invalid motions; check the intent, parameters and result rather than the indicator alone.

If your server requires an explicit model identifier, set it from the browser developer console:

```js
town.governance.setProvider('openai-compatible', {
  endpoint: '/lm/v1',
  model: 'your-loaded-model-id'
});
```

The model name is server-specific. There is no API-key or provider-selector form in the Settings modal. [Custom adapters](council.md#connecting-a-provider) support other endpoints and controlled experiments. Configuration made through these console hooks is session-local unless you provide your own persistence.

## First inspection

The founding seed defaults to 1337. Pause if you want to inspect it before the calendar advances. Fit Town follows acquired land; turn it off before manually orbiting or using fixed camera presets. The ribbon offers speeds from paused through 100×.

The left panel separates primary resource stores from daily production and consumption. Open the inspector on a building to see capacity, staffing and ownership. The Decisions, Trade, Palette and KPIs buttons open detailed views.

Without a working model, residents and existing systems remain inspectable and manual tools remain available. Public Council work is not silently commissioned by a rules fallback. Turn off Automatic LLM Council while inspecting a disconnected run to avoid repeated request waits.

## Check the installation

```sh
npm run build
npm run docs:check
npx playwright install chromium
```

With Vite running, use its actual address for browser checks:

```powershell
$env:APP_URL = 'http://localhost:5173'
npm run test:ui
npm run test:cabinet-remedy
```

On a POSIX shell, use `APP_URL=http://localhost:5173 npm run test:ui`. Script fallback ports vary; setting `APP_URL` avoids that ambiguity. See [testing](testing.md) before launching CPU-heavy horizon tests.
