# Deployment

## Build and local preview

```sh
npm ci
npm run build
npm run preview
```

The build outputs `dist/`. Vite is configured with relative asset base `./`, ES2020 build target and source maps. A static host can serve those assets at its configured path; use the URL printed by preview when verifying locally.

## Static hosting versus local services

The browser runs the simulation. Hosting the files does not keep a user's town running after the tab closes, supply an authoritative multiplayer world, or introduce server-side persistence. Background tabs remain subject to browser throttling. Long-running server-side simulation would require a separate runtime and state boundary.

The `/lm` proxy and `/__mapnow` writer are Vite server/preview configuration, not JavaScript embedded in `dist/`:

| Service | Local dev/preview | Static deployment |
| --- | --- | --- |
| Scene and simulation | Browser runs the app | Browser runs the app |
| `/lm/v1` | Forwards to `http://localhost:1234/v1` from the Vite server | Needs a separately configured proxy/gateway or direct compatible adapter |
| `/__mapnow` | Writes to the project's `MapNow/` folder | Needs a compatible writer service; static hosting cannot write that folder |
| Settings | Browser localStorage | Browser localStorage scoped to the deployed origin |

A proxy on a hosted server reaches that server's localhost, not each user's machine. For users supplying their own local models, a direct browser-to-local adapter needs the model server's permitted origins and the browser's network/security rules to allow the request. Another approach is a local companion gateway. Test the target browser/server setup; do not assume the development proxy automatically travels with the static build.

## Hosted model gateway

An external inference gateway should accept the provider contract, enforce request-size/rate/access controls, honor cancellation and return normalized chat completions. Keep hosted-provider credentials on that server. Frontend source and static bundles are visible to users, and the present Settings modal has no API-key vault.

The app requests five ministers concurrently before synthesis. Account for that request pattern when setting gateway concurrency and model capacity. The default per-request abort budget is 20 seconds; a model/server unable to complete under it will produce failed/deferred sittings.

## Publishing this source

GitHub repository visibility and website deployment are separate operations. A public repository shares source/docs and their committed history; it does not deploy `dist/` or start a model service. There is currently no GitHub Pages publishing workflow in the repository.

No `LICENSE` file is currently provided. Public visibility alone does not grant an open-source licence. Choose and add a licence before advertising licensed reuse rights.
