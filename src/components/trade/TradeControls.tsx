// src/components/trade/TradeControls.tsx
import { useEffect, useMemo, useState } from "react";
import {
  useApp,
  NEGATIVE_DIRECTIONS,
  formatMoney,
  estimatePayout,
  type ContractType,
  type Direction,
  type DurationUnit,
} from "@/lib/store";
import { placeTrade, getPayoutPreview } from "@/lib/api";
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
  const [direction, setDirection] = useState<Direction>(dirs[0].id);
  const [unit, setUnit] = useState<DurationUnit>(contract === "match_differ" ? "ticks" : "seconds");
  // ✅ Allow empty string for duration
  const [durationVal, setDurationVal] = useState<number | string>(10);
  // ✅ Allow empty string for stake
  const [stake, setStake] = useState<number | string>(5);
  const [barrier, setBarrier] = useState<number>(0);
  const [payout, setPayout] = useState<number>(0);
  const [payoutLoading, setPayoutLoading] = useState<boolean>(false);

  useMemo(() => {
    if (!dirs.some((d) => d.id === direction)) setDirection(dirs[0].id);
  }, [contract]);

  const isNegative = NEGATIVE_DIRECTIONS.includes(direction);

  // Instant client-side estimate
  useEffect(() => {
    const digit = (contract === 'over_under' || contract === 'match_differ') ? barrier : undefined;
    // ✅ Only calculate if stake is valid
    const stakeNum = typeof stake === 'string' ? Number(stake) : stake;
    if (stakeNum && stakeNum > 0) {
      setPayout(estimatePayout(contract, stakeNum, direction, digit));
    } else {
      setPayout(0);
    }
  }, [contract, stake, direction, barrier]);

  // Debounced authoritative fetch
  useEffect(() => {
    let cancelled = false;
    setPayoutLoading(true);
    const t = setTimeout(async () => {
      try {
        const digit = (contract === 'over_under' || contract === 'match_differ') ? barrier : undefined;
        const stakeNum = typeof stake === 'string' ? Number(stake) : stake;
        if (!stakeNum || stakeNum < 2) {
          setPayoutLoading(false);
          return;
        }
        const res = await getPayoutPreview(contract, stakeNum, direction, digit);
        if (!cancelled && res.success) setPayout(res.data.potentialPayout);
      } catch {
        // keep the last known (estimated) payout on a transient error
      } finally {
        if (!cancelled) setPayoutLoading(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [contract, stake, direction, barrier]);

  // Get numeric values for calculations
  const getDurationNum = (): number => {
    if (durationVal === '') return 0;
    return typeof durationVal === 'string' ? Number(durationVal) : durationVal;
  };

  const getStakeNum = (): number => {
    if (stake === '') return 0;
    return typeof stake === 'string' ? Number(stake) : stake;
  };

  const buy = async () => {
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
      return;
    }

    try {
      const durationTicks = durationNum * (unit === 'ticks' ? 1 : unit === 'seconds' ? 1 : unit === 'minutes' ? 60 : 3600);
      const cappedDurationTicks = Math.min(durationTicks, 3600);

      const response = await placeTrade({
        accountType: account,
        symbol: volatility,
        contractType: contract,
        direction,
        selectedDigit: contract === 'over_under' || contract === 'match_differ' ? barrier : undefined,
        stake: stakeNum,
        durationTicks: cappedDurationTicks,
      });

      if (response.success) {
        openTrade(
          {
            contract,
            direction,
            volatility,
            stake: stakeNum,
            payout: response.data.potentialPayout,
            durationMs: cappedDurationTicks * 1000,
            entryPrice: response.data.entryPrice,
            barrier: contract === 'over_under' || contract === 'match_differ' ? barrier : undefined,
          },
          response.data.contractId,
        );

        toast.success(`Opened ${direction.toUpperCase()} for $${stakeNum.toFixed(2)}`, {
          description: `Trade #${response.data.contractId.slice(0, 6)} · settles in ${durationNum} ${unit}`,
        });

        syncAll();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to place trade");
    }
  };

  const allowedUnits: DurationUnit[] =
    contract === "match_differ" || contract === "even_odd" || contract === "over_under"
      ? ["ticks"]
      : ["ticks", "seconds", "minutes", "hours"];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-md bg-card p-2">
        {dirs.map((d) => {
          const active = d.id === direction;
          const neg = NEGATIVE_DIRECTIONS.includes(d.id);
          return (
            <button
              key={d.id}
              onClick={() => setDirection(d.id)}
              className={`rounded-md py-3 text-lg font-bold transition border-2 ${
                active
                  ? neg
                    ? "border-destructive text-destructive"
                    : "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-md bg-card p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Duration</div>
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
              className="bg-transparent text-xs text-muted-foreground capitalize outline-none"
            >
              {allowedUnits.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const currentVal = getDurationNum();
                const newVal = currentVal ? Math.max(UNIT_MIN[unit], currentVal - 1) : UNIT_MIN[unit];
                setDurationVal(newVal);
              }}
              className="grid h-7 w-7 place-items-center rounded bg-elevated hover:bg-accent"
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
              className="w-16 bg-transparent text-center text-2xl font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              onClick={() => {
                const currentVal = getDurationNum();
                const newVal = currentVal ? Math.min(UNIT_MAX[unit], currentVal + 1) : UNIT_MIN[unit];
                setDurationVal(newVal);
              }}
              className="grid h-7 w-7 place-items-center rounded bg-elevated hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
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

      <button
        onClick={buy}
        className="w-full py-3 font-heading rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 shadow-[0_0_0_0_rgba(124,58,237,0)] hover:shadow-[0_0_20px_rgba(124,58,237,0.25)] transition-all"
      >
        <div>Buy</div>
        <div className="text-xs font-medium">
          Potential Payout: {formatMoney(payout, currency, fxRate)}
        </div>
      </button>
    </div>
  );
}