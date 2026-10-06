// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2uiMessageListSchema } from "@a2ui/web_core/v0_9";
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTION_APIS,
} from "@a2ui/web_core/v0_9/basic_catalog";
import { RequestContext } from "@mastra/core/request-context";
import type { ValidationError } from "@mastra/core/tools";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { TUTOR_CATALOG_ID } from "@/lib/progress-card";
import * as schema from "@/lib/schema";
import { todos, user } from "@/lib/schema";
import { createTodoTools, tutorRequestContext } from "@/lib/todo-tools";

// The executors take their db, so this runs the real statements against a
// throwaway file instead of data/app.db.
let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tools: ReturnType<typeof createTodoTools>;

const ada = tutorRequestContext("user-ada");
const grace = tutorRequestContext("user-grace");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todo-tools-"));
  db = drizzle({ connection: { url: `file:${join(dir, "test.db")}` }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  tools = createTodoTools(db);

  // todos.userId is a FK onto the Better Auth user table.
  await db.insert(user).values([
    { id: "user-ada", name: "Ada", email: "ada@example.com" },
    { id: "user-grace", name: "Grace", email: "grace@example.com" },
  ]);
});

afterAll(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(todos);
});

/**
 * `createTool` types `execute` as optional, unions the requestContext
 * validation error into its result, and expects the rest of the execution
 * context the runtime fills in. One cast here keeps every assertion below
 * plain, and still runs the real executor.
 */
const run = <I, O>(
  tool: {
    // biome-ignore lint/suspicious/noConfusingVoidType: mirrors createTool's own execute signature
    execute?: (input: I, context: never) => Promise<O | ValidationError | void>;
  },
  input: I,
  requestContext: RequestContext,
) => tool.execute?.(input, { requestContext } as never) as Promise<O>;

const titles = (result: { todos: { title: string }[] }) =>
  result.todos.map((todo) => todo.title);

test("addTodo writes the item against the context's user", async () => {
  const { todo } = await run(tools.addTodo, { title: "  Buy milk  " }, ada);

  expect(todo).toEqual({
    id: expect.any(String),
    title: "Buy milk",
    done: false,
  });

  const rows = await db.select().from(todos);
  expect(rows.map((row) => row.userId)).toEqual(["user-ada"]);
});

test("listTodos returns only the context's own items", async () => {
  await run(tools.addTodo, { title: "Ada one" }, ada);
  await run(tools.addTodo, { title: "Ada two" }, ada);
  await run(tools.addTodo, { title: "Grace one" }, grace);

  expect(titles(await run(tools.listTodos, {}, ada))).toEqual([
    "Ada one",
    "Ada two",
  ]);
  expect(titles(await run(tools.listTodos, {}, grace))).toEqual(["Grace one"]);
});

test("listTodos keeps insertion order within the same second", async () => {
  // Fast enough to share created_at's whole second, so only seq can order them.
  for (const title of ["Zebra", "Apple", "Mango", "Banana", "Kiwi"]) {
    await run(tools.addTodo, { title }, ada);
  }

  expect(titles(await run(tools.listTodos, {}, ada))).toEqual([
    "Zebra",
    "Apple",
    "Mango",
    "Banana",
    "Kiwi",
  ]);
});

test("setTodoDone completes an item and can reopen it", async () => {
  const { todo } = await run(tools.addTodo, { title: "Buy milk" }, ada);

  await expect(
    run(tools.setTodoDone, { id: todo.id, done: true }, ada),
  ).resolves.toEqual({ todo: { id: todo.id, title: "Buy milk", done: true } });

  await expect(
    run(tools.setTodoDone, { id: todo.id, done: false }, ada),
  ).resolves.toEqual({ todo: { id: todo.id, title: "Buy milk", done: false } });
});

test("setTodoDone cannot reach another student's item", async () => {
  const { todo } = await run(tools.addTodo, { title: "Ada's errand" }, ada);

  // Grace has the id — the tools still treat it as no such item.
  await expect(
    run(tools.setTodoDone, { id: todo.id, done: true }, grace),
  ).resolves.toEqual({ todo: null });

  const [row] = await db.select().from(todos);
  expect(row.done).toBe(false);
});

test("the user id comes from the context, never from the tool's input", async () => {
  // What a prompt-injected model would try: name someone else in the arguments.
  await run(
    tools.addTodo,
    { title: "Planted", userId: "user-grace", id: "forged" } as {
      title: string;
    },
    ada,
  );

  const rows = await db.select().from(todos);
  expect(rows).toHaveLength(1);
  expect(rows[0].userId).toBe("user-ada");
  expect(rows[0].id).not.toBe("forged");
});

test("an execution without a user id is refused rather than run", async () => {
  const result: unknown = await run(
    tools.setTodoDone,
    { id: "anything", done: true },
    new RequestContext(),
  );

  expect(result).toMatchObject({ error: true });
  expect(await db.select().from(todos)).toEqual([]);
});

