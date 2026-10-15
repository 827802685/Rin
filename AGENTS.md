# AGENTS.md - Rin Project Guidelines

## Build Commands

```bash
# Development (Rin CLI is the entry point: cli/bin/rin.ts)
cp .env.example .env.local   # fill in values, then generate local config files
bun run dev:setup           # generate wrangler.toml, .dev.vars, client/.env from .env.local
bun run dev                 # Start both client and server
bun run dev:client          # Client only (Vite + React)
bun run dev:server          # Server only (Wrangler dev server on port 11498)
bun run dev:cron            # Server with cron triggers enabled (wrangler --test-scheduled)

# Building
bun run build               # build:client (vite build) then build:server (wrangler --dry-run)
bun run build:all           # turbo build across workspaces
bun run check               # turbo check -> runs the `check` script (client, server, cli only)

# Database (using Rin CLI)
bun run db:generate         # Generate Drizzle migrations (server workspace, drizzle-kit)
bun run db:migrate          # Run local database migrations
bun run db:fix              # One-off schema fix (fix-top-field)

# Formatting
bun run format:check        # turbo format:check -> currently executes 0 tasks (see below)
bun run format:write        # same: no workspace defines these scripts

# Deployment (using Rin CLI)
bun run deploy              # Build client, then deploy the Worker with ./dist/client as its [assets] directory
bun cli/bin/rin.ts deploy --server   # Worker only (skips the client build)
bun cli/bin/rin.ts deploy --client   # Explicit Pages path: wrangler pages deploy dist/client
bun cli/bin/rin.ts deploy --preview  # Preview deploy (adds observability, no cron triggers)

# Release (using Rin CLI)
bun run release <version>   # Create a new release (patch/minor/major/x.y.z)

# Testing
# Tests are per workspace; run them from inside the workspace.
cd server && bun run test   # bun:test  (also: bun run test:server from the root)
cd client && bun run test   # vitest   (root has no script that runs client tests)
cd server && bun run test:coverage
cd client && bun run test:coverage
```

`wrangler.toml`, `.dev.vars` and `client/.env` are generated files (gitignored).
Do not hand-edit them: change `.env.local` and re-run `bun run dev:setup`
(or let `cli/src/tasks/{setup-dev,deploy-cf}.ts` regenerate them).

### Documented but not actually wired (verified against the code)

Do not trust these from older docs; they were re-checked on 2026-10-09:

- `bun run format:check` / `bun run format:write` resolve to `turbo format:*`, and
  **no workspace defines a `format` script** (prettier is not a dependency). The run
  reports "0 tasks" and exits 0, so CI's `format-check` job enforces nothing.
- There are no root `deploy:server` / `deploy:client` scripts; use
  `bun cli/bin/rin.ts deploy --server|--client`. `PAGES_NAME` is not read by any code.
- Root `bun run test` / `bun run test:coverage` are misleading: they glob every
  workspace with `bun test`, so `packages/api` and `cli` tests run fine but the
  client's Vitest files run without jsdom and fail. Use the per-workspace commands.
- `turbo run check` skips the three `packages/*` packages because they name their
  script `typecheck`.

### Deploying to Cloudflare — gotchas found while doing a real deploy (2026-10-09)

- **Bun auto-loads `.env.local` from the current directory**, and `cli/src/tasks/deploy-cf.ts`
  reads `WORKER_SECRET_KEYS` straight from `process.env`. So any secret key written in
  `.env.local` *will* be pushed to the Worker, even if the calling shell `unset`s it first.
  Keep `JWT_SECRET` / `ADMIN_*` / `RIN_GITHUB_CLIENT_*` / `S3_*_KEY*` out of the repo
  directory entirely (a file outside the worktree works fine, e.g. `~/work/rin-secrets.env`);
  suppression has to happen in the file, not the shell. Overwriting `JWT_SECRET`
  silently invalidates every logged-in session.
