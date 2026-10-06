import "server-only";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openRouterModel } from "@/lib/openrouter";
import { A2UI_OPERATIONS_KEY } from "@/lib/progress-card";
import {
  applyProjectPatch,
  describeChanges,
  emptyProject,
  type Project,
  projectPatchSchema,
} from "@/lib/project";
import {
  PROJECT_CARD_CONTEXT,
  projectCardOperations,
  projectCardUpdates,
  projectFromCard,
} from "@/lib/project-card";

/** The wizard's agent, and the CopilotKit `agentId` on the project page. */
export const PROJECT_AGENT_ID = "project";

/**
 * The route sets today's date here, so the instructions can turn "next
 * Monday" into a calendar date. Today is decided on the server, as the page's
 * own "Planning as of" line is.
 */
export function projectRequestContext(today: string) {
  const requestContext = new RequestContext();
  requestContext.set("today", today);
  return requestContext;
}

/**
 * The card the page sent with this run, read back into a project, or
 * undefined before the first run. The AG-UI bridge files the browser's
 * context under the "ag-ui" key, which is where this looks for it.
 */
export function cardInContext(
  requestContext: RequestContext,
): Project | undefined {
  const agUi = requestContext.get("ag-ui") as
    | { context?: { description: string; value: string }[] }
    | undefined;
  const entry = agUi?.context?.find(
    (context) => context.description === PROJECT_CARD_CONTEXT,
  );
  if (!entry) return undefined;
  try {
    return projectFromCard(JSON.parse(entry.value));
  } catch {
    return projectFromCard({});
  }
}

/**
 * The agent's one tool. It applies the patch to the card the page sent, or to
 * the empty project on the first run. The result carries the operations that
 * create the card or, once it exists, update it in place; the A2UI middleware
 * paints them without a second model call. Beside them goes the status line
 * the page shows under the input.
 */
export function createProjectTools() {
  const updateProject = createTool({
    id: "updateProject",
    description:
      "Change the project card. Send the fields this instruction sets or changes; every field left out keeps its value.",
    inputSchema: projectPatchSchema,
    outputSchema: z.object({
      [A2UI_OPERATIONS_KEY]: z.array(z.record(z.string(), z.unknown())),
      status: z.string(),
    }),
    execute: async (patch, { requestContext }) => {
      const card = cardInContext(requestContext);
      const before = card ?? emptyProject;
      const { project, errors } = applyProjectPatch(before, patch);
      return {
        [A2UI_OPERATIONS_KEY]: card
          ? projectCardUpdates(before, project, errors)
          : projectCardOperations(project, errors),
        status: describeChanges(before, project),
      };
    },
  });

  return { updateProject };
}

function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
}

const instructions = (
  today: string,
  card: Project | undefined,
) => `You keep a project card up to date, one instruction at a time.
Your whole answer is a single call to updateProject. Write no text and ask no questions:
nothing besides the call reaches the user, and there is no second turn.

Today is ${weekday(today)}, ${today}. Work every date out from today, and write it as YYYY-MM-DD.

${
  card
    ? `The card holds this now, the user's own edits included:
${JSON.stringify(card)}
Send only the fields this instruction sets or changes; every field you leave out keeps its
value. When a change moves a field that another follows from, send that one too: a new
duration moves the end date, and a different team moves the effort.`
    : "There is no card yet, so every field starts empty."
}

Derive these fields, each only from what the instruction says or plainly implies, and leave a
field out when it does not:
- title: a short name for the project.
- description: one or two sentences on what the project delivers, in the user's terms; leave it
  out when it would only repeat the title.
- startDate: the day work begins. "Next Monday" is the first Monday after today.
- endDate: the last working day. A project of N weeks that starts on a Monday ends on the
  Friday of its Nth week; one of N months ends the day before the same date N months on.
- effortPersonDays: the working days from start to end, five a week, times the people on it,
  with someone half-time counting as a half. Send it only when the instruction says how many
  people, or states the effort itself.
- criticality: low, medium or high, only when the instruction says how urgent or important
  the project is.

Worked example. If today were Wednesday, 2026-04-08, the instruction
"Website relaunch, starts next Monday, three weeks, two people full-time, it's urgent"
is answered with
updateProject({"title": "Website relaunch", "startDate": "2026-04-13", "endDate": "2026-05-01", "effortPersonDays": 30, "criticality": "high"})
because next Monday is 2026-04-13, three weeks from it are 15 working days ending on Friday
2026-05-01, and two people for 15 days are 30 person-days.`;

/**
 * No memory: every submit is a run of its own, and the page sends that one
 * instruction and the card as it stands. Not registered with the tutor's Mastra instance either,
 * since that instance exists to share the tutor's storage, which this agent
 * never touches.
 */
export const projectAgent = new Agent({
  id: PROJECT_AGENT_ID,
  name: "Project planner",
  instructions: ({ requestContext }) =>
    instructions(
      String(requestContext.get("today")),
      cardInContext(requestContext),
    ),
  // Its own model: the tutor's reasoning model works the dates out in its
  // reasoning and then leaves them out of the tool call.
  model: openRouterModel("google/gemini-3.1-flash-lite"),
  tools: createProjectTools(),
  // The tool call is the whole answer, so the run is one step that must make
  // it; the tool's result goes to the page, never back to the model.
  defaultOptions: { toolChoice: "required", maxSteps: 1 },
});
