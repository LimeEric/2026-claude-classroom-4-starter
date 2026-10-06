// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${/path}` is A2UI's formatString interpolation, read by the client, not a JS template.
/**
 * The progress card the `showProgress` tool puts in the chat, as A2UI v0.9
 * operations rather than a React component. The tree below is authored once
 * and carries no numbers: every figure is a JSON Pointer into the surface's
 * data model, which the tool fills from the database (see
 * `todoProgressFor` in lib/todo-tools.ts), so the model never writes one.
 *
 * Plain module, no `server-only`: the client catalog in
 * components/a2ui-catalog.tsx imports `TUTOR_CATALOG_ID` from here, and the
 * two have to agree or the renderer refuses the surface ("Catalog not
 * found").
 */

/** The catalog the surface asks for; the browser registers it under this id. */
export const TUTOR_CATALOG_ID = "ai-tutor://a2ui/catalog/v1";

/**
 * The key the AG-UI A2UI middleware looks for in a tool result. Finding it is
 * the whole of the handshake: the middleware turns the array into an
 * `a2ui-surface` activity, and the tool needs no rendering call of its own.
 */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** What the tool reads off the list; the data model is exactly this. */
export type TodoProgress = {
  total: number;
  done: number;
  open: number;
  /** Whole percentages that add up to 100, or both 0 on an empty list. */
  donePercent: number;
  openPercent: number;
};

/** A string the client interpolates from the data model at render time. */
const format = (value: string) => ({
  call: "formatString",
  args: { value },
  returnType: "string",
});

/**
 * The component tree. The renderer starts at the component whose id is
 * "root" and reaches the rest through `child`/`children`; `Card`, `Column`,
 * `Row` and `Text` are the basic catalog's, `ProgressBar` is ours.
 */
export const progressCardComponents = [
  { id: "root", component: "Card", child: "body" },
  {
    id: "body",
    component: "Column",
    children: ["heading", "bar", "figures"],
  },
  {
    id: "heading",
    component: "Text",
    variant: "h3",
    text: "Progress on the list",
  },
  {
    id: "bar",
    component: "ProgressBar",
    value: { path: "/done" },
    max: { path: "/total" },
    label: format("${/done} of ${/total} done"),
  },
  {
    id: "figures",
    component: "Row",
    justify: "spaceBetween",
    children: ["doneFigure", "openFigure"],
  },
  {
    id: "doneFigure",
    component: "Text",
    variant: "caption",
    text: format("${/done} done · ${/donePercent}%"),
  },
  {
    id: "openFigure",
    component: "Text",
    variant: "caption",
    text: format("${/open} open · ${/openPercent}%"),
  },
];

/**
 * The three operations for one card: open the surface on our catalog, send
 * the tree, then the numbers. Order matters — the renderer rejects an update
 * for a surface it has not been told to create.
 */
export function progressCardOperations(
  surfaceId: string,
  progress: TodoProgress,
) {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: TUTOR_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: { surfaceId, components: progressCardComponents },
    },
    {
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: progress },
    },
  ];
}