- `setup-dev` exits early if required vars are blank (`NAME`, `AVATAR`,
  `RIN_GITHUB_CLIENT_ID`, `RIN_GITHUB_CLIENT_SECRET`, `JWT_SECRET`, plus `S3_*` when
  `R2_BUCKET_NAME` is unset), so `bun run dev` needs those filled in even though
  `deploy` tolerates them being empty.
- `bun run build:server` at the repo root fails with "Wrangler application detection
  … run in the root of a workspace, this is not supported" unless a `wrangler.toml`
  exists — it is a generated file, so run `bun cli/bin/rin.ts setup-dev` (or `deploy`,
  which generates it) first.
- `cd client && bun run build` can stay alive after printing "✓ built in …" (idle
  `bun`/`vite` processes); `deploy` reuses `./dist/client` when
  `dist/client/index.html` is already there, so wrap the build in `timeout` or skip it.

## Rin CLI

The project uses a unified CLI tool located at `cli/bin/rin.ts`. Command implementations live under `cli/src/{commands,tasks,lib}`.

### CLI Commands
- `bun cli/bin/rin.ts dev [options]` - Start development server
- `bun cli/bin/rin.ts setup-dev` - Generate `wrangler.toml`, `.dev.vars`, `client/.env` from `.env.local`
- `bun cli/bin/rin.ts deploy [options]` - Deploy to Cloudflare (`--server`, `--client`, `--preview`)
- `bun cli/bin/rin.ts db migrate` - Run database migrations
- `bun cli/bin/rin.ts release <version>` - Create a new release

## Architecture Status

This repository is a product monorepo, not a framework monorepo.

- `rin` should learn from `~/projects/rine` on module boundaries and type discipline.
- `rin` should NOT blindly copy `rine`'s `contracts/core/renderer/adapters/apps` layout.
- The current repository still centers around a concrete app: React frontend, Cloudflare Worker backend, shared API package, and local CLI tooling.
- If a change improves directory symmetry but does not improve dependency boundaries, it is usually the wrong refactor.

### Current Reality

- `client/` is the web application, not a reusable package.
- `server/` is the Worker application, not a generic framework core.
- `packages/api/` (`@rin/api`) is the stable shared package for API contracts: schemas, runtime validators, and transport-facing types.
- `packages/ui/` (`@rin/ui`) is a real workspace package: its own `package.json`, `tsconfig.json`, explicit `exports` (`"." -> ./src/index.ts`), a `typecheck` script, and consumers in `client/`.
- `packages/config/` (`@rin/config`) is a real workspace package holding shared config keys, defaults, and parsing; it is consumed by both `client/` and `server/` and also exposes only a `typecheck` script.
- `cli/` is an engineering tool for this repo, not a runtime dependency of the product.
- Note the naming mismatch: `turbo run check` executes a script named `check`, which exists in `client/`, `server/` and `cli/` only. The three shared packages (`@rin/api`, `@rin/ui`, `@rin/config`) expose `typecheck`, so `bun run check` does **not** cover them — run `cd packages/<name> && bun run typecheck` when touching them. `@rin/api` exposes its own `test` script (`bun test`, 19 passing tests) that no root or CI script invokes — though those same files do execute when `bun test` is globbed from the repo root.

### Runtime Wiring That Already Exists

Verified against the code; treat this as the current contract before refactoring:

