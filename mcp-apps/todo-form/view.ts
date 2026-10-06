import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";
import {
  CreateTodoRequest,
  OpenTodoFormResponse,
  SubmitTodoFormResponse,
  type Todo,
} from "ai-tutor-api-contract";

// No framework, and both imports are bundled in: the built file is the whole
// view, and every byte of it ships inside the one HTML document the host loads.

const titleInput = document.getElementById("todo-title") as HTMLInputElement;
const addButton = document.getElementById("add-todo") as HTMLButtonElement;
const statusLine = document.getElementById("status") as HTMLParagraphElement;
const openList = document.getElementById("open-todos") as HTMLUListElement;
const openEmpty = document.getElementById(
  "open-todos-empty",
) as HTMLParagraphElement;

/** True while a submit is on its way, so one click cannot add the item twice. */
let saving = false;

/** Everything added from this form, for the model context (see `tellModel`). */
const added: Todo[] = [];

/** Prefills the input with the title the tool was called with. */
export function setTitle(text: string) {
  titleInput.value = text;
  titleInput.removeAttribute("aria-invalid");
  syncAddButton();
}

export function setStatus(text: string, kind: "info" | "error" = "info") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

export function renderOpenTodos(
  items: { id: number | string; title: string }[],
) {
  openList.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      row.dataset.id = String(item.id);
      // textContent, never innerHTML: a to-do title is someone's own text.
      row.textContent = item.title;
      return row;
    }),
  );
  openEmpty.hidden = items.length > 0;
}

/** An empty title is not a to-do, so the button says so before the click does. */
function syncAddButton() {
  addButton.disabled = saving || titleInput.value.trim() === "";
}

/** A rejected title stays in the field, marked, with the reason beneath it. */
function rejectTitle(reason: string) {
  titleInput.setAttribute("aria-invalid", "true");
  setStatus(reason, "error");
  titleInput.focus();
}

async function onSubmit(title: string) {
  // The contract's own rule, so the view refuses what the server would.
  if (!CreateTodoRequest.safeParse({ title }).success) {
    rejectTitle("A to-do needs a title. Type one, then add it.");
    return;
  }

  saving = true;
  syncAddButton();
  setStatus("Adding…");
  try {
    const result = await app.callServerTool({
      name: "submit_todo_form",
      arguments: { title },
    });
    if (result.isError) {
      // The server's text is a validation message meant for developers.
      console.warn("submit_todo_form:", result.content);
      rejectTitle(
        "That title was not accepted, so nothing was added. Change it and add it again.",
      );
      return;
    }

    const saved = SubmitTodoFormResponse.safeParse(result.structuredContent);
    if (!saved.success) {
      setStatus("Added. The list below could not be refreshed.", "error");
      return;
    }
    const { todo, openTodos } = saved.data;
    added.push(todo);
    setTitle("");
    renderOpenTodos(openTodos);
    setStatus(`Added “${todo.title}”.`);
    await tellModel(openTodos);
  } catch (error) {
    // A lost connection or a timeout: the server may have saved it anyway.
    console.warn("submit_todo_form:", error);
    setStatus(
      "Could not reach the server. Check the list before adding it again.",
      "error",
    );
  } finally {
    saving = false;
    syncAddButton();
  }
}

/**
 * The model never sees `submit_todo_form`, so without this it would learn of
 * the new item only by calling `list_todos` again. The host keeps just the
 * last update and hands it over with the next user turn, which is why each one
 * repeats everything added so far rather than only the latest item.
 */
async function tellModel(openTodos: Todo[]) {
  if (!app.getHostCapabilities()?.updateModelContext) return;
  const quote = (todo: Todo) => `"${todo.title}" (id ${todo.id})`;
  const text = [
    `With the to-do form, the user added ${added.map(quote).join(", ")} to their ai-tutor to-do list.`,
    openTodos.length > 0
      ? `Their open to-dos are now: ${openTodos.map(quote).join(", ")}.`
      : "They have no open to-dos.",
  ].join(" ");
  try {
    await app.updateModelContext({
      content: [{ type: "text", text }],
      structuredContent: { added, openTodos },
    });
  } catch (error) {
    // The item is saved either way; the model just learns of it later.
    console.warn("updateModelContext:", error);
  }
}

function submit() {
  const title = titleInput.value.trim();
  if (title === "" || saving) return;
  void onSubmit(title);
}

titleInput.addEventListener("input", () => {
  titleInput.removeAttribute("aria-invalid");
  syncAddButton();
});
titleInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  // The view is one field, so Enter is the submit an outer <form> would give.
  event.preventDefault();
  submit();
});
addButton.addEventListener("click", submit);

syncAddButton();
renderOpenTodos([]);

/**
 * Theme, style variables and fonts, from the whole context rather than from a
 * change notification: a notification carries only what changed, and by the
 * time a listener runs the App has already merged it into `getHostContext()`.
 */
function applyHostContext(context: McpUiHostContext | undefined) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const app = new App({ name: "ai-tutor to-do form", version: "0.1.0" });

// Listeners go on before `connect()`: the host may send the tool input as soon
// as the handshake ends, and a notification with no listener yet is dropped.
app.addEventListener("toolinput", ({ arguments: input }) => {
  if (typeof input?.title === "string") setTitle(input.title);
});
// The result of open_todo_form, the call that opened this view: its open list.
app.addEventListener("toolresult", ({ structuredContent }) => {
  const opened = OpenTodoFormResponse.safeParse(structuredContent);
  // After a save, the list from that save is the newer one.
  if (opened.success && added.length === 0) {
    renderOpenTodos(opened.data.openTodos);
  }
});
app.addEventListener("hostcontextchanged", () => {
  applyHostContext(app.getHostContext());
});

// Both ends are the parent: it is where messages go, and the only window whose
// messages the transport accepts.
app.connect(new PostMessageTransport(window.parent, window.parent)).then(
  // The context the handshake returns is not announced as a change, so the
  // first theme has to be applied here.
  () => applyHostContext(app.getHostContext()),
  () => setStatus("Could not reach the MCP host.", "error"),
);
