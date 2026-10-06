import { z } from "zod";
import { TUTOR_CATALOG_ID } from "@/lib/progress-card";
import {
  criticalities,
  type Project,
  type ProjectErrors,
  projectSchema,
} from "@/lib/project";

/**
 * The project card the wizard page draws, as A2UI v0.9 operations, built the
 * way lib/progress-card.ts builds the progress card: a tree authored once
 * whose fields are JSON Pointers into the surface's data model, so the model
 * that fills the project never writes a component.
 *
 * The first run creates the surface; every later run only updates its data
 * model, so the card changes in place. The agent has no memory, so the page
 * sends the data model back with each run (see `PROJECT_CARD_CONTEXT`).
 *
 * Plain module, no `server-only`: the agent's tool builds the operations, and
 * the page shares the context description.
 */

/** The page shows one card, so the surface has a fixed id. */
export const PROJECT_CARD_SURFACE_ID = "project-card";

/**
 * The description of the AG-UI context entry the page sends the card's data
 * model under, manual edits included. Its absence means there is no card yet.
 */
export const PROJECT_CARD_CONTEXT =
  "The project card's data model as it stands, the user's own edits included";

const fields = [
  "title",
  "description",
  "startDate",
  "endDate",
  "effortPersonDays",
  "criticality",
] as const satisfies (keyof Project)[];

/**
 * The project as the card's inputs hold it. The basic catalog's TextField
 * edits a string and its ChoicePicker a list of strings, so the effort is
 * written out ("" while unset) and the criticality is a one-item list.
 * `errors` holds the message for each field the last change was refused for.
 */
export type ProjectCardData = Omit<
  Project,
  "effortPersonDays" | "criticality"
> & {
  effortPersonDays: string;
  criticality: string[];
  errors: ProjectErrors;
};

export function projectCardData(
  project: Project,
  errors: ProjectErrors = {},
): ProjectCardData {
  return {
    ...project,
    effortPersonDays:
      project.effortPersonDays > 0 ? String(project.effortPersonDays) : "",
    criticality: [project.criticality],
    errors,
  };
}

/**
 * Reads a data model back into a project. It comes from the browser and has
 * been typed into by hand, so a value that does not fit falls back to the
 * empty project's rather than failing the run.
 */
const cardSchema = z.object({
  title: z.string().catch(""),
  description: z.string().catch(""),
  startDate: projectSchema.shape.startDate.catch(""),
  endDate: projectSchema.shape.endDate.catch(""),
  effortPersonDays: z.coerce.number().positive().catch(0),
  criticality: z
    .array(z.unknown())
    .transform((selected) => selected[0])
    .pipe(z.enum(criticalities))
    .catch("medium"),
});

export function projectFromCard(data: unknown): Project {
  return cardSchema.parse(data ?? {});
}

/**
 * The input for each field, and the line under it that shows its error. Not
 * the inputs' own `checks`: a check's message is a fixed string in the tree,
 * and applyProjectPatch's messages name the refused value, so they travel in
 * the data model instead.
 */
const fieldRows = (
  [
    { id: "title", component: "TextField", label: "Title" },
    {
      id: "description",
      component: "TextField",
      label: "Description",
      variant: "longText",
    },
    {
      id: "startDate",
      component: "DateTimeInput",
      label: "Start date",
      enableDate: true,
    },
    {
      id: "endDate",
      component: "DateTimeInput",
      label: "End date",
      enableDate: true,
      // The browser's picker then refuses an end before the start.
      min: { path: "/startDate" },
    },
    {
      id: "effortPersonDays",
      component: "TextField",
      label: "Effort in person-days",
      variant: "number",
    },
    {
      id: "criticality",
      component: "ChoicePicker",
      label: "Criticality",
      variant: "mutuallyExclusive",
      options: criticalities.map((value) => ({
        label: value[0].toUpperCase() + value.slice(1),
        value,
      })),
    },
  ] satisfies ({ id: (typeof fields)[number] } & Record<string, unknown>)[]
).flatMap((input) => [
  { ...input, value: { path: `/${input.id}` } },
  {
    id: `${input.id}Error`,
    component: "FieldError",
    text: { path: `/errors/${input.id}` },
  },
]);

/**
 * The component tree. Every input is the basic catalog's and is bound to its
 * field, so an edit on the card writes straight into the data model; each is
 * followed by the app's `FieldError`, bound to that field's error.
 */
export const projectCardComponents = [
  { id: "root", component: "Card", child: "body" },
  {
    id: "body",
    component: "Column",
    children: ["heading", ...fieldRows.map((row) => row.id)],
  },
  { id: "heading", component: "Text", variant: "h3", text: "Project card" },
  ...fieldRows,
];

/**
 * The operations that create the card: open the surface on the app's catalog,
 * send the tree, then the project. Order matters — the renderer rejects an
 * update for a surface it has not been told to create.
 */
export function projectCardOperations(
  project: Project,
  errors: ProjectErrors = {},
) {
  const surfaceId = PROJECT_CARD_SURFACE_ID;
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: TUTOR_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: { surfaceId, components: projectCardComponents },
    },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        path: "/",
        value: projectCardData(project, errors),
      },
    },
  ];
}

/**
 * The operations that change a card already on the page: one data model
 * update per field the change moved, and the errors, which always replace the
 * last run's. A field the change left alone is not written, so an edit the
 * user makes while the run is out survives it.
 */
export function projectCardUpdates(
  before: Project,
  after: Project,
  errors: ProjectErrors,
) {
  const surfaceId = PROJECT_CARD_SURFACE_ID;
  const data = projectCardData(after, errors);
  return [
    ...fields.filter((key) => before[key] !== after[key]),
    "errors" as const,
  ].map((key) => ({
    version: "v0.9",
    updateDataModel: { surfaceId, path: `/${key}`, value: data[key] },
  }));
}
