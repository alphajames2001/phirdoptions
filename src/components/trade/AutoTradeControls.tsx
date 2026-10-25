// src/components/trade/AutoTradeControls.tsx
import { useState, useEffect } from "react";
import { useApp, CONTRACTS, NEGATIVE_DIRECTIONS, formatMoney, type Direction, type ContractType, type DurationUnit } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, Square, TrendingUp, TrendingDown, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";

const UNIT_LABELS: Record<DurationUnit, string> = {
  ticks: "Ticks",
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
};

const UNIT_TO_MS: Record<DurationUnit, number> = {
  ticks: 1000,
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
};

const UNIT_MAX: Record<DurationUnit, number> = {
  ticks: 100,
  seconds: 300,
  minutes: 60,
  hours: 24,
};

const UNIT_MIN: Record<DurationUnit, number> = {
  ticks: 1,
  seconds: 5,
  minutes: 1,
  hours: 1,
};

const STAKE_PRESETS = [2, 5, 10, 25, 50];

const ALLOWED_UNITS: Record<ContractType, DurationUnit[]> = {
  rise_fall: ["ticks", "seconds", "minutes", "hours"],
  over_under: ["ticks"],
  match_differ: ["ticks"],
  even_odd: ["ticks"],
};

const DEFAULT_UNIT: Record<ContractType, DurationUnit> = {
  rise_fall: "seconds",
  over_under: "ticks",
  match_differ: "ticks",
  even_odd: "ticks",
};

const DEFAULT_DURATION: Record<ContractType, number> = {
  rise_fall: 30,
  over_under: 10,
  match_differ: 10,
  even_odd: 10,
};

