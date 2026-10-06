// jsdom, the config default — this one renders, unlike the node-env tests.
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { tutorCatalog } from "@/components/a2ui-catalog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { progressCardOperations } from "@/lib/progress-card";

describe("ProgressBar", () => {
  test("states the figure in words and exposes it as a progressbar", () => {
    render(<ProgressBar value={2} max={3} label="2 of 3 done" />);

    const bar = screen.getByRole("progressbar", { name: "2 of 3 done" });
    expect(screen.getByText("2 of 3 done")).toBeVisible();
    expect(bar).toHaveAttribute("aria-valuenow", "67");
    expect(bar).toHaveAttribute("aria-valuetext", "2 of 3 done");
    expect(bar.firstElementChild).toHaveStyle({ width: "67%" });
  });

  test("draws an empty track for an empty whole instead of dividing by zero", () => {
    render(<ProgressBar value={0} max={0} label="0 of 0 done" />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar.firstElementChild).toHaveStyle({ width: "0%" });
  });

  test("never overfills or underfills the track", () => {
    const { rerender } = render(<ProgressBar value={5} max={3} label="over" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    rerender(<ProgressBar value={-1} max={3} label="under" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

describe("the progress card through the tutor catalog", () => {
  // What the chat's activity renderer does with a tool result's operations,
  // minus the CopilotKit provider around it.
  function Surface({ operations }: { operations: object[] }) {
    const { processMessages } = useA2UIActions();
    useEffect(() => {
      processMessages(operations as Parameters<typeof processMessages>[0]);
    }, [operations, processMessages]);
    return <A2UIRenderer surfaceId="card" />;
  }

  test("resolves every figure from the data model, ProgressBar included", async () => {
    const operations = progressCardOperations("card", {
      total: 3,
      done: 2,
      open: 1,
      donePercent: 67,
      openPercent: 33,
    });

    const { container } = render(
      <A2UIProvider catalog={tutorCatalog}>
        <Surface operations={operations} />
      </A2UIProvider>,
    );

    const bar = await screen.findByRole("progressbar", {
      name: "2 of 3 done",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "67");
    expect(screen.getByText("Progress on the list")).toBeVisible();
    expect(screen.getByText("2 done · 67%")).toBeVisible();
    expect(screen.getByText("1 open · 33%")).toBeVisible();
    // The catalog's own Card, not the basic one with its radius and shadow.
    expect(container.querySelector('[style*="box-shadow"]')).toBeNull();
    expect(container.querySelector('[style*="border-radius"]')).toBeNull();
  });
});
