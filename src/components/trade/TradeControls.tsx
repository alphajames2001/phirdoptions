// src/components/trade/TradeControls.tsx
import { useEffect, useState } from "react";
import {
  useApp,
  NEGATIVE_DIRECTIONS,
  formatMoney,
  estimatePayout,
  type ContractType,
  type Direction,
  type DurationUnit,
} from "@/lib/store";
import { placeTrade } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";

const UNIT_TO_MS: Record<DurationUnit, number> = {
  ticks: 1000,
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
};

const UNIT_MAX: Record<DurationUnit, number> = {
  ticks: 10,
  seconds: 60,
  minutes: 60,
  hours: 1,
};
const UNIT_MIN: Record<DurationUnit, number> = { ticks: 2, seconds: 5, minutes: 1, hours: 1 };

const STAKE_PRESETS = [2, 5, 10, 25, 50, 100];

function directionOptions(c: ContractType): { id: Direction; label: string }[] {
  switch (c) {
    case "rise_fall":
      return [
        { id: "rise", label: "Rise" },
        { id: "fall", label: "Fall" },
      ];
    case "over_under":
      return [
        { id: "over", label: "Over" },
        { id: "under", label: "Under" },
      ];
    case "match_differ":
      return [
        { id: "match", label: "Match" },
        { id: "differ", label: "Differ" },
      ];
    case "even_odd":
      return [
        { id: "even", label: "Even" },
        { id: "odd", label: "Odd" },
      ];
  }
}