const DIGIT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function AutoTradeControls() {
  const autoTrade = useApp((s) => s.autoTrade);
  const startAutoTrade = useApp((s) => s.startAutoTrade);
  const stopAutoTrade = useApp((s) => s.stopAutoTrade);
  const account = useApp((s) => s.account);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const setContract = useApp((s) => s.setContract);

  const [direction, setDirection] = useState<Direction>("rise");
  const [contract, setContractLocal] = useState<ContractType>("rise_fall");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("seconds");
  // ✅ Allow empty strings
  const [durationVal, setDurationVal] = useState<number | string>(30);
  const [stake, setStake] = useState<number | string>(5);
  const [stopLoss, setStopLoss] = useState<number | string>(20);
  const [takeProfit, setTakeProfit] = useState<number | string>(10);
  const [barrier, setBarrier] = useState<number>(5);

  const balance = account === "demo" ? demoBalance : realBalance;
  const isRunning = autoTrade.isRunning;

  const allowedUnits = ALLOWED_UNITS[contract] || ["ticks"];

  const getDurationNum = (): number => {
    if (durationVal === '') return 0;
    return typeof durationVal === 'string' ? Number(durationVal) : durationVal;
  };

  const getStakeNum = (): number => {
    if (stake === '') return 0;
    return typeof stake === 'string' ? Number(stake) : stake;
  };

  const getStopLossNum = (): number => {
    if (stopLoss === '') return 0;
    return typeof stopLoss === 'string' ? Number(stopLoss) : stopLoss;
  };

  const getTakeProfitNum = (): number => {
    if (takeProfit === '') return 0;
    return typeof takeProfit === 'string' ? Number(takeProfit) : takeProfit;
  };

  const handleContractChange = (c: ContractType) => {
    setContractLocal(c);
    setContract(c);
    
    const defaultUnit = DEFAULT_UNIT[c];
    const defaultDuration = DEFAULT_DURATION[c];
    setDurationUnit(defaultUnit);
    setDurationVal(defaultDuration);
    
    if (c !== "over_under" && c !== "match_differ") {
      setBarrier(5);
    }
  };

  const contractOptions = CONTRACTS;

  const getDirectionOptions = (c: ContractType) => {
    switch (c) {
      case "rise_fall":
        return [
          { id: "rise", label: "Rise", icon: TrendingUp, color: "text-primary" },
          { id: "fall", label: "Fall", icon: TrendingDown, color: "text-destructive" },
        ];
      case "over_under":
        return [
          { id: "over", label: "Over", icon: TrendingUp, color: "text-primary" },
          { id: "under", label: "Under", icon: TrendingDown, color: "text-destructive" },
        ];
      case "match_differ":
        return [
          { id: "match", label: "Match", icon: TrendingUp, color: "text-primary" },
          { id: "differ", label: "Differ", icon: TrendingDown, color: "text-destructive" },
        ];
      case "even_odd":
        return [
          { id: "even", label: "Even", icon: TrendingUp, color: "text-primary" },
          { id: "odd", label: "Odd", icon: TrendingDown, color: "text-destructive" },
        ];
    }
  };

  useEffect(() => {
    const dirs = getDirectionOptions(contract);
    const currentExists = dirs.some(d => d.id === direction);
    if (!currentExists && dirs.length > 0) {
      setDirection(dirs[0].id as Direction);
    }
    if (contract !== "over_under" && contract !== "match_differ") {
      setBarrier(5);
    }
  }, [contract]);

  const showBarrier = contract === "over_under" || contract === "match_differ";

  const handleStart = () => {
    // ✅ Validate stake
    const stakeNum = getStakeNum();
    if (!stakeNum || stakeNum < 1) {
      toast.error("Please enter a valid stake (min $1)");
      return;
    }
    if (stakeNum > balance / 2) {
      toast.error(`Stake cannot exceed half of your balance (${formatMoney(balance / 2, currency, fxRate)})`);
      return;
    }

    // ✅ Validate stop loss
    const stopLossNum = getStopLossNum();
    if (!stopLossNum || stopLossNum < stakeNum) {
      toast.error(`Stop Loss must be greater than or equal to stake (${formatMoney(stakeNum, currency, fxRate)})`);
      return;
    }

    // ✅ Validate take profit
    const takeProfitNum = getTakeProfitNum();
    if (!takeProfitNum || takeProfitNum < stakeNum) {
      toast.error(`Take Profit must be greater than or equal to stake (${formatMoney(stakeNum, currency, fxRate)})`);
      return;
    }

    // ✅ Validate duration
    const durationNum = getDurationNum();
    if (!durationNum || durationNum < UNIT_MIN[durationUnit]) {
      toast.error(`Please enter a valid duration (min ${UNIT_MIN[durationUnit]} ${durationUnit})`);
      return;
    }
    if (durationNum > UNIT_MAX[durationUnit]) {
      toast.error(`Duration cannot exceed ${UNIT_MAX[durationUnit]} ${durationUnit}`);
      return;
    }

    const durationMs = durationNum * UNIT_TO_MS[durationUnit];
    
    console.log(`[Auto Trade] Starting with duration: ${durationNum} ${durationUnit} = ${durationMs}ms`);

    startAutoTrade({
      direction,
      contract,
      stake: stakeNum,
      stopLoss: stopLossNum,
      takeProfit: takeProfitNum,
      durationMs,
      durationUnit,
      durationVal: durationNum,
      barrier: showBarrier ? barrier : undefined,
    });
  };

  const handleStop = () => {
    stopAutoTrade();
  };

  const dirs = getDirectionOptions(contract);

  return (
    <div className="space-y-4">
      {isRunning ? (
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                </span>
                <span className="font-semibold">Auto Trading Active</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {autoTrade.direction.toUpperCase()} · {autoTrade.contract.replace('_', ' ')}
                {autoTrade.barrier !== undefined && ` · Digit: ${autoTrade.barrier}`}
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={handleStop}>
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-muted-foreground">Trades</div>
              <div className="font-semibold">{autoTrade.tradesCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">P&L</div>
              <div className={`font-semibold ${autoTrade.totalPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                {autoTrade.totalPnl >= 0 ? "+" : ""}
                {formatMoney(autoTrade.totalPnl, currency, fxRate)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Wins</div>
              <div className="font-semibold text-primary">{autoTrade.wins}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Losses</div>
              <div className="font-semibold text-destructive">{autoTrade.losses}</div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>Stop Loss: {formatMoney(autoTrade.stopLoss, currency, fxRate)}</span>
            <span>Take Profit: {formatMoney(autoTrade.takeProfit, currency, fxRate)}</span>
            <span>Stake: {formatMoney(autoTrade.stake, currency, fxRate)}</span>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Contract Type */}
          <div>
            <Label className="text-xs text-muted-foreground">Contract Type</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {contractOptions.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleContractChange(c.id as ContractType)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    c.id === contract
                      ? "bg-primary text-primary-foreground"
                      : "bg-elevated text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <Label className="text-xs text-muted-foreground">Direction</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {dirs.map((d) => {
                const active = d.id === direction;
                const isNeg = NEGATIVE_DIRECTIONS.includes(d.id as Direction);
                return (
                  <button
                    key={d.id}
                    onClick={() => setDirection(d.id as Direction)}
                    className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 font-semibold transition ${
                      active
                        ? isNeg
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <d.icon className={`h-4 w-4 ${active ? d.color : ""}`} />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Barrier/Digit selector */}
          {showBarrier && (
            <div>
              <Label className="text-xs text-muted-foreground">
                {contract === "over_under" ? "Last digit barrier" : "Digit to match/differ"}
              </Label>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {DIGIT_OPTIONS.map((digit) => (
                  <button
                    key={digit}
                    onClick={() => setBarrier(digit)}
                    className={`rounded-md py-2 text-sm font-bold transition ${
                      barrier === digit
                        ? "bg-primary text-primary-foreground"
                        : "bg-elevated text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {digit}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground text-center">
                {contract === "over_under" 
                  ? "Price ends above or below this digit" 
                  : "Price ends matching or differing from this digit"}
              </div>
            </div>
          )}

          {/* Duration */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground">Duration</Label>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <select
                  value={durationUnit}
                  onChange={(e) => {
                    const unit = e.target.value as DurationUnit;
                    setDurationUnit(unit);
                    const max = UNIT_MAX[unit];
                    const min = UNIT_MIN[unit];
                    const currentVal = getDurationNum();
                    if (currentVal) {
                      setDurationVal(Math.min(max, Math.max(min, currentVal)));
                    } else {
                      setDurationVal(min);
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {allowedUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {UNIT_LABELS[unit]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 flex items-center gap-1">
                <Input
                  type="number"
                  min={UNIT_MIN[durationUnit]}
                  max={UNIT_MAX[durationUnit]}
                  value={durationVal}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setDurationVal(val);
                      return;
                    }
                    const n = Number(val);
                    if (Number.isFinite(n)) {
                      setDurationVal(Math.min(UNIT_MAX[durationUnit], Math.max(UNIT_MIN[durationUnit], n)));
                    }
                  }}
                  className="w-full text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground text-center">
              {durationUnit === "ticks" 
                ? `${durationVal} ticks = ${durationVal} seconds`
                : `${UNIT_MIN[durationUnit]} – ${UNIT_MAX[durationUnit]} ${durationUnit}`}
            </div>
          </div>

          {/* Stake */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Stake per trade</Label>
              <span className="text-sm font-medium">{formatMoney(getStakeNum() || 0, currency, fxRate)}</span>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={Math.min(50, balance / 2)}
                step={0.5}
                value={stake}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setStake(val);
                    return;
                  }
                  const n = Number(val);
                  if (Number.isFinite(n)) setStake(Math.max(1, n));
                }}
                className="flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
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
              <button
                onClick={() => setStake(Math.min(balance / 2, 50))}
                className="rounded px-2 py-0.5 text-xs bg-elevated text-muted-foreground hover:text-foreground"
              >
                Max
              </button>
            </div>
          </div>

          {/* Stop Loss & Take Profit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs text-muted-foreground">Stop Loss</Label>
                <span className="text-xs font-medium text-destructive">
                  {formatMoney(getStopLossNum() || 0, currency, fxRate)}
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={stopLoss}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setStopLoss(val);
                    return;
                  }
                  const n = Number(val);
                  if (Number.isFinite(n)) setStopLoss(Math.max(1, n));
                }}
                className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs text-muted-foreground">Take Profit</Label>
                <span className="text-xs font-medium text-primary">
                  {formatMoney(getTakeProfitNum() || 0, currency, fxRate)}
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={takeProfit}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setTakeProfit(val);
                    return;
                  }
                  const n = Number(val);
                  if (Number.isFinite(n)) setTakeProfit(Math.max(1, n));
                }}
                className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Risk warning */}
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2">
            <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              Auto trading will stop when <strong>Stop Loss</strong> or <strong>Take Profit</strong> is hit.
              Each trade uses the selected direction and contract type.
            </div>
          </div>

          {/* Balance info */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Available: {formatMoney(balance, currency, fxRate)}</span>
            <span>Min stake: {formatMoney(1, currency, fxRate)}</span>
          </div>

          {/* Start button */}
          <Button
            onClick={handleStart}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={balance < getStakeNum() * 2 || !getStakeNum()}
          >
            <Play className="h-4 w-4 mr-2" />
            Start Auto Trading
          </Button>

          {balance < getStakeNum() * 2 && getStakeNum() > 0 && (
            <p className="text-center text-xs text-destructive">
              Insufficient balance. Need at least {formatMoney(getStakeNum() * 2, currency, fxRate)} to start.
            </p>
          )}
        </div>
      )}
    </div>
  );
}