- One Worker entrypoint: `server/src/_worker.ts` exports `fetch`, `scheduled`, and `queue`, delegating to `server/src/runtime/{fetch,queue,scheduled}-handler.ts`; `createHonoApp()` (`core/hono-app.ts`) assembles middlewares, routes, then error handlers.
- Routes are Hono sub-apps: each feature service function returns a `Hono` instance, and `core/register-routes.ts` mounts them with `app.route("/<domain>", XService())`.
- `server/src/runtime/fetch-handler.ts` owns the front-of-house routing: syndication/SEO paths at the root go to the app, `/api/*` is rewritten (the `/api` prefix is stripped) into the app, `favicon` paths go to the app, other dotted paths are fetched from `env.ASSETS`, and everything else falls back to the bundled `index.html`. SPA fallback therefore lives in the Worker, not in the `[assets] not_found_handling` option (which only the generated dev `wrangler.toml` sets).
- The frontend is served **by the Worker as static assets** (`[assets] directory = "./dist/client"`, `binding = "ASSETS"`). Cloudflare Pages is only used for two things: the docs site (`docs/`, via `.github/workflows/docs.yml`) and the explicit `rin.ts deploy --client` escape hatch.
- Client config is injected synchronously before React boots: `client/index.html` loads `/api/config/client/bootstrap.js` (served by `services/config.ts`), which sets `globalThis.__RIN_CLIENT_CONFIG__`.
- Database: D1 through Drizzle (`drizzle-orm/d1`). Migrations are hand-written SQL in `server/sql/0000.sql … 0012.sql`; applied versions are tracked in the `info` table, not by drizzle-kit journal.
- Async work goes through the `TASK_QUEUE` binding (AI summary / cache-clearing consumers); cron is `*/20 * * * *`.
- R2 is optional (`[[r2_buckets]]` only when `R2_BUCKET_NAME` is set); storage otherwise uses the S3-compatible path.
- Live2D models: `client/src/components/theme/live2d/models.ts` holds `BUILTIN_MODELS` as the single source. A moc3 larger than the Pages 25MiB limit (furina, ~95MB) is served from a remote CDN instead of being bundled.
- Live2D widget *engine* (7 files: waifu.css, waifu-tips.js, waifu-tips.json, live2d.min.js, live2dcubismcore.min.js, chunk/index.js, chunk/index2.js) is mirrored into `dist/client/live2d-widget/dist/` at build time (`client/vite.config.ts` → `rinLive2dEngineBundle`; downloads cached in `client/.live2d-engine/`, gitignored; the dev server serves the same path from `rinLive2dEngineDevMiddleware`). Runtime resolves that same-origin root first and falls back to `https://827802685.github.io/Live2D/dist/` — see `client/src/components/theme/live2d/engine.ts`. Keep the `chunk/` directory level: the chunks import each other by relative path.

### Refactor Direction

When restructuring, prefer this target shape over a direct clone of `rine`:

```text
rin/
├── apps/
│   ├── web/            # current client app
│   └── worker/         # current server app
├── packages/
│   ├── api/            # shared request/response types and schemas
│   ├── ui/             # real reusable UI primitives and markdown-related UI
│   ├── web-core/       # app shell, providers, routing, layout composition
│   ├── server-core/    # app assembly, middleware, route registration, env typing
│   └── config/         # shared config keys, defaults, parsing, client-safe views
├── tools/
│   └── cli/            # current CLI moved only when boundaries are stable
```

This is a direction, not a mandate to rename everything immediately.

## Refactor Guardrails

All agents must follow these rules for architecture work:

1. Do not start by renaming `client/` to `apps/web` or `server/` to `apps/worker`.
2. Do not create empty framework-style packages just to mirror `rine`.
3. Do not introduce a `renderer` package unless the app actually gains SSR or shared rendering orchestration.
4. Do not split every server utility into `adapters/*` packages unless there are at least two credible implementations or an immediate runtime boundary that justifies it.
5. Do not move code across the repo solely for aesthetics if imports, tests, and ownership get worse.

### Required Refactor Order

For any substantial restructure, agents should work in this order:

1. Stabilize boundaries.
   - Create real workspace packages before migrating code into them.
   - Add missing package manifests, tsconfig files, and explicit exports.
   - Introduce a root TypeScript base config before broad moves.
2. Extract shared logic.
   - Move truly shared UI into `packages/ui`.
   - Move shared config models and parsing into a dedicated shared package.
   - Keep app-specific composition in the app layer.
3. Simplify application entrypoints.
   - Split frontend bootstrap, providers, routes, and layout composition.
   - Split backend app assembly, middleware registration, and runtime entry handling.
4. Rename directories only after the dependency graph is cleaner.

If a proposed refactor skips step 1 and jumps to step 4, it should be treated as suspect.

## Layering Rules

### Frontend

