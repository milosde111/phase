import type { CastingVariant, GameAction, WaitingFor } from "../../adapter/types.ts";
import { useCanActForWaitingState } from "../../hooks/usePlayerId.ts";
import { useGameStore } from "../../stores/gameStore.ts";
import { ManaCostSymbols } from "../mana/ManaCostSymbols.tsx";
import { DialogShell } from "./DialogShell.tsx";

type CastingVariantChoice = Extract<
  WaitingFor,
  { type: "CastingVariantChoice" }
>;

const VARIANT_LABELS: Partial<Record<CastingVariant["type"], string>> = {
  Normal: "Cast Normally",
  Adventure: "Cast as Adventure",
  Omen: "Cast as Omen",
  Warp: "Cast with Warp",
  Escape: "Cast with Escape",
  Retrace: "Cast with Retrace",
  Harmonize: "Cast with Harmonize",
  Flashback: "Cast with Flashback",
  Aftermath: "Cast with Aftermath",
  GraveyardPermission: "Cast from Graveyard",
  HandPermission: "Cast from Hand",
  Miracle: "Cast with Miracle",
  Madness: "Cast with Madness",
  Evoke: "Cast with Evoke",
  Suspend: "Cast from Suspend",
  Plot: "Cast from Plot",
  Foretell: "Cast from Foretell",
  Overload: "Cast with Overload",
  Bestow: "Cast with Bestow",
};

export function CastingVariantModal() {
  const canActForWaitingState = useCanActForWaitingState();
  const waitingFor = useGameStore((s) => s.waitingFor);
  const dispatch = useGameStore((s) => s.dispatch);

  if (waitingFor?.type !== "CastingVariantChoice") return null;
  if (!canActForWaitingState) return null;

  return (
    <CastingVariantContent
      data={waitingFor.data}
      dispatch={dispatch}
    />
  );
}

function CastingVariantContent({
  data,
  dispatch,
}: {
  data: CastingVariantChoice["data"];
  dispatch: (action: GameAction) => Promise<unknown>;
}) {
  const obj = useGameStore((s) => s.gameState?.objects[data.object_id]);
  if (!obj) return null;

  return (
    <DialogShell
      eyebrow="Cast"
      title="Choose Cast"
      subtitle={obj.name}
    >
      <div className="flex flex-col gap-2 px-3 py-3 lg:px-5 lg:py-5">
        {data.options.map((option, index) => (
          <button
            key={`${option.variant.type}-${index}`}
            onClick={() =>
              dispatch({
                type: "ChooseCastingVariant",
                data: { index },
              })
            }
            className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3 text-left transition hover:bg-white/8 hover:ring-1 hover:ring-cyan-400/30"
          >
            <span className="font-semibold text-white">
              {labelForVariant(option.variant)}
            </span>
            <span className="ml-2">
              <ManaCostSymbols cost={option.mana_cost} />
            </span>
          </button>
        ))}
      </div>
    </DialogShell>
  );
}

function labelForVariant(variant: CastingVariant): string {
  return VARIANT_LABELS[variant.type] ?? `Cast with ${variant.type}`;
}
