import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WaitingFor } from "../../../adapter/types.ts";
import { isWaitingForHandled } from "../../../game/waitingForRegistry.ts";
import { useGameStore } from "../../../stores/gameStore.ts";
import { TriggerOrderModal } from "../TriggerOrderModal.tsx";

function orderTriggersPrompt(sourceNames: [string, string]): WaitingFor {
  return {
    type: "OrderTriggers",
    data: {
      player: 0,
      triggers: sourceNames.map((sourceName, index) => ({
        source_id: index + 1,
        source_name: sourceName,
        description: `${sourceName} triggered ability`,
      })),
    },
  };
}

describe("TriggerOrderModal", () => {
  afterEach(() => {
    useGameStore.setState({
      waitingFor: null,
      dispatch: vi.fn().mockResolvedValue([]),
    });
  });

  it("is registered as a handled WaitingFor prompt", () => {
    expect(isWaitingForHandled(orderTriggersPrompt(["Dina", "Mazirek"]))).toBe(true);
  });

  it("resets local order when a same-sized engine prompt replaces the current one", async () => {
    const dispatch = vi.fn().mockResolvedValue([]);
    useGameStore.setState({
      waitingFor: orderTriggersPrompt(["Dina", "Mazirek"]),
      dispatch,
    });

    render(<TriggerOrderModal />);

    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    useGameStore.setState({
      waitingFor: orderTriggersPrompt(["Soul Warden", "Ajani's Pridemate"]),
    });

    await waitFor(() => {
      expect(screen.getByText("Soul Warden")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "OrderTriggers",
      data: { order: [0, 1] },
    });
  });
});
