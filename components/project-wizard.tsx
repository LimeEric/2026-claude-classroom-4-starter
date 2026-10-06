"use client";

import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { CopilotKit, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { type FormEvent, useState } from "react";
import { tutorCatalog } from "@/components/a2ui-catalog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { A2UI_OPERATIONS_KEY } from "@/lib/progress-card";
import {
  PROJECT_CARD_CONTEXT,
  PROJECT_CARD_SURFACE_ID,
} from "@/lib/project-card";
import { parseToolResult } from "@/lib/tool-result";

/** The activity type the runtime's A2UI middleware gives a painted surface. */
const A2UI_SURFACE_ACTIVITY = "a2ui-surface";

type Operations = Record<string, unknown>[];

type RunMessage =
  | { role: "activity"; activityType: string; content: Record<string, unknown> }
  | { role: "tool"; content: string }
  | { role: string };

/**
 * What one run left behind: the card's operations, from the activity the
 * middleware made of `updateProject`'s result, and the status line from that
 * result itself.
 */
function readRun(messages: RunMessage[]) {
  let operations: Operations | undefined;
  let status: string | undefined;
  for (const message of messages) {
    if (
      "activityType" in message &&
      message.activityType === A2UI_SURFACE_ACTIVITY &&
      Array.isArray(message.content[A2UI_OPERATIONS_KEY])
    ) {
      operations = message.content[A2UI_OPERATIONS_KEY];
    }
    if (message.role === "tool" && "content" in message) {
      const result = parseToolResult(String(message.content));
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        typeof result.status === "string"
      ) {
        status = result.status;
      }
    }
  }
  return { operations, status };
}

/**
 * The project page's client half: its own CopilotKit provider on the project
 * agent's runtime, and an A2UI provider the page paints the card into. There
 * is no chat and no transcript; each submit is a run of its own, and the card
 * is what carries one run's result into the next.
 */
export function ProjectWizard({
  agentId,
  today,
}: {
  agentId: string;
  today: string;
}) {
  return (
    // No `a2ui` prop: nothing here draws activity messages on its own, the
    // card below is painted by hand.
    <CopilotKit runtimeUrl="/api/project-agent" credentials="include">
      <A2UIProvider catalog={tutorCatalog}>
        <Wizard agentId={agentId} today={today} />
      </A2UIProvider>
    </CopilotKit>
  );
}

function Wizard({ agentId, today }: { agentId: string; today: string }) {
  const { agent } = useAgent({ agentId });
  const { copilotkit } = useCopilotKit();
  const a2ui = useA2UIActions();
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = instruction.trim();
    if (!content || running) return;

    setRunning(true);
    setStatus("Working it out…");
    // One turn on a fresh thread: the agent has no memory, so what it knows of
    // earlier runs is the card itself, sent as it stands, manual edits
    // included. Before the first run there is no card, and nothing is sent.
    const card = a2ui.getSurface(PROJECT_CARD_SURFACE_ID);
    const contextId =
      card &&
      copilotkit.addContext({
        description: PROJECT_CARD_CONTEXT,
        value: JSON.stringify(card.dataModel.get("/")),
        agentIds: [agentId],
      });
    agent.threadId = crypto.randomUUID();
    agent.setMessages([{ id: crypto.randomUUID(), role: "user", content }]);
    try {
      await copilotkit.runAgent({ agent });
    } catch {
      // CopilotKit reports the failure itself; the missing result says it here.
    } finally {
      if (contextId) copilotkit.removeContext(contextId);
    }

    // The first run's operations create the card; a later run's only update
    // its data model, so the card changes in place.
    const run = readRun(agent.messages);
    if (run.operations) {
      a2ui.processMessages(run.operations);
      setStatus(run.status ?? "");
      setInstruction("");
    } else {
      setStatus("Nothing came back. Send the instruction again.");
    }
    setRunning(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <A2UIRenderer
        surfaceId={PROJECT_CARD_SURFACE_ID}
        fallback={
          <p className="border border-edge bg-surface p-4 text-base text-ink-soft">
            No project yet. Describe one below and its card appears here.
          </p>
        }
      />

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            id="instruction"
            label="Instruction"
            className="w-full"
            autoComplete="off"
            placeholder="Plan a six month website relaunch"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={running}>
          Send
        </Button>
      </form>
      <p aria-live="polite" className="min-h-5 text-sm text-ink-soft">
        {status || `Dates are worked out from today, ${today}.`}
      </p>
    </div>
  );
}
