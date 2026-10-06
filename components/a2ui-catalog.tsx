"use client";

import {
  CardApi,
  ChoicePickerApi,
  DateTimeInputApi,
  TextApi,
  TextFieldApi,
} from "@a2ui/web_core/v0_9/basic_catalog";
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
import { type ReactNode, useId } from "react";
import { z } from "zod3";
import { inputClass } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TUTOR_CATALOG_ID } from "@/lib/progress-card";

/**
 * What an A2UI surface in the chat or on the project page may be built from:
 * the basic catalog, plus `ProgressBar` and `FieldError`, which it lacks. `Card`, `Text` and
 * the three inputs keep the basic catalog's names and schemas but are drawn by
 * this design system, since the stock ones bring a rounded, shadowed card,
 * 700-weight headings and labels, and rounded inputs.
 *
 * Every prop that can be bound to the data model is a literal-or-binding
 * union (the `Dynamic*` schemas); the binder resolves it before the renderer
 * runs, so the renderers below only ever see plain values.
 */
const definitions = {
  Card: { props: CardApi.schema },
  Text: { props: TextApi.schema },
  TextField: { props: TextFieldApi.schema },
  DateTimeInput: { props: DateTimeInputApi.schema },
  ChoicePicker: { props: ChoicePickerApi.schema },
  FieldError: {
    description:
      "The error for the input just before it, drawn under that input. Bind text to the data model; nothing shows while it is empty.",
    props: z.object({ text: DynamicStringSchema }),
  },
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

/**
 * What the binder hands an input beside its resolved props: the setter for a
 * prop bound to the data model, which writes the edit back to that path, and
 * the messages of any failed `checks`. createCatalog's types leave both out.
 */
type Bound<T> = { setValue?: (value: T) => void; validationErrors?: string[] };

/**
 * The record-card row (see the design skill): the label in a fixed left
 * column and the input filling the rest, stacked on a narrow screen.
 */
function InputRow({
  label,
  labelId,
  htmlFor,
  errors,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  errors?: string[];
  children: ReactNode;
}) {
  // A group of options is named through aria-labelledby, not a <label>.
  const Label = htmlFor ? "label" : "span";
  return (
    <div className="m-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      {/* pt-2 lines the label up with the text inside the input's py-2.
          FieldError's indent below follows this column's width and gap. */}
      <Label
        id={labelId}
        htmlFor={htmlFor}
        className="text-sm text-ink-mute sm:w-36 sm:shrink-0 sm:pt-2"
      >
        {label}
      </Label>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {errors?.[0] && <p className="text-sm text-danger">{errors[0]}</p>}
      </div>
    </div>
  );
}

const inputTypes = {
  shortText: "text",
  number: "number",
  obscured: "password",
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
    TextField: ({ props }) => {
      const id = useId();
      const { setValue, validationErrors } = props as Bound<string>;
      const field = {
        id,
        className: `w-full ${inputClass}`,
        value: String(props.value ?? ""),
        onChange: (event: { target: { value: string } }) =>
          setValue?.(event.target.value),
      };
      return (
        <InputRow
          label={String(props.label)}
          htmlFor={id}
          errors={validationErrors}
        >
          {props.variant === "longText" ? (
            <textarea rows={2} {...field} />
          ) : (
            <input type={inputTypes[props.variant ?? "shortText"]} {...field} />
          )}
        </InputRow>
      );
    },
    DateTimeInput: ({ props }) => {
      const id = useId();
      const { setValue, validationErrors } = props as Bound<string>;
      const type = !props.enableTime
        ? "date"
        : props.enableDate
          ? "datetime-local"
          : "time";
      return (
        <InputRow
          label={String(props.label ?? "")}
          htmlFor={id}
          errors={validationErrors}
        >
          {/* scheme-light-dark so the browser's own picker follows the theme. */}
          <input
            id={id}
            type={type}
            className={`w-full scheme-light-dark ${inputClass}`}
            value={String(props.value ?? "")}
            min={String(props.min ?? "") || undefined}
            max={String(props.max ?? "") || undefined}
            onChange={(event) => setValue?.(event.target.value)}
          />
        </InputRow>
      );
    },
    // `displayStyle` and `filterable` are not drawn: a short list of options
    // reads the same either way, and the design system has no chips.
    ChoicePicker: ({ props }) => {
      const id = useId();
      const { setValue, validationErrors } = props as Bound<string[]>;
      const selected = Array.isArray(props.value)
        ? props.value.map(String)
        : [];
      const single = props.variant !== "multipleSelection";
      const toggle = (value: string) =>
        setValue?.(
          single
            ? [value]
            : selected.includes(value)
              ? selected.filter((item) => item !== value)
              : [...selected, value],
        );
      return (
        <InputRow
          label={String(props.label ?? "")}
          labelId={id}
          errors={validationErrors}
        >
          <fieldset
            aria-labelledby={id}
            className="flex flex-wrap gap-x-4 gap-y-1 sm:pt-2"
          >
            {props.options.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-1.5 text-base text-ink"
              >
                <input
                  type={single ? "radio" : "checkbox"}
                  name={id}
                  className="accent-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {String(option.label)}
              </label>
            ))}
          </fieldset>
        </InputRow>
      );
    },
    // Always in the tree, so the live region exists before a message arrives.
    // sm:pl-39 is the label column's w-36 plus the row's gap-3, which puts the
    // message under the input; no top margin keeps it with that input.
    FieldError: ({ props }) => (
      <p
        aria-live="polite"
        className={props.text ? "mx-1 mb-1 text-sm text-danger sm:pl-39" : ""}
      >
        {String(props.text ?? "")}
      </p>
    ),
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