- `client/src/App.tsx` is already composition only. The app shell lives in `client/src/app/`: `providers.tsx`, `routes.tsx`, `use-app-bootstrap.ts`, plus `bootstrap.ts` / `bootstrap-config.ts` / `runtime.ts`. `App.tsx` just wires providers, routes and `ThemeWidgets`. Keep it that way — do not push bootstrap logic back into `App.tsx`.
- Page initialization, session loading, config hydration, and permission gating belong in those modules; `client/src/page/*` is still the largest surface and where new coupling tends to appear.
- Heavy third-party renderers must stay off the first-paint chunk: `client/src/utils/mermaid-render.ts` lazy-imports `mermaid` only when a `pre.mermaid_default` / `pre.mermaid_dark` node exists in the DOM. Follow the same pattern for other large optional deps instead of importing them statically in a page.
- Reusable presentational components belong in `packages/ui` only when they are app-agnostic.
- Components that depend on `client` state containers, Wouter routing, or app-specific permissions should remain in the app layer.

### Backend

- `server/src/core` currently acts as app assembly, not framework core. Keep that distinction explicit.
- Route registration, middleware wiring, error mapping, and runtime entrypoints should be separated when refactoring.
- Business services stay close to the app until a stable abstraction clearly exists.
- Shared contracts and config types should move out before shared behavior moves out.

### Shared Packages

- `packages/api` is for shared API contracts, schemas, validators, and transport-facing types.
- Shared packages must not depend on `client/` or `server/` application modules.
- Shared packages should expose explicit entrypoints and avoid deep relative imports from consumers.

## Required Checks Before Structural Changes

Before any non-trivial reorganization, agents must do all of the following:

1. Read this `AGENTS.md`.
2. Inspect the current package/workspace manifests.
3. Search for all imports of the modules being moved.
4. Verify whether the target package already has a real manifest and public entrypoint.
5. Explain why the destination layer is better than the current one.

If those checks are not done, the refactor is not ready.

## Anti-Patterns

Avoid these common mistakes:

- Copying `rine` abstractions into `rin` without a product need.
- Moving files into `packages/` while still importing app internals from them.
- Creating `core` modules that actually contain product-specific assembly.
- Mixing sensitive server-only configuration logic with client-safe config views.
- Leaving half-migrated directories that look shared but are not buildable or imported anywhere.

## Testing

Both workspaces have tests; the server suite is the larger one (537 `bun:test`
cases at the time of writing, the client suite is Vitest). Coverage is
concentrated in services, utilities and route-level contracts — page-level
client components are the thin spot, so do not describe the suite as complete.

### Client Tests (Vitest)
- **Location**: `client/src/**/__tests__/*.test.ts`
- **Runner**: Vitest with jsdom environment
- **Commands**:
  ```bash
  cd client && bun run test          # Run tests once
  cd client && bun run test:watch    # Watch mode
  cd client && bun run test:coverage # With coverage report
  ```

### Server Tests (Bun)
- **Location**: `server/src/**/__tests__/*.test.ts`, `server/tests/`
- **Runner**: Bun's native test runner (`bun:test`)
- **Commands**:
  ```bash
  cd server && bun run test          # Run tests once
  cd server && bun run test:coverage # With coverage report
  ```

### Do not run tests from the repo root
- `bun run test` at the root expands to `bun test`, which globs *every* workspace
  and runs client Vitest files under `bun:test` with no jsdom. Measured on this
  checkout: 781 tests collected, 24 failures — all of them client DOM/clipboard/
  localStorage tests that pass under `cd client && bun run test`.
- CI never runs it either: `.github/workflows/test.yml` runs `bun run test`
  separately with `working-directory: ./server` and `./client`.
- Coverage is **not runnable as-is**: `cd client && bun run test:coverage` fails with
  `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` (no coverage provider is a
  dependency, and `client/vitest.config.ts` has no `coverage` block). `bun test --coverage` on the
  server only prints a table — neither side produces the `lcov.info` files the workflow's Codecov
  step uploads.
