// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { mcpTools } from "ai-tutor-api-contract";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { createTodoMcpServer, TODO_FORM_URI } from "@/lib/mcp-server";
import * as schema from "@/lib/schema";
import { todos, user } from "@/lib/schema";
import { addTodoFor, listTodosFor, setTodoDoneFor } from "@/lib/todo-tools";

vi.mock("server-only", () => ({}));

// readView has its own tests; standing in for it here keeps this file off the
// git-ignored build output, which a clean checkout does not have.
vi.mock("@/lib/mcp-app-views", () => ({
  readView: async (name: string) => `<!doctype html><p>${name}</p>`,
}));

// The real statements against a throwaway file, as in todo-tools.test.ts, with
// one MCP client per user, the way app/api/mcp/route.ts builds one server per
// verified token.
let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ada: Client;
let grace: Client;

async function connectAs(userId: string) {
  const server = createTodoMcpServer(db, userId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-mcp-server-"));
  db = drizzle({ connection: { url: `file:${join(dir, "test.db")}` }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });

  // todos.userId is a FK onto the Better Auth user table.
  await db.insert(user).values([
    { id: "user-ada", name: "Ada", email: "ada@example.com" },
    { id: "user-grace", name: "Grace", email: "grace@example.com" },
  ]);

  ada = await connectAs("user-ada");
  grace = await connectAs("user-grace");
});

afterAll(async () => {
  await ada.close();
  await grace.close();
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(todos);
});

test("open_todo_form links to the todo-form resource and takes an optional title", async () => {
  const { tools } = await ada.listTools();
  const tool = tools.find((t) => t.name === "open_todo_form");

  expect(tool?._meta).toMatchObject({ ui: { resourceUri: TODO_FORM_URI } });
  expect(tool?.inputSchema.properties).toHaveProperty("title");
  expect(tool?.inputSchema.required ?? []).not.toContain("title");
});

test("submit_todo_form is marked app-only, so the host keeps it from the model", async () => {
  const { tools } = await ada.listTools();
  const tool = tools.find((t) => t.name === "submit_todo_form");

  expect(tool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  // Every other tool either says nothing, which means both, or names the model.
  for (const other of tools.filter((t) => t.name !== "submit_todo_form")) {
    const ui = other._meta?.ui as { visibility?: string[] } | undefined;
    expect(ui?.visibility ?? ["model"]).toContain("model");
  }
});

test("the todo-form resource is the built view, with the MCP App MIME type", async () => {
  const { contents } = await ada.readResource({ uri: TODO_FORM_URI });

  expect(contents).toEqual([
    {
      uri: TODO_FORM_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><p>todo-form</p>",
    },
  ]);
});

test("open_todo_form returns the caller's open to-dos and a text line for hosts without MCP Apps", async () => {
  // One insert per row: `seq` is computed per statement, so a multi-row
  // insert would give every row the same one.
  await addTodoFor(db, "user-ada", "Buy milk");
  const called = await addTodoFor(db, "user-ada", "Call mum");
  await setTodoDoneFor(db, "user-ada", called.id, true);
  await addTodoFor(db, "user-grace", "Grace's own");

  const result = await ada.callTool({
    name: "open_todo_form",
    arguments: { title: "Water plants" },
  });

  expect(result.isError).toBeFalsy();
  expect(result.content).toEqual([
    expect.objectContaining({
      type: "text",
      text: expect.stringContaining("Water plants"),
    }),
  ]);
  expect(result.structuredContent).toEqual({
    openTodos: [{ id: expect.any(String), title: "Buy milk", done: false }],
  });
});

test("submit_todo_form saves for the calling user only and returns their open list", async () => {
  await addTodoFor(db, "user-ada", "Buy milk");
  await addTodoFor(db, "user-grace", "Grace's own");

  const result = await ada.callTool({
    name: "submit_todo_form",
    arguments: { title: "  Water plants  " },
  });

  expect(result.isError).toBeFalsy();
  const todo = { id: expect.any(String), title: "Water plants", done: false };
  expect(result.structuredContent).toEqual({
    todo,
    openTodos: [
      { id: expect.any(String), title: "Buy milk", done: false },
      todo,
    ],
  });
  expect(await listTodosFor(db, "user-grace")).toEqual([
    { id: expect.any(String), title: "Grace's own", done: false },
  ]);
});

test("submit_todo_form rejects an empty title and saves nothing", async () => {
  const result = await ada.callTool({
    name: "submit_todo_form",
    arguments: { title: "   " },
  });

  expect(result.isError).toBe(true);
  expect(await listTodosFor(db, "user-ada")).toEqual([]);
});

test("the CLI's stdio server never sees the form tools", () => {
  expect(Object.keys(mcpTools)).not.toContain("open_todo_form");
  expect(Object.keys(mcpTools)).not.toContain("submit_todo_form");
});
