# Phase 0 — Foundations

## Goal

A working, typed, testable monorepo with Chroma running locally and a validated
configuration boundary — before any domain code exists.

## Why now

Every later phase assumes `npm run typecheck` and `npm test` are meaningful commands. Ten
minutes of setup here removes a recurring tax from every phase that follows. It is also
the only phase with zero interesting decisions, so get it done and move on.

## Deliverables

- npm workspaces root with `apps/api` and `apps/web`
- Shared strict `tsconfig.base.json`
- `docker-compose.yml` running Chroma, reachable on `localhost:8000`
- `.env.example` and a zod-validated `env.ts`
- ESLint + Prettier
- A trivial passing test in each workspace
- `.gitignore` covering `data/`, `.env`, `node_modules`

## Key interfaces

None. This phase is scaffolding only.

## Steps

### 1. Initialise the workspace root

```bash
mkdir -p apps/api apps/web data/{raw,audio,shows}
npm init -y
```

Root `package.json`:

```json
{
  "name": "tech-radio",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "eslint .",
    "format": "prettier --write .",
    "dev:api": "npm run dev --workspace apps/api",
    "dev:web": "npm run dev --workspace apps/web",
    "chroma": "docker compose up -d"
  }
}
```

### 2. Pin the Node version

```bash
node --version > .nvmrc   # then strip the leading 'v'
```

### 3. Shared compiler options

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`noUncheckedIndexedAccess` will annoy you the first time you write `chunks[0]` and get
`Chunk | undefined`. That annoyance is the point — array indexing genuinely can be
undefined, and this project does a lot of array indexing.

### 4. Chroma via Docker Compose

`docker-compose.yml`:

```yaml
services:
  chroma:
    image: chromadb/chroma:latest
    ports:
      - "8000:8000"
    volumes:
      - ./data/chroma:/data
    environment:
      - IS_PERSISTENT=TRUE
      - ANONYMIZED_TELEMETRY=FALSE
```

Pin a concrete image tag rather than `latest` once you have a version that works.

### 5. API workspace

```bash
cd apps/api
npm init -y
npm i hono @hono/node-server zod openai chromadb rss-parser kokoro-js
npm i -D typescript tsx @types/node
```

`apps/api/package.json` scripts:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/http/server.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --test --experimental-strip-types 'src/**/*.test.ts'",
    "ingest": "tsx src/ingest/ingest.ts",
    "index": "tsx src/index/index.ts",
    "show:build": "tsx src/show/build-show.ts"
  }
}
```

If `--experimental-strip-types` is unavailable or awkward on your Node version, run tests
through `tsx` instead. Verify which works before moving on.

### 6. Web workspace

```bash
cd apps/web
npm create vite@latest . -- --template react-ts
```

Point the Vite dev server at the API:

```ts
// apps/web/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
```

The proxy means the browser never needs CORS configuration and never learns the API's
real origin. One less thing to debug.

### 7. Configuration boundary

`.env.example`:

```bash
OPENAI_API_KEY=sk-replace-me
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=replace-with-current-model-id
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=tech-radio
KOKORO_VOICE=af_heart
ENABLE_FULL_TEXT_EXTRACTION=false
PORT=3000
GITHUB_TOKEN=
```

Implement `apps/api/src/config/env.ts` exactly as specified in
[01-architecture.md](../01-architecture.md). This is the only file in the project allowed
to read `process.env`.

### 8. Ignore files

`.gitignore`:

```
node_modules/
dist/
.env
data/
*.log
.DS_Store
```

`data/` is gitignored but the directory structure matters. Add `data/.gitkeep`.

### 9. Smoke tests

One trivial test per workspace, purely to prove the runner is wired up:

```ts
// apps/api/src/config/env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

## How to verify

```bash
docker compose up -d
curl http://localhost:8000/api/v2/heartbeat   # expect a JSON heartbeat

npm run typecheck                              # clean
npm test                                       # green
npm run dev:api                                # starts, no crash
npm run dev:web                                # Vite serves on 5173
```

If the heartbeat path 404s, check the Chroma image's API version — the path has changed
between major versions (`/api/v1/heartbeat` vs `/api/v2/heartbeat`). Note the correct one
for your image; the Chroma adapter in Phase 2 will need it.

## Learning checkpoints

- Why must the OpenAI key exist only in `apps/api` and never in `apps/web`?
- What does `noUncheckedIndexedAccess` change about `array[0]`?
- Why validate environment variables at startup instead of where they are used?

## Risks and gotchas

| Risk                                             | Mitigation                                 |
| ------------------------------------------------ | ------------------------------------------ |
| Chroma API path differs by version               | Verify the heartbeat path now, record it   |
| `latest` image tag drifts and breaks the adapter | Pin a concrete tag once working            |
| `.env` accidentally committed                    | `.gitignore` first, before creating `.env` |
| Node version mismatch later                      | `.nvmrc` pinned now                        |

## Done criteria

- [ ] `npm run typecheck` passes across both workspaces
- [ ] `npm test` passes across both workspaces
- [ ] Chroma responds to a heartbeat request
- [ ] `env.ts` throws a readable error when `OPENAI_API_KEY` is absent
- [ ] `.env` is gitignored and `.env.example` is committed
- [ ] Both dev servers start
