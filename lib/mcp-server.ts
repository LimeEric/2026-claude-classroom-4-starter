import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import {
  CreateTodoRequest,
  mcpToolResult,
  mcpTools,
  OpenTodoFormResponse,
  SubmitTodoFormResponse,
} from "ai-tutor-api-contract";
import { z } from "zod";
import { readView } from "@/lib/mcp-app-views";
import {
  addTodoFor,
  listOpenTodosFor,
  listTodosFor,
  setTodoDoneFor,
  type TodoDb,
} from "@/lib/todo-tools";

/** The `ui://` resource `open_todo_form` points the host at. */
export const TODO_FORM_URI = "ui://ai-tutor/todo-form.html";

/*
 * Both form tools are defined here rather than in the contract's `mcpTools`,
 * because the CLI's stdio server registers everything in there, and a stdio
 * client has no iframe to draw the form in.
 */

const openTodoForm = {
  title: "Open the to-do form",
  description:
    "Show the user a form for adding one item to their ai-tutor to-do list, drawn inside the chat. Pass `title` to fill in a draft the user can edit before adding it. Use add_todo instead when the user has already said exactly what to add.",
  inputSchema: z.object({
    title: z
      .string()
      .trim()
      .optional()
      .describe("A draft title to put in the form's field."),
  }),
  outputSchema: OpenTodoFormResponse,
  annotations: { readOnlyHint: true },
  _meta: { ui: { resourceUri: TODO_FORM_URI } },
};

/**
 * The model drafts and the human commits: `visibility: ["app"]` tells the host
 * to keep this tool out of the model's tool list and to accept calls to it
 * only from this server's own views. The host enforces that, since every call
 * reaches the server the same way; what the server enforces itself is the
 * user, fixed by the token like every other tool here.
 */
const submitTodoForm = {
  title: "Submit the to-do form",
  description:
    "Add the title the user submitted in the to-do form to their list, and return the new item with every item still open.",
  inputSchema: CreateTodoRequest,
  outputSchema: SubmitTodoFormResponse,
  annotations: { readOnlyHint: false, idempotentHint: false },
  _meta: { ui: { resourceUri: TODO_FORM_URI, visibility: ["app" as const] } },
};

/**
 * The `ai-tutor mcp --stdio` tools served from inside the app: same names,
 * descriptions, and schemas (from the contract), but straight onto the todos
 * table instead of through /api/todos. `userId` is fixed when the server is
 * built, and app/api/mcp/route.ts builds one per request from the verified
 * access token, so no tool argument can name another user's list.
 *
 * On top of those, `open_todo_form` is the one MCP App: a tool whose result
 * the host draws as the built todo-form view, served from `TODO_FORM_URI`,
 * and `submit_todo_form` is how that view saves.
 */
export function createTodoMcpServer(db: TodoDb, userId: string) {
  const server = new McpServer({ name: "ai-tutor", version: "0.1.0" });

  server.registerTool("list_todos", mcpTools.list_todos, async ({ q }) =>
    mcpToolResult({ todos: await listTodosFor(db, userId, q) }),
  );

  server.registerTool("add_todo", mcpTools.add_todo, async ({ title }) =>
    mcpToolResult({ todo: await addTodoFor(db, userId, title) }),
  );

  server.registerTool(
    "mark_todo_done",
    mcpTools.mark_todo_done,
    async ({ id }) => {
      const todo = await setTodoDoneFor(db, userId, id, true);
      // Thrown errors become `isError` results; another user's id reads as
      // unknown, same as PATCH /api/todos/:id answering 404.
      if (!todo) throw new Error(`not_found: no to-do with id ${id}`);
      return mcpToolResult({ todo });
    },
  );

  // The view takes the draft from the tool *input* the host forwards to it
  // and the open list from `structuredContent`; the text is what a host
  // without MCP Apps shows the model.
  registerAppTool(
    server,
    "open_todo_form",
    openTodoForm,
    async ({ title }) => ({
      content: [
        {
          type: "text",
          text: title
            ? `Opened the to-do form with "${title}" filled in; nothing is added until the user submits it.`
            : "Opened an empty to-do form; nothing is added until the user submits it.",
        },
      ],
      structuredContent: { openTodos: await listOpenTodosFor(db, userId) },
    }),
  );

  registerAppTool(
    server,
    "submit_todo_form",
    submitTodoForm,
    async ({ title }) => {
      const todo = await addTodoFor(db, userId, title);
      return mcpToolResult({
        todo,
        openTodos: await listOpenTodosFor(db, userId),
      });
    },
  );

  registerAppResource(
    server,
    "To-do form",
    TODO_FORM_URI,
    { description: "The form open_todo_form draws in the chat." },
    async () => ({
      contents: [
        {
          uri: TODO_FORM_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readView("todo-form"),
        },
      ],
    }),
  );

  return server;
}
