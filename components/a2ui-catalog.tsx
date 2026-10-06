"use client";

import { CardApi, TextApi } from "@a2ui/web_core/v0_9/basic_catalog";
import {
  type CatalogDefinitions,
  createCatalog,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@copilotkit/a2ui-renderer";
// zod 3, not the app's zod 4: the A2UI binder decides which props to resolve
// against the data model by reading zod 3 internals (`_def.typeName`), so a
// zod 4 schema would hand `{ path: "/done" }` to the renderer unresolved. The
// `zod3` alias is the renderer's own version rather than zod 4's `zod/v3`,
// whose ZodObject TypeScript will not accept in place of the renderer's.
import { z } from "zod3";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TUTOR_CATALOG_ID } from "@/lib/progress-card";

/**
 * What an A2UI surface in the chat may be built from: the basic catalog, plus
 * `ProgressBar`, which it lacks. `Card` and `Text` keep the basic catalog's
 * names and schemas but are drawn by this design system, since the stock ones
 * bring a rounded, shadowed card and a 700-weight heading.
 *
 * Every prop that can be bound to the data model is a literal-or-binding
 * union (the `Dynamic*` schemas); the binder resolves it before the renderer
 * runs, so the renderers below only ever see plain values.
 */
const definitions = {
  Card: { props: CardApi.schema },
  Text: { props: TextApi.schema },
  ProgressBar: {
    description:
      "A horizontal bar filled to value out of max, with its figure in words above it. Bind value and max to the data model.",
    props: z.object({
      value: DynamicNumberSchema,
      max: DynamicNumberSchema,
      label: DynamicStringSchema,
    }),
  },
} satisfies CatalogDefinitions;

// Leaves carry the spacing, as in the basic catalog, so a Column or Row from it
// spaces them without a gap of its own: m-1 here and p-3 on the card make 8px
// between leaves and 16px to the card's edge.
const textClass = {
  h1: "text-xl font-semibold text-ink",
  h2: "text-xl font-semibold text-ink",
  h3: "text-base font-semibold text-ink",
  h4: "text-base font-semibold text-ink",
  h5: "text-base font-semibold text-ink",
  caption: "text-sm text-ink-mute tabular-nums",
  body: "text-base text-ink",
} as const;

export const tutorCatalog = createCatalog(
  definitions,
  {
    Card: ({ props, children }) => (
      <div className="w-full border border-edge bg-surface p-3">
        {children(props.child)}
      </div>
    ),
    Text: ({ props }) => {
      const variant = props.variant ?? "body";
      const Tag = variant === "caption" || variant === "body" ? "p" : variant;
      return (
        <Tag className={`m-1 ${textClass[variant]}`}>{String(props.text)}</Tag>
      );
    },
    ProgressBar: ({ props }) => (
      <div className="m-1">
        <ProgressBar
          value={Number(props.value)}
          max={Number(props.max)}
          label={String(props.label)}
        />
      </div>
    ),
  },
  // The basic components come first and ours after, so `Card` and `Text`
  // above replace the stock ones under the same name.
  { catalogId: TUTOR_CATALOG_ID, includeBasicCatalog: true },
);