export function TradeControls() {
  const contract = useApp((s) => s.contract);
  const volatility = useApp((s) => s.volatility);
  const price = useApp((s) => s.price);
  const openTrade = useApp((s) => s.openTrade);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const account = useApp((s) => s.account);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const syncAll = useApp((s) => s.syncAll);
  const balance = account === "demo" ? demoBalance : realBalance;

  const dirs = directionOptions(contract);
  const allowedUnits: DurationUnit[] =
    contract === "match_differ" || contract === "even_odd" || contract === "over_under"
      ? ["ticks"]
      : ["ticks", "seconds", "minutes", "hours"];

  const [unit, setUnit] = useState<DurationUnit>(
    contract === "match_differ" || contract === "even_odd" || contract === "over_under"
      ? "ticks"
      : "seconds",
  );
  // ✅ Allow empty string for duration
  const [durationVal, setDurationVal] = useState<number | string>(10);
  // ✅ Allow empty string for stake
  const [stake, setStake] = useState<number | string>(5);
  const [barrier, setBarrier] = useState<number>(0);
  const [placing, setPlacing] = useState<boolean>(false);

  useEffect(() => {
    if (!allowedUnits.includes(unit)) {
      const next = allowedUnits[0];
      setUnit(next);
      setDurationVal(UNIT_MIN[next]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  // Get numeric values for calculations
  const getDurationNum = (): number => {
    if (durationVal === '') return 0;
    return typeof durationVal === 'string' ? Number(durationVal) : durationVal;
  };

  const getStakeNum = (): number => {
    if (stake === '') return 0;
    return typeof stake === 'string' ? Number(stake) : stake;
  };

  const buy = async (dir: Direction) => {
    if (placing) return;

    // ✅ Validate duration
    const durationNum = getDurationNum();
    if (!durationNum || durationNum < UNIT_MIN[unit]) {
      toast.error(`Please enter a valid duration (min ${UNIT_MIN[unit]} ${unit})`);
      return;
    }
    if (durationNum > UNIT_MAX[unit]) {
      toast.error(`Duration cannot exceed ${UNIT_MAX[unit]} ${unit}`);
      return;
    }

    // ✅ Validate stake
    const stakeNum = getStakeNum();
    if (!stakeNum || stakeNum < 2) {
      toast.error("Please enter a valid stake (min $2)");
      return;
    }
    if (stakeNum > balance) {
      toast.error("Insufficient balance");
      window.dispatchEvent(new CustomEvent('open-deposit'));
      return;
    }

    setPlacing(true);
    try {
      const durationTicks = durationNum * (unit === 'ticks' ? 1 : unit === 'seconds' ? 1 : unit === 'minutes' ? 60 : 3600);
      const cappedDurationTicks = Math.min(durationTicks, 3600);

      const response = await placeTrade({
        accountType: account,
        symbol: volatility,
        contractType: contract,
        direction: dir,
        selectedDigit: contract === 'over_under' || contract === 'match_differ' ? barrier : undefined,
        stake: stakeNum,
        durationTicks: cappedDurationTicks,
      });

      if (response.success) {
        openTrade(
          {
            contract,
            direction: dir,
            volatility,
            stake: stakeNum,
            payout: response.data.potentialPayout,
            durationMs: cappedDurationTicks * 1000,
            entryPrice: response.data.entryPrice,
            barrier: contract === 'over_under' || contract === 'match_differ' ? barrier : undefined,
          },
          response.data.contractId,
        );

        toast.success(`Opened ${dir.toUpperCase()} for $${stakeNum.toFixed(2)}`, {
          description: `Trade #${response.data.contractId.slice(0, 6)} · settles in ${durationNum} ${unit}`,
        });

        syncAll();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to place trade");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md bg-card p-3">
        <div className="text-sm font-semibold">Duration</div>
        <div>
          <div className="mb-1 text-[10px] text-muted-foreground">Unit</div>
          <select
            value={unit}
            onChange={(e) => {
              const u = e.target.value as DurationUnit;
              setUnit(u);
              const currentVal = getDurationNum();
              if (currentVal) {
                setDurationVal(Math.min(UNIT_MAX[u], Math.max(UNIT_MIN[u], currentVal)));
              } else {
                setDurationVal(UNIT_MIN[u]);
              }
            }}
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs capitalize outline-none"
          >
            {allowedUnits.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] text-muted-foreground">Value</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const currentVal = getDurationNum();
                const newVal = currentVal ? Math.max(UNIT_MIN[unit], currentVal - 1) : UNIT_MIN[unit];
                setDurationVal(newVal);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded bg-elevated hover:bg-accent"
            >
              <Minus className="h-4 w-4" />
            </button>
            <Input
              type="number"
              min={UNIT_MIN[unit]}
              max={UNIT_MAX[unit]}
              value={durationVal}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setDurationVal(val);
                  return;
                }
                const n = Number(val);
                if (Number.isFinite(n)) {
                  setDurationVal(Math.min(UNIT_MAX[unit], Math.max(UNIT_MIN[unit], n)));
                }
              }}
              className="w-full flex-1 bg-transparent text-center text-xl font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              onClick={() => {
                const currentVal = getDurationNum();
                const newVal = currentVal ? Math.min(UNIT_MAX[unit], currentVal + 1) : UNIT_MIN[unit];
                setDurationVal(newVal);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded bg-elevated hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Min {UNIT_MIN[unit]} · Max {UNIT_MAX[unit]} {unit}
        </div>
      </div>

      <div className="rounded-md bg-card p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Stake</div>
            <div className="text-xs text-muted-foreground">USD · min $2</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const currentVal = getStakeNum();
                const newVal = currentVal ? Math.max(2, +(currentVal - 1).toFixed(2)) : 2;
                setStake(newVal);
              }}
              className="grid h-7 w-7 place-items-center rounded bg-elevated hover:bg-accent"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="flex items-baseline gap-0.5">
              <span className="text-xl">$</span>
              <Input
                type="number"
                min={2}
                step={0.5}
                value={stake}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setStake(val);
                    return;
                  }
                  const n = Number(val);
                  if (Number.isFinite(n)) {
                    setStake(Math.max(2, n));
                  }
                }}
                className="w-20 bg-transparent text-center text-2xl font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <button
              onClick={() => {
                const currentVal = getStakeNum();
                const newVal = currentVal ? +(currentVal + 1).toFixed(2) : 3;
                setStake(newVal);
              }}
              className="grid h-7 w-7 place-items-center rounded bg-elevated hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {STAKE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setStake(p)}
              className={`rounded px-2 py-0.5 text-xs ${
                stake === p ? "bg-primary text-primary-foreground" : "bg-elevated text-muted-foreground hover:text-foreground"
              }`}
            >
              ${p}
            </button>
          ))}
        </div>
      </div>

      {(contract === "over_under" || contract === "match_differ") && (
        <div className="rounded-md bg-card p-3">
          <div className="mb-1 text-sm font-semibold">Last digit prediction</div>
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <button
                key={i}
                onClick={() => setBarrier(i)}
                className={`rounded py-2 text-lg font-bold ${
                  barrier === i ? "bg-primary text-primary-foreground" : "bg-elevated text-muted-foreground hover:text-foreground"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sticky bottom-0 z-20 rounded-t-lg border-t border-border bg-background/95 pb-1 pt-2 backdrop-blur">
        <div className="flex flex-col gap-2">
          {dirs.map((d) => {
            const neg = NEGATIVE_DIRECTIONS.includes(d.id);
            const stakeNum = getStakeNum();
            const digit = contract === "over_under" || contract === "match_differ" ? barrier : undefined;
            const estimate = stakeNum > 0 ? estimatePayout(contract, stakeNum, d.id, digit) : 0;
            return (
              <button
                key={d.id}
                onClick={() => buy(d.id)}
                disabled={placing}
                className={`w-full rounded-lg py-3 font-heading font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  neg
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-primary hover:bg-primary/90"
                }`}
              >
                <div className="text-lg">{d.label}</div>
                <div className="text-xs font-medium text-white/90">
                  Payout: {formatMoney(estimate, currency, fxRate)}
                </div>
              </button>
            );
          })}
        </div>
        {placing && (
          <div className="mt-1 text-center text-xs text-muted-foreground">Placing trade…</div>
        )}
      </div>
    </div>
  );
}