describe("showProgress", () => {
  type Component = { id: string; component: string } & Record<string, unknown>;

  const showProgress = async (context: RequestContext) =>
    (await run(tools.showProgress, {}, context)).a2ui_operations;

  const partsOf = (operations: Record<string, unknown>[]) => {
    const [create, update, data] = operations as unknown as [
      { createSurface: { surfaceId: string; catalogId: string } },
      { updateComponents: { surfaceId: string; components: Component[] } },
      { updateDataModel: { surfaceId: string; path: string; value: object } },
    ];
    return {
      surface: create.createSurface,
      components: update.updateComponents.components,
      model: data.updateDataModel,
    };
  };

  // Every JSON Pointer the tree reads: `{ path }` bindings, and `${/x}` inside
  // a formatString template.
  const pathsIn = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [...value.matchAll(/\$\{(\/[^}]+)\}/g)].map((match) => match[1]);
    }
    if (Array.isArray(value)) return value.flatMap(pathsIn);
    if (value && typeof value === "object") {
      const own =
        "path" in value && typeof value.path === "string" ? [value.path] : [];
      return [...own, ...Object.values(value).flatMap(pathsIn)];
    }
    return [];
  };

  const callsIn = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(callsIn);
    if (value && typeof value === "object") {
      const own =
        "call" in value && typeof value.call === "string" ? [value.call] : [];
      return [...own, ...Object.values(value).flatMap(callsIn)];
    }
    return [];
  };

  test("returns well-formed A2UI v0.9 operations for one surface on the app's catalog", async () => {
    await run(tools.addTodo, { title: "Buy milk" }, ada);
    const operations = await showProgress(ada);

    // The protocol's own schema, strict: no stray keys, version on every one.
    expect(A2uiMessageListSchema.safeParse(operations).error).toBeUndefined();
    expect(operations.map((operation) => Object.keys(operation))).toEqual([
      ["version", "createSurface"],
      ["version", "updateComponents"],
      ["version", "updateDataModel"],
    ]);

    const { surface, components, model } = partsOf(operations);
    expect(surface.catalogId).toBe(TUTOR_CATALOG_ID);
    for (const { version: _, ...body } of operations) {
      expect(Object.values(body)).toEqual([
        expect.objectContaining({ surfaceId: surface.surfaceId }),
      ]);
    }
    expect(model.path).toBe("/");

    // A tree the renderer can walk: unique ids, a root, no dangling child.
    const ids = components.map((component) => component.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("root");
    const referenced = components.flatMap((component) =>
      [component.child, component.children].flat().filter(Boolean),
    );
    expect(ids).toEqual(expect.arrayContaining(referenced));
    expect(ids.filter((id) => id !== "root").sort()).toEqual(
      [...new Set(referenced)].sort(),
    );

    // Each component is in the catalog, and the basic ones satisfy the basic
    // catalog's strict prop schemas exactly as the browser will parse them.
    const basic = new Map(BASIC_COMPONENTS.map((api) => [api.name, api]));
    for (const { id, component, ...props } of components) {
      if (component === "ProgressBar") continue;
      const api = basic.get(component);
      expect(api, `${id} is a ${component}`).toBeDefined();
      expect(api?.schema.safeParse(props).error, id).toBeUndefined();
    }
    expect(components.map((component) => component.component)).toContain(
      "ProgressBar",
    );

    const functions = new Set(BASIC_FUNCTION_APIS.map((api) => api.name));
    for (const call of callsIn(components)) expect(functions).toContain(call);

    // Every binding lands on a figure the data model holds.
    const bound = new Set(pathsIn(components));
    expect(bound.size).toBeGreaterThan(0);
    for (const path of bound) {
      expect(Object.keys(model.value)).toContain(path.slice(1));
    }
  });

  test("the figures in the data model are the context's own rows", async () => {
    for (const title of ["One", "Two", "Three"]) {
      await run(tools.addTodo, { title }, ada);
    }
    const { todos: adaTodos } = await run(tools.listTodos, {}, ada);
    await run(tools.setTodoDone, { id: adaTodos[0].id, done: true }, ada);
    await run(tools.setTodoDone, { id: adaTodos[2].id, done: true }, ada);
    // Grace's items, done or not, must not leak into Ada's figures.
    const { todo } = await run(tools.addTodo, { title: "Grace's" }, grace);
    await run(tools.setTodoDone, { id: todo.id, done: true }, grace);

    const rows = (await db.select().from(todos)).filter(
      (row) => row.userId === "user-ada",
    );
    const done = rows.filter((row) => row.done).length;

    const { model } = partsOf(await showProgress(ada));
    expect(model.value).toEqual({
      total: rows.length,
      done,
      open: rows.length - done,
      donePercent: Math.round((done / rows.length) * 100),
      openPercent: 100 - Math.round((done / rows.length) * 100),
    });
    expect(model.value).toEqual({
      total: 3,
      done: 2,
      open: 1,
      donePercent: 67,
      openPercent: 33,
    });
  });

  test("an empty list draws zeros rather than dividing by zero", async () => {
    const { model } = partsOf(await showProgress(ada));

    expect(model.value).toEqual({
      total: 0,
      done: 0,
      open: 0,
      donePercent: 0,
      openPercent: 0,
    });
  });

  test("each call opens its own surface, so an earlier card keeps its figures", async () => {
    const first = partsOf(await showProgress(ada)).surface.surfaceId;
    const second = partsOf(await showProgress(ada)).surface.surfaceId;

    expect(first).not.toBe(second);
  });
});
