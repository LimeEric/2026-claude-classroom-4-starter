// @vitest-environment node
import { A2uiMessageListSchema } from "@a2ui/web_core/v0_9";
import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import { describe, expect, test, vi } from "vitest";
import { TUTOR_CATALOG_ID } from "@/lib/progress-card";
import type { ProjectPatch } from "@/lib/project";
import {
  PROJECT_CARD_CONTEXT,
  PROJECT_CARD_SURFACE_ID,
} from "@/lib/project-card";

// The `server-only` package resolves to its throwing build outside Next.js;
// nothing here needs what it guards. Building the agent makes no model call.
vi.mock("server-only", () => ({}));

const { createProjectTools, projectRequestContext } = await import(
  "@/lib/project-agent"
);

type Operation = Record<string, unknown>;
type Component = { id: string; component: string } & Record<string, unknown>;
type DataModel = Record<string, unknown>;
type Result = { a2ui_operations: Operation[]; status: string };

/**
 * Runs the real executor with the request context the route and the AG-UI
 * bridge build: today's date, and under "ag-ui" whatever context the page
 * sent, which is the card's data model once there is a card.
 */
const updateProject = (patch: ProjectPatch, card?: DataModel) => {
  const requestContext = projectRequestContext("2026-10-06");
  requestContext.set("ag-ui", {
    context: card
      ? [{ description: PROJECT_CARD_CONTEXT, value: JSON.stringify(card) }]
      : [],
  });
  return createProjectTools().updateProject.execute?.(patch, {
    requestContext,
  } as never) as Promise<Result>;
};

/** What the browser's data model holds after the operations land. */
const applyTo = (model: DataModel, operations: Operation[]) => {
  let next = structuredClone(model);
  for (const operation of operations) {
    if (!operation.updateDataModel) continue;
    const { path, value } = operation.updateDataModel as {
      path: string;
      value: unknown;
    };
    if (path === "/") next = structuredClone(value as DataModel);
    else next[path.slice(1)] = value;
  }
  return next;
};

const kinds = (operations: Operation[]) =>
  operations.map((operation) =>
    Object.keys(operation).filter((key) => key !== "version"),
  );

describe("updateProject", () => {
  test("creates the card on the first call and only updates its data model on a later one", async () => {
    const first = await updateProject({
      title: "Website relaunch",
      startDate: "2026-10-12",
      endDate: "2026-10-30",
      effortPersonDays: 30,
    });

    expect(
      A2uiMessageListSchema.safeParse(first.a2ui_operations).error,
    ).toBeUndefined();
    expect(kinds(first.a2ui_operations)).toEqual([
      ["createSurface"],
      ["updateComponents"],
      ["updateDataModel"],
    ]);
    const [create, update] = first.a2ui_operations as [
      { createSurface: { surfaceId: string; catalogId: string } },
      { updateComponents: { components: Component[] } },
    ];
    expect(create.createSurface).toEqual({
      surfaceId: PROJECT_CARD_SURFACE_ID,
      catalogId: TUTOR_CATALOG_ID,
    });

    // A tree the browser will parse: the basic components satisfy the basic
    // catalog's strict schemas, and every binding lands on the data model.
    let model = applyTo({}, first.a2ui_operations);
    const components = update.updateComponents.components;
    const basic = new Map(BASIC_COMPONENTS.map((api) => [api.name, api]));
    for (const { id, component, ...props } of components) {
      if (component === "FieldError") continue;
      expect(
        basic.get(component)?.schema.safeParse(props).error,
        id,
      ).toBeUndefined();
    }
    const bindings = components.flatMap((component) =>
      [component.value, component.text]
        .filter((prop) => typeof prop === "object" && prop !== null)
        .map((prop) => (prop as { path: string }).path),
    );
    expect(bindings).toHaveLength(12);
    for (const path of bindings) {
      expect(Object.keys(model)).toContain(path.split("/")[1]);
    }
    expect(model).toEqual({
      title: "Website relaunch",
      description: "",
      startDate: "2026-10-12",
      endDate: "2026-10-30",
      effortPersonDays: "30",
      criticality: ["medium"],
      errors: {},
    });
    expect(first.status).toBe(
      'Set title to "Website relaunch", start date to 2026-10-12, end date to 2026-10-30 and effort to 30 person-days.',
    );

    // The user types a description into the card, then sends a second turn.
    model = { ...model, description: "Rebuild the public site." };
    const second = await updateProject(
      { endDate: "2026-11-06", criticality: "high" },
      model,
    );

    // Only data model updates to the same surface, one per field that moved.
    expect(
      A2uiMessageListSchema.safeParse(second.a2ui_operations).error,
    ).toBeUndefined();
    expect(second.a2ui_operations).toEqual(
      ["/endDate", "/criticality", "/errors"].map((path) => ({
        version: "v0.9",
        updateDataModel: {
          surfaceId: PROJECT_CARD_SURFACE_ID,
          path,
          value: expect.anything(),
        },
      })),
    );
    // The patch landed on the card the page sent, manual edit included.
    expect(applyTo(model, second.a2ui_operations)).toEqual({
      ...model,
      endDate: "2026-11-06",
      criticality: ["high"],
    });
    expect(second.status).toBe(
      "Set end date to 2026-11-06 and criticality to high.",
    );
  });

  test("a rejected field keeps its value and comes back as that field's error", async () => {
    const card = applyTo(
      {},
      (await updateProject({ startDate: "2026-10-12", endDate: "2026-10-30" }))
        .a2ui_operations,
    );

    const { a2ui_operations, status } = await updateProject(
      { title: "Relaunch", endDate: "2026-10-01" },
      card,
    );

    expect(applyTo(card, a2ui_operations)).toEqual({
      ...card,
      title: "Relaunch",
      errors: { endDate: "The end date is before the start date." },
    });
    expect(status).toBe('Set title to "Relaunch".');

    // The next turn's errors replace this one's.
    const next = await updateProject({ title: "Site relaunch" }, card);
    expect(applyTo(card, next.a2ui_operations).errors).toEqual({});
  });
});