- Two `test.yml` jobs are misconfigured and should not be trusted as signals:
  `format-check` runs the root `bun run format:check`, which resolves to `turbo format:*`, matches
  no workspace script and exits 0 (always green); `coverage` runs the root `bun run test:coverage`,
  i.e. the broken glob above.

### Test Structure
- Unit tests for services, utilities, and core functionality
- Integration tests for API endpoints
- Security tests for mock isolation
- Fixtures and mocks in `server/tests/fixtures/`
- `server/src/core/__tests__/error-response.test.ts` pins the error JSON contract
  (`code` / `message` / `status` / `requestId`) that `client/src/components/error-boundary.tsx`
  parses; change the shape there, and that test is the first thing to break.
- Bun's `mock.module` leaks across test files and `mock.restore()` cannot undo it.
  Server code that must be stubbed in tests is therefore injected (see
  `server/src/runtime/fetch-handler.ts` and `scheduled-handler.ts`).

## Code Style Guidelines

### TypeScript

- **Target**: ESNext with ESNext modules
- **Strict mode**: Enabled
- **Module resolution**: `bundler` mode
- **JSX**: `react-jsx` transform
- Allow importing `.ts` extensions directly
- Skip lib check for faster builds
- Unused locals/parameters: NOT enforced (set to false in server, true in client)

### Imports

```typescript
// External imports first (alphabetical)
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";

// Internal imports (alphabetical, real modules from this repo)
import type { AppContext, Variables } from "../core/hono-types";
import { BadRequestError } from "../errors";
import { users } from "../db/schema";
```

Order of groups is external → workspace (`@rin/*`) → relative. Alphabetical order
within a group is the intent, not enforced; `services/user.ts` still leads with
`hono`. Match the file you are editing rather than reordering unrelated lines.

There is no `core/router` module and no `Router` type: routing is Hono. Do not
write import examples against modules that do not exist.

### Naming Conventions

- **Files**: kebab-case (e.g., `feed_card.tsx`, `ai-config.ts`)
- **Components**: PascalCase (e.g., `FeedCard`, `ErrorBoundary`)
- **Functions**: camelCase (e.g., `FeedService`, `createClient`)
- **Types/Interfaces**: PascalCase (e.g., `ServiceLoader`, `Context`)
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Database tables**: snake_case in schema

### React Components

- Use functional components with hooks
- Props interface defined inline or as separate type
- Use `useMemo` for expensive computations
- Use `useTranslation()` hook for i18n
- Error boundaries wrap the app

### Server (Cloudflare Workers)

- Service pattern: each feature is a function that **returns a `Hono` instance**
  (`export function FeedService(): Hono { ... }`), and `core/register-routes.ts`
  mounts it with `app.route("/feed", FeedService())`. Services take no `Router`
  argument.
- Handlers receive the typed context (`c: AppContext`) and respond through Hono
  (`c.json`, `c.text`, `c.status`); shared state comes from `c.get("db")`,
  `c.get("cache")`, `c.get("jwt")`, `c.get("env")`.
- Lazy loading for heavy dependencies (WordPress import modules)
- Database via Drizzle ORM over D1 (`drizzle-orm/d1`)
- Caching via the custom `CacheImpl` utility

### Commit Messages

Must follow conventional commits format:
```
feat: add new feature
chore: update dependencies
fix: resolve bug
docs: update documentation
ci: update CI configuration
style: formatting changes
test: add tests
pref: performance improvements
```

Setup the commit hook:
```bash
ln -s ../../cli/templates/git-commit-msg.sh .git/hooks/commit-msg
```

The hook is opt-in (nothing installs it — there is no husky/lint-staged dependency and no
`core.hooksPath`). It runs `bun check` (= `turbo check`, so `packages/*` are not covered) and
greps the message for `feat|chore|fix|docs|ci|style|test|pref: `. It never runs tests or any
linter, so type checks and per-workspace test runs are your responsibility.

### Error Handling

