<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ai-tutor

AI tutoring web app on Next.js 16 App Router + React 19 + Tailwind v4: a Mastra agent (Bartholomew, a butler who keeps the user's to-do list) served to a CopilotKit chat over AG-UI, with A2UI cards in the transcript, plus a project wizard whose own agent fills an A2UI card outside any chat, behind Better Auth email/password sign-in, over a Drizzle/SQLite persistence layer, with a Vitest + Playwright test harness. The same list is reachable through a REST API, a CLI, and two MCP servers.

The source is commented where a decision is not obvious; this file is the map, plus the traps that no single file shows. Open the file before asking here.

## Map

```
app/
  layout.tsx, globals.css         root layout; design tokens and the CopilotKit theme bridge
  page.tsx                        `/`, the chat page (session-gated Server Component)
  login/, signup/                 email/password forms (client components)
  projects/new/                   project wizard: one single-turn run per submit, the card sent along and updated in place
  device/, consent/               approval pages for the CLI device flow and for MCP OAuth
  api/auth/[...all]/              Better Auth handler
  api/copilotkit/[...all]/        AG-UI bridge: session → Mastra agent → CopilotKit runtime
  api/project-agent/[...all]/     the project agent's own runtime: A2UI middleware, no injected generate tool
  api/todos/, api/todos/[id]/     REST API over lib/todo-tools.ts
  api/mcp/                        MCP server over HTTP, OAuth-protected, with the to-do form MCP App
  .well-known/                    OAuth discovery documents, handed to Better Auth
components/
  chat.tsx                        CopilotKit provider (with the A2UI catalog), CopilotChat, and the sidebar in one tree
  a2ui-catalog.tsx                the A2UI catalog of both pages: the basic components plus ProgressBar and FieldError, with Card, Text and the three inputs redrawn
  todos-sidebar.tsx               read-only mirror of the list; the agent is the browser's only write path
  todo-tool-calls.tsx             useRenderTool rows for listTodos, addTodo, setTodoDone (showProgress draws through A2UI)
  project-wizard.tsx              CopilotKit and A2UI providers, no chat: sends the card's data model with each run, applies the result
  device-approval.tsx, oauth-consent.tsx, sign-out-button.tsx
  ui/                             presentational primitives — extend one instead of repeating its class string
lib/
  tutor.ts                        the whole tutor agent: instructions, model, memory, tools
  project-agent.ts                the project agent: no memory, today's date and the sent card, one tool that patches it
  project-card.ts                 the project card's fixed A2UI tree and data model, its create and update operations
  openrouter.ts                   the OpenRouter model config both agents use, proxy included
  todo-tools.ts                   every todo query; the agent tools, the REST routes and both MCP servers call it
  progress-card.ts                showProgress's A2UI tree and operations, and the catalog id the browser registers
  db.ts, schema.ts, auth-schema.ts   cached Drizzle connection; app tables; generated auth tables
  auth.ts, auth-config.ts, auth-cli.ts, auth-client.ts   server instance; shared options; auth:generate target; browser client
  api-route.ts                    bearer-only session and JSON helpers for /api/todos
  mcp-server.ts, mcp-app-views.ts MCP server factory, including the form's app tools and ui:// resource; reader for built MCP App views
  project.ts, tool-result.ts      wizard rules (plain module); AG-UI tool-result decoding
packages/api-contract/            zod request/response schemas and MCP tool definitions shared by app, CLI and MCP App views
cli/                              `ai-tutor` CLI (commander, esbuild-bundled) including `mcp --stdio`
mcp-apps/<name>/ → mcp-apps/dist/ MCP App views, each bundled into one HTML file by scripts/build-views.mjs
drizzle/                          generated migrations
tests/unit, tests/integration     Vitest (node env by default; *.test.tsx is jsdom)
tests/e2e                         Playwright against its own `next dev`
docs/mcp.md                       registering both MCP servers with Claude Code
.agents/skills/ (+ .claude/skills/ copy)   ai-tutor-design, ai-tutor-cli, add-app-to-server, copilotkit, mastra
.tours/                           CodeTours the README points at
```

## Commands

- `npm run dev` / `build` / `start`; `npm run lint` (`biome check`) and `npm run format` — Biome only, never add ESLint or Prettier.
- `npm test` (Vitest), `npm run test:e2e` (Playwright), `npm run test:e2e:llm` (the one spec that spends OpenRouter credit).
- Schema change: edit `lib/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.
- Auth change that touches tables: `npm run auth:generate` (rewrites `lib/auth-schema.ts` wholesale), then `db:generate` and `db:migrate`.
- `npm install` builds the CLI through its `prepare` script; rebuild after edits with `npm run build -w ai-tutor-cli`.
- `npm run build:views` bundles the MCP App views; `predev`/`prebuild` run it, but `next dev` does not watch `mcp-apps/`, so re-run it by hand after editing a view.

## Gotchas

### Build and tooling

- `PageProps<'/route'>` and `LayoutProps<'/route'>` are globals generated by `next dev`/`next build`/`next typegen`, so generate them before typechecking a clean checkout.
- If Turbopack fails to replace a symlink under `.next/dev/node_modules`, stop the server and delete that generated directory.
- If a build reports stale generated route types while `tsc --noEmit --incremental false` passes, delete `.next/cache/.tsbuildinfo`.
- TypeScript is v7, so `next build` type-checks by shelling out to the project-local `tsc` and prints plain diagnostics without code frames.
- `npm run format` skips assist actions such as import sorting; use `npx biome check --write <path>` for those.
- The e2e and CLI test servers set `NEXT_DIST_DIR` (`.next-e2e`, `.next-cli-test`) to coexist with a running `npm run dev`; `next dev` adds their type dirs to `tsconfig.json` itself and reformats the file, so run `npm run format` afterwards.
- `@copilotkit/runtime` drags in a zod-3 tree while Better Auth is on zod 4; npm nests the zod 3 copy under `@copilotkit/runtime/node_modules` on its own — no `.npmrc` or `--legacy-peer-deps`.
- `@modelcontextprotocol/ext-apps` 2.x is a root dependency while `@copilotkit/react-core` nests its own 1.7.5; both are expected in `npm ls`.
- `@copilotkit/a2ui-renderer`, `@a2ui/web_core` and the `zod3` alias (`npm:zod@3`) are the versions `@copilotkit/react-core` itself resolves, so bump them with CopilotKit or the catalog's types stop matching the renderer's.

### Persistence and auth

- `drizzle/` is generated, except that SQLite cannot `ADD` a `NOT NULL` column without a default, so such a migration is hand-edited into a table rebuild that backfills it, as `0004` does.
- Mastra creates and owns its `mastra_*` tables in the same SQLite file; they are not in `lib/schema.ts` and `db:generate` must not try to manage them.
- The driver is `drizzle-orm/libsql/node`; do not install `better-sqlite3`.
- Every plugin that adds tables (`deviceAuthorization`, `jwt`, `mcp`, `cimd`) must be in `lib/auth-cli.ts`'s plugin array too, or its tables drop out of the next `auth:generate`.
- There is deliberately no `proxy.ts`: gate pages server-side with `auth.api.getSession` plus `redirect()`, as `app/page.tsx` does.
- `mcp()` from `@better-auth/mcp` is the OAuth provider; `@better-auth/oauth-provider` is a dependency only for its client plugin, so never add `oauthProvider()` beside `mcp()`.
- A new MCP scope has to be listed in `mcpOptions().scopes` and described in `components/oauth-consent.tsx`.
- `Authorization: Bearer` must carry the signed token from sign-in's `set-auth-token` header, not the raw session token; in tests that is `login().cookies[0].value`, not `login().token`.

### Agent and CopilotKit

- `@copilotkit/react-core/v2` and `@copilotkit/runtime/v2` (`createCopilotRuntimeHandler`) are the only surfaces that work here; `@copilotkit/react-ui`, the package roots, and the Express/Hono adapters are v1.
- CopilotKit questions go through the `copilotkit` skill, which sends you to the `copilotkit-docs` MCP server in `.mcp.json`; Mastra questions through the `mastra` skill.
- A tool draws a fixed A2UI card by returning `{ a2ui_operations: [...] }`, which the runtime's A2UI middleware paints; the route's `injectA2UITool: true` also gives the model a UI-generating tool, which the Mastra bridge turns from `render_a2ui` into `generate_a2ui`, a subagent on the tutor's own model.
- The injected tool learns the catalog id only from the schema context, so `includeSchema` on the provider stays `true`, or its surfaces ask for the basic catalog instead of ours.
- A2UI catalog prop schemas must be zod 3 (`zod3`), because the binder reads zod 3 internals and passes a zod 4 prop's `{ path }` through unresolved.
- The Mastra bridge files the browser's AG-UI context under the RequestContext's `"ag-ui"` key and never shows it to the model, so an agent that should see a context entry has to put it in its own instructions, as the project agent does with the card.
- One runtime's `a2ui` options, `injectA2UITool` included, reach every agent in its `agents` list, so an agent that needs the A2UI middleware without the generate tool gets a runtime of its own, as the project agent does.
- Mastra memory is durable in SQLite, but the default `InMemoryAgentRunner` also keeps a bounded replay cache that can restore the browser transcript until eviction or restart — do not mistake either for the other when debugging.

### MCP App views

- App tools (`registerAppTool`) stay out of the contract's `mcpTools`, because the CLI's stdio server registers all of `mcpTools` and has no iframe to draw a view in.
- `visibility: ["app"]` (as on `submit_todo_form`) is enforced by the host, not the server: the server still lists the tool and runs any call to it, so an app-only tool must be as safe as a model tool for the token's user.
- Views import the contract package, so it stays free of Node-only imports, and it must resolve the same `zod` as ext-apps, whose `App` switches that one instance to jitless parsing for the iframe's no-`unsafe-eval` CSP.
- A view imports the root `@modelcontextprotocol/ext-apps` entry and Vite bundles it with the client SDK and zod into the one HTML file, so `@modelcontextprotocol/client` is a build dependency of the views, not only of the tests.
- A view that applies host style variables only changes what its `style.css` reads through `var(--…)`, and the todo-form reads only `--font-sans`, so the brand colours survive any host.

### Styling

- Read `.agents/skills/ai-tutor-design/SKILL.md` before touching anything visual, and update it in the same change set when a rule changes.
- `Source_Sans_3` at 400/600 is the only face loaded, so there is no `font-mono` utility to reach for.
- The chat's composer, send button and radii are hardcoded CopilotKit utilities that `globals.css` overrides by hand; after a CopilotKit upgrade, a pill-shaped composer means the overrides no longer match.

### Tests

- Vitest only picks up `tests/{unit,integration}/**/*.test.{ts,tsx}` and cannot render async Server Components, so cover those with e2e.
- Vitest does not load `.env`: tests stub `DATABASE_URL`/`BETTER_AUTH_*` onto temp files, and `server-only` resolves to its throwing build outside Next.js, so modules that import it are loaded under `vi.mock("server-only", () => ({}))`.
- `tests/e2e/*.spec.ts` hit `data/app.db`, so they sign up `Date.now()`-stamped emails; `*.llm.spec.ts` is ignored unless `E2E_LLM` is set.
- The token-verified path of `/api/mcp` needs the app's own JWKS over HTTP, so it has no unit test; `tests/integration/cli.test.ts` is the one place a real `next dev` is exercised from Vitest.

### CLI

- The `--help` text is the CLI's only documentation and is written for agents too, so change it alongside any behavior.
- `.agents/skills/ai-tutor-cli/SKILL.md` (and its `.claude/skills/` copy) only says when to reach for the CLI; update it when a command is added, renamed, or removed.

### Secrets

- `.env` holds `DATABASE_URL`, `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, and `OPENROUTER_API_KEY` (see `.env.example`); never commit it or print its values.

## Maintenance — for you, the agent

- Update this file in the same change set whenever a change invalidates a line here or teaches a costly lesson.
- Keep it a map plus non-obvious traps: anything a reader learns by opening the file a line points to belongs in that file's comments, not here.
- One sentence per bullet, current state only, no history.
- The three `.tours/*.tour` files anchor by line number into the files they name (`app/page.tsx`, `lib/tutor.ts`, `lib/todo-tools.ts`, `lib/progress-card.ts`, the CopilotKit route, `components/`, `scripts/build-views.mjs`, `lib/mcp-app-views.ts`, `mcp-apps/todo-form/`, `package.json`, `.gitignore`, and their tests), so re-check `line` values when those statements move.
