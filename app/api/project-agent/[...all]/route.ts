import { MastraAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { auth } from "@/lib/auth";
import { currentDate } from "@/lib/project";
import {
  PROJECT_AGENT_ID,
  projectAgent,
  projectRequestContext,
} from "@/lib/project-agent";

const basePath = "/api/project-agent";

/**
 * The wizard's own runtime, apart from the tutor's: one runtime's `a2ui`
 * setting reaches every agent it lists, and this agent needs the middleware
 * that paints its card but not the generate tool the tutor's route injects.
 */
async function handler(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // No memory, so no resourceId: nothing is stored that a user could own.
  const agent = new MastraAgent({
    agentId: PROJECT_AGENT_ID,
    agent: projectAgent,
    requestContext: projectRequestContext(currentDate()),
  });

  const runtime = new CopilotRuntime({
    agents: { [PROJECT_AGENT_ID]: agent },
    // The middleware turns the `a2ui_operations` that `updateProject` returns
    // into an `a2ui-surface` activity, which the page paints itself.
    a2ui: { injectA2UITool: false, agents: [PROJECT_AGENT_ID] },
  });

  return createCopilotRuntimeHandler({ runtime, basePath })(request);
}

export const GET = handler;
export const POST = handler;