- Server: business code throws the classes in `server/src/errors` (e.g.
  `BadRequestError`, `RateLimitError`), and `server/src/core/error-response.ts`
  turns any throw into the single wire shape
  `{ success: false, error: { code, message, status, requestId, details? } }`.
  Successful responses set their code with `c.status(...)` / `c.json(...)`; there
  is no `set.status` API in this codebase.
- `requestId` reuses `x-request-id` / `cf-ray` when present and is echoed back in
  the `X-Request-Id` response header, so a user report can be matched to
  `wrangler tail` output (5xx errors log one structured `[rin:error]` line).
- The old `core/error-handler.ts` (a second, unused error pipeline with an
  in-process log cache) and the orphaned `core/types.ts` were removed on
  2026-10-08; do not reintroduce a parallel handler.
- Client: error boundaries (`GlobalErrorBoundary` in
  `client/src/components/error-boundary.tsx`) and its `parseApiError` read
  `error.code / status / requestId / details`. The app's own transport helper
  (`client/src/api/client.ts`) flattens a failed response to
  `{ error: { status, value: string } }` and returns it rather than throwing, so
  page code still has to check `error` on every result.
- TypeScript strict null checks enabled

### Project Structure

```
rin/
├── client/              # React + Vite frontend (workspace "client")
│   ├── src/
│   │   ├── api/                # hand-written typed transport (`api/client.ts`)
│   │   ├── app/                # app shell: providers, routes, bootstrap, runtime
│   │   ├── components/         # components, incl. components/theme/live2d/*
│   │   ├── hooks/  state/      # hooks + Context-based state containers
│   │   ├── page/               # route pages (largest files in the app)
│   │   ├── remark/  utils/     # markdown pipeline + helpers (mermaid-render.ts)
│   │   └── vendors/            # vendored third-party code
│   └── vite.config.ts          # custom plugins incl. live2d local CDN + monaco shim
├── server/              # Cloudflare Worker backend
│   ├── src/
│   │   ├── _worker.ts          # fetch / scheduled / queue entrypoints
│   │   ├── runtime/            # fetch/queue/scheduled handlers, app instance
│   │   ├── core/               # hono-app, register-*, middleware, error-response
│   │   ├── services/           # feature sub-apps (each returns a Hono instance)
│   │   ├── db/                 # Drizzle schema
│   │   ├── errors/             # AppError classes + ErrorResponse shape
│   │   ├── queue/  polyfills/  # TASK_QUEUE consumers, DOMParser shim
│   │   └── utils/              # cache, s3, jwt, ai, wordpress import, ...
│   └── sql/                     # hand-written migrations 0000.sql … 0012.sql
├── packages/
│   ├── api/               # @rin/api: schemas, runtime validators, shared types
│   ├── ui/                # @rin/ui: app-agnostic UI primitives (exports ./src/index.ts)
│   └── config/            # @rin/config: shared config keys, defaults, parsing
├── cli/                   # Rin CLI (bin/rin.ts, src/{commands,tasks,lib})
├── scripts/               # compatibility wrappers around CLI tasks
├── docs/                  # Rspress documentation (deployed to GitHub Pages)
├── models/                # Live2D model bundled into the client build (BCSZ1.1)
└── theme/                 # Live2D source material + vendored Hexo theme; NOT read by the build
```

Generated / gitignored (never commit): `wrangler.toml`, `.dev.vars`, `client/.env`,
`dist/`, `.env.local`. Regenerate with `bun run dev:setup`.

### Key Technologies

- **Client**: React 18, Vite, TailwindCSS, Wouter (routing), i18next, Monaco, Vitest
- **Server**: Hono, Drizzle ORM (`drizzle-orm/d1`) over Cloudflare D1, Workers AI,
  R2/S3-compatible storage, `bun:test`
- **Shared**: `@rin/api` (contracts + validators), `@rin/ui`, `@rin/config`
- **Package Manager**: Bun (only `bun.lock`; `packageManager: bun@1.3.13`)
- **Build**: Turbo for `check` / `build:all` / `format:*`; `bun run build` itself is
  plain client + server builds
- **Testing**: Vitest (client), Bun native test runner (server)
