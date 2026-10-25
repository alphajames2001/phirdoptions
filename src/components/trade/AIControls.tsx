// src/components/trade/AIControls.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useApp, formatMoney, VOLATILITIES, CONTRACTS, STAKE_RANGES, type VolatilityId, type Direction, type ContractType, type RiskTolerance } from "@/lib/store";
import { AIEngine, getAIEngine, type AIDecision, type AIPerformance, type MarketData } from "@/lib/ai-engine";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  XCircle,
  BarChart3,
  Zap,
  Shield,
  Loader2,
  RefreshCw,
  Play,
  Square,
  Sparkles,
  Target,
  Activity,
  Info,
} from "lucide-react";
import { toast } from "sonner";

const RISK_LABELS: Record<RiskTolerance, string> = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
};

const CONTRACT_LABELS: Record<ContractType, string> = {
  rise_fall: 'Rise/Fall',
  over_under: 'Over/Under',
  match_differ: 'Match/Differ',
  even_odd: 'Even/Odd',
};

type LockedContract = ContractType | 'auto';

const LOCKED_CONTRACT_OPTIONS: { value: LockedContract; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'rise_fall', label: 'Rise/Fall' },
  { value: 'over_under', label: 'Over/Under' },
  { value: 'match_differ', label: 'Match/Differ' },
  { value: 'even_odd', label: 'Even/Odd' },
];

// Sane bounds for the manual duration input, in seconds.
const MIN_DURATION_SECONDS = 5;
const MAX_DURATION_SECONDS = 3600;
const DEFAULT_DURATION_SECONDS = 5;

export function AIControls() {
  const autoTrade = useApp((s) => s.autoTrade);
  const startAutoTrade = useApp((s) => s.startAutoTrade);
  const stopAutoTrade = useApp((s) => s.stopAutoTrade);
  const account = useApp((s) => s.account);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const price = useApp((s) => s.price);
  const prevPrice = useApp((s) => s.prevPrice);
  const trades = useApp((s) => s.trades);
  const setVolatility = useApp((s) => s.setVolatility);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [decision, setDecision] = useState<AIDecision | null>(null);
  const [performance, setPerformance] = useState<AIPerformance | null>(null);
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>('moderate');
  const [autoExecute, setAutoExecute] = useState(false);
  const [engine] = useState(() => getAIEngine());
  const [aiRunning, setAiRunning] = useState(false);
  const [decisionHistory, setDecisionHistory] = useState<AIDecision[]>([]);
  const [pendingDecision, setPendingDecision] = useState<AIDecision | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lockedContract, setLockedContract] = useState<LockedContract>('auto');
  // ✅ Allow empty string for duration
  const [durationSeconds, setDurationSeconds] = useState<number | string>(DEFAULT_DURATION_SECONDS);
  // ✅ Allow empty string for stake override
  const [stakeOverride, setStakeOverride] = useState<number | string | null>(null);
  const analysisIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const balance = account === "demo" ? demoBalance : realBalance;
  const isAutoRunning = autoTrade.isRunning;

  // ── Helper: get numeric values ──
  const getDurationNum = (): number => {
    if (durationSeconds === '') return 0;
    return typeof durationSeconds === 'string' ? Number(durationSeconds) : durationSeconds;
  };

  const getStakeOverrideNum = (): number | null => {
    if (stakeOverride === null || stakeOverride === '') return null;
    return typeof stakeOverride === 'string' ? Number(stakeOverride) : stakeOverride;
  };

  // ── Cleanup on unmount ─────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
    };
  }, []);

  // ── Collect market data ─────────────────────────────────────────

  const collectMarketData = useCallback((): MarketData[] => {
    return VOLATILITIES.map((v) => {
      const offset = v.id === 'v100_1s' ? 0 : v.id === 'v50_1s' ? -50 : -100;
      const symbolPrice = price + offset;
      const symbolPrevPrice = prevPrice + offset;
      return {
        symbol: v.id,
        price: symbolPrice,
        prevPrice: symbolPrevPrice,
        change: symbolPrice - symbolPrevPrice,
        changePct: symbolPrevPrice !== 0 ? ((symbolPrice - symbolPrevPrice) / symbolPrevPrice) * 100 : 0,
        volatility: v.vol,
        lastDigit: Math.floor(Math.abs(symbolPrice)) % 10,
      };
    });
  }, [price, prevPrice]);

  // ── Run AI analysis ─────────────────────────────────────────────

  const runAnalysis = useCallback(() => {
    if (isAutoRunning) {
      console.log('[AI] Auto trading is running, skipping analysis');
      return;
    }

    if (isAnalyzing) {
      console.log('[AI] Analysis already in progress, skipping');
      return;
    }

    setIsAnalyzing(true);
    
    try {
      const markets = collectMarketData();
      const decision = engine.evaluate(
        markets,
        balance,
        riskTolerance,
        lockedContract === 'auto' ? undefined : lockedContract
      );
      
      if (!isMountedRef.current) return;

      if (decision) {
        setDecision(decision);
        setPendingDecision(decision);
        setVolatility(decision.symbol);
        // Reset any prior manual override so the stake input shows
        // this decision's own suggestion by default.
        setStakeOverride(null);
        console.log('[AI] Decision made:', decision);
        
        if (!autoExecute) {
          toast.info(`AI recommends ${decision.symbol} ${CONTRACT_LABELS[decision.contract]} ${decision.direction.toUpperCase()}`, {
            description: `Confidence: ${decision.confidence.toFixed(0)}% · EV: $${decision.expectedValue.toFixed(2)} per $1`,
            duration: 5000,
          });
        } else {
          executeDecision(decision);
        }
      } else {
        setDecision(null);
        setPendingDecision(null);
        if (!aiRunning) {
          toast.info('AI analysis complete — No clear opportunity found');
        }
      }
      
      setPerformance(engine.getPerformance());
      setDecisionHistory(engine.getDecisionHistory(10));
      
    } catch (err) {
      console.error('[AI] Analysis error:', err);
      if (isMountedRef.current) {
        toast.error('AI analysis failed');
      }
    } finally {
      if (isMountedRef.current) {
        setIsAnalyzing(false);
      }
    }
  }, [engine, collectMarketData, balance, riskTolerance, lockedContract, setVolatility, autoExecute, isAutoRunning, isAnalyzing, aiRunning]);

  // ── Execute AI decision ─────────────────────────────────────────

  const executeDecision = useCallback((decisionToExecute: AIDecision) => {
    if (isAutoRunning) {
      toast.warning('Auto trading is already running');
      return;
    }

    if (isExecuting) return;

    // ✅ Validate duration
    const durationNum = getDurationNum();
    if (!durationNum || durationNum < MIN_DURATION_SECONDS || durationNum > MAX_DURATION_SECONDS) {
      toast.error(`Please enter a valid duration (${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} seconds)`);
      return;
    }

    // ✅ Validate stake
    const overrideNum = getStakeOverrideNum();
    const stake = overrideNum ?? decisionToExecute.suggestedStake;
    if (!stake || stake < 0.5) {
      toast.error('Please enter a valid stake amount (min $0.50)');
      return;
    }
    if (stake > balance * 0.5) {
      toast.error(`Stake cannot exceed half of your balance (${formatMoney(balance * 0.5, currency, fxRate)})`);
      return;
    }

    setIsExecuting(true);

    try {
      const stopLoss = decisionToExecute.suggestedStopLoss;
      const takeProfit = decisionToExecute.suggestedTakeProfit;

      // Validate balance
      if (balance < stake * 2) {
        toast.error(`Insufficient balance. Need at least ${formatMoney(stake * 2, currency, fxRate)}`);
        setIsExecuting(false);
        return;
      }

      const durationMs = durationNum * 1000;

      // Start auto-trade with AI's recommendation
      startAutoTrade({
        direction: decisionToExecute.direction,
        contract: decisionToExecute.contract,
        volatility: decisionToExecute.symbol,
        stake: stake,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        durationMs,
        durationUnit: 'seconds',
        durationVal: durationNum,
        barrier: decisionToExecute.barrier,
        aiDecision: decisionToExecute,
      });

      toast.success(`AI executed: ${decisionToExecute.symbol} ${CONTRACT_LABELS[decisionToExecute.contract]} ${decisionToExecute.direction.toUpperCase()}`, {
        description: `Stake: ${formatMoney(stake, currency, fxRate)} · Confidence: ${decisionToExecute.confidence.toFixed(0)}%`,
        duration: 5000,
      });

      setPendingDecision(null);
      setDecision(null);

    } catch (err) {
      console.error('[AI] Execution error:', err);
      toast.error('Failed to execute AI trade');
    } finally {
      if (isMountedRef.current) {
        setIsExecuting(false);
      }
    }
  }, [balance, startAutoTrade, currency, fxRate, isAutoRunning, isExecuting]);

  // ── Authorize pending decision ──────────────────────────────────

  const authorizeDecision = useCallback(() => {
    if (pendingDecision) {
      executeDecision(pendingDecision);
    }
  }, [pendingDecision, executeDecision]);

  // ── Reject pending decision ─────────────────────────────────────

  const rejectDecision = useCallback(() => {
    if (pendingDecision) {
      toast.info(`AI recommendation rejected: ${pendingDecision.symbol} ${pendingDecision.direction.toUpperCase()}`);
      setPendingDecision(null);
      setDecision(null);
    }
  }, [pendingDecision]);

  // ── Toggle AI auto-run ──────────────────────────────────────────

  const toggleAIRun = useCallback(() => {
    if (aiRunning) {
      setAiRunning(false);
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
      toast.info('AI bot stopped');
    } else {
      setAiRunning(true);
      runAnalysis();
      analysisIntervalRef.current = setInterval(runAnalysis, 30000);
      toast.info('AI bot started — analyzing markets...');
    }
  }, [aiRunning, runAnalysis]);

  // ── Record trade outcomes for AI learning ──────────────────────

  useEffect(() => {
    const settledTrades = trades.filter(t => t.status !== 'open');
    let recordedCount = 0;
    
    for (const trade of settledTrades) {
      const history = (engine as any).tradeHistory || [];
      const alreadyRecorded = history.some((h: any) => h.id === trade.id);
      if (!alreadyRecorded && trade.pnl !== undefined) {
        engine.recordTradeOutcome(
          trade.volatility,
          trade.contract,
          trade.direction,
          trade.barrier,
          trade.pnl > 0 ? 'win' : 'loss',
          trade.pnl
        );
        recordedCount++;
      }
    }
    
    if (recordedCount > 0) {
      setPerformance(engine.getPerformance());
      setDecisionHistory(engine.getDecisionHistory(10));
    }
  }, [trades, engine]);

  // ── Initial analysis on mount ──────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        runAnalysis();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-primary';
    if (confidence >= 50) return 'text-yellow-500';
    return 'text-muted-foreground';
  };

  const getDirectionIcon = (direction: Direction) => {
    const isPositive = ['rise', 'over', 'match', 'even'].includes(direction);
    return isPositive
      ? <TrendingUp className="h-4 w-4 text-primary" />
      : <TrendingDown className="h-4 w-4 text-destructive" />;
  };

  const getContractBadgeVariant = (contract: ContractType): 'default' | 'secondary' | 'outline' => {
    switch (contract) {
      case 'rise_fall': return 'default';
      case 'over_under': return 'secondary';
      case 'match_differ': return 'outline';
      case 'even_odd': return 'secondary';
      default: return 'default';
    }
  };

  const winRate = performance && performance.totalDecisions > 0
    ? (performance.wins / performance.totalDecisions) * 100
    : 0;

  // ── Get the effective stake to display ──
  const getEffectiveStake = (): number => {
    const override = getStakeOverrideNum();
    if (override !== null && override > 0) return override;
    if (pendingDecision) return pendingDecision.suggestedStake;
    if (decision) return decision.suggestedStake;
    return (STAKE_RANGES[riskTolerance][0] + STAKE_RANGES[riskTolerance][1]) / 2;
  };

  // ── Get the current stake value for the input ──
  const getStakeInputValue = (): string | number => {
    if (stakeOverride !== null && stakeOverride !== '') return stakeOverride;
    if (pendingDecision) return pendingDecision.suggestedStake;
    if (decision) return decision.suggestedStake;
    return (STAKE_RANGES[riskTolerance][0] + STAKE_RANGES[riskTolerance][1]) / 2;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <span className="font-semibold">AI Trading</span>
          {aiRunning && (
            <span className="relative flex h-2 w-2 ml-1">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          )}
          {isAutoRunning && (
            <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500">
              Trading
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={aiRunning ? "destructive" : "outline"}
            size="sm"
            onClick={toggleAIRun}
            className="text-xs"
            disabled={isAutoRunning}
          >
            {aiRunning ? (
              <>
                <Square className="h-3 w-3 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Start
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runAnalysis}
            disabled={isAnalyzing || aiRunning || isAutoRunning}
            className="text-xs"
          >
            {isAnalyzing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Risk Tolerance */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Risk Tolerance</Label>
          <span className="text-xs font-medium">{RISK_LABELS[riskTolerance]}</span>
        </div>
        <div className="flex gap-1">
          {(['conservative', 'moderate', 'aggressive'] as RiskTolerance[]).map((level) => (
            <button
              key={level}
              onClick={() => setRiskTolerance(level)}
              disabled={isAutoRunning}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                riskTolerance === level
                  ? level === 'conservative'
                    ? 'bg-primary/20 text-primary border border-primary'
                    : level === 'moderate'
                    ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500'
                    : 'bg-destructive/20 text-destructive border border-destructive'
                  : 'bg-elevated text-muted-foreground hover:text-foreground'
              }`}
            >
              {level === 'conservative' && <Shield className="h-3 w-3 inline mr-1" />}
              {level === 'moderate' && <BarChart3 className="h-3 w-3 inline mr-1" />}
              {level === 'aggressive' && <Zap className="h-3 w-3 inline mr-1" />}
              {RISK_LABELS[level]}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Default stake range: ${STAKE_RANGES[riskTolerance][0]}–${STAKE_RANGES[riskTolerance][1]} (adjustable below)
        </div>
      </div>

      {/* Contract lock */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Contract</Label>
          <span className="text-xs font-medium">
            {lockedContract === 'auto' ? 'AI picks best contract' : CONTRACT_LABELS[lockedContract]}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {LOCKED_CONTRACT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLockedContract(opt.value)}
              disabled={isAutoRunning}
              className={`rounded-md py-1.5 text-[10px] font-medium transition disabled:opacity-50 ${
                lockedContract === opt.value
                  ? 'bg-primary/20 text-primary border border-primary'
                  : 'bg-elevated text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trade Duration */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="duration-seconds" className="text-xs text-muted-foreground">
            Trade Duration
          </Label>
          <span className="text-xs font-medium">{getDurationNum() || 0}s</span>
        </div>
        <input
          id="duration-seconds"
          type="number"
          min={MIN_DURATION_SECONDS}
          max={MAX_DURATION_SECONDS}
          step={1}
          value={durationSeconds}
          disabled={isAutoRunning}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              setDurationSeconds(val);
              return;
            }
            const num = Number(val);
            if (Number.isFinite(num)) {
              setDurationSeconds(Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, num)));
            }
          }}
          className="w-full rounded-md bg-elevated border border-border px-2 py-1.5 text-xs disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>

      {/* Stake Override */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="stake-override" className="text-xs text-muted-foreground">
            Stake
          </Label>
          <span className="text-xs font-medium">
            {formatMoney(getEffectiveStake(), currency, fxRate)}
          </span>
        </div>
        <input
          id="stake-override"
          type="number"
          min={0.5}
          step={0.5}
          disabled={isAutoRunning}
          value={getStakeInputValue()}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              setStakeOverride(val);
              return;
            }
            const num = Number(val);
            if (Number.isFinite(num) && num > 0) {
              setStakeOverride(num);
            } else if (num === 0) {
              setStakeOverride(0);
            }
          }}
          className="w-full rounded-md bg-elevated border border-border px-2 py-1.5 text-xs disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>

      {/* ─── PENDING DECISION — WAITING FOR AUTHORIZATION ──────── */}
      {pendingDecision && !autoExecute && !isAutoRunning && (
        <Card className="p-4 border-l-4 border-yellow-500 bg-yellow-500/5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">AI Recommendation</span>
                <Badge variant="outline" className="text-yellow-500 border-yellow-500 text-xs">
                  Pending Authorization
                </Badge>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{pendingDecision.symbol}</span>
                <Badge variant={getContractBadgeVariant(pendingDecision.contract)} className="text-xs">
                  {CONTRACT_LABELS[pendingDecision.contract]}
                </Badge>
                <Badge variant={pendingDecision.direction === 'rise' || pendingDecision.direction === 'over' || pendingDecision.direction === 'match' || pendingDecision.direction === 'even' ? 'default' : 'destructive'} className="text-xs">
                  {getDirectionIcon(pendingDecision.direction)}
                  <span className="ml-1 uppercase">{pendingDecision.direction}</span>
                </Badge>
                {pendingDecision.barrier !== undefined && (
                  <Badge variant="outline" className="text-xs">
                    Barrier: {pendingDecision.barrier}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Confidence: {pendingDecision.confidence.toFixed(0)}%
                </Badge>
              </div>

              <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                <div>• EV: ${pendingDecision.expectedValue.toFixed(2)} per $1 staked</div>
                <div>• Win Rate: {pendingDecision.reasoning.winRate}</div>
                {pendingDecision.reasoning.historicalAccuracy && (
                  <div className="text-primary">• Historical Accuracy: {pendingDecision.reasoning.historicalAccuracy} ({pendingDecision.reasoning.sampleSize})</div>
                )}
                <div>• Volatility: {pendingDecision.reasoning.volatility}</div>
                <div>• Trend: {pendingDecision.reasoning.trend}</div>
                <div className="text-primary">• Stake: {formatMoney(getEffectiveStake(), currency, fxRate)}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={authorizeDecision}
              disabled={isExecuting || isAutoRunning}
            >
              {isExecuting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Authorize & Trade
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={rejectDecision}
              disabled={isExecuting}
            >
              <XCircle className="h-3 w-3 mr-1" />
              Reject
            </Button>
          </div>
        </Card>
      )}

      {/* ─── DECISION EXECUTED — SHOWING CONFIRMATION ───────────── */}
      {isAutoRunning && autoTrade.aiDecision && (
        <Card className="p-4 border-l-4 border-primary bg-primary/5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">AI Trade Active</span>
                <Badge variant="outline" className="text-primary border-primary text-xs">
                  Auto-Trading
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{autoTrade.aiDecision.symbol}</span>
                <Badge variant={getContractBadgeVariant(autoTrade.aiDecision.contract)} className="text-xs">
                  {CONTRACT_LABELS[autoTrade.aiDecision.contract]}
                </Badge>
                <Badge variant={autoTrade.direction === 'rise' || autoTrade.direction === 'over' || autoTrade.direction === 'match' || autoTrade.direction === 'even' ? 'default' : 'destructive'} className="text-xs">
                  {autoTrade.direction.toUpperCase()}
                </Badge>
                {autoTrade.aiDecision.barrier !== undefined && (
                  <Badge variant="outline" className="text-xs">
                    Barrier: {autoTrade.aiDecision.barrier}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Confidence: {autoTrade.aiDecision.confidence.toFixed(0)}%
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                P&L: {formatMoney(autoTrade.totalPnl, currency, fxRate)} · Trades: {autoTrade.tradesCount}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ─── NO DECISION ──────────────────────────────────────────── */}
      {!pendingDecision && !isAutoRunning && !decision && !aiRunning && (
        <Card className="p-4 text-center text-sm text-muted-foreground border-dashed">
          <div className="py-4">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p>No clear opportunity found</p>
            <p className="text-xs">AI is waiting for better market conditions</p>
          </div>
        </Card>
      )}

      {/* ─── AI RUNNING — ANALYZING ──────────────────────────────── */}
      {aiRunning && !pendingDecision && !isAutoRunning && (
        <Card className="p-4 text-center text-sm text-muted-foreground border-dashed">
          <div className="py-4">
            <Activity className="h-8 w-8 mx-auto mb-2 text-primary/50 animate-pulse" />
            <p>AI is monitoring the market...</p>
            <p className="text-xs">Checking for opportunities every 30 seconds</p>
          </div>
        </Card>
      )}

      {/* Performance Stats */}
      {performance && performance.totalDecisions > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          <Card className="p-2 text-center">
            <div className="text-xs text-muted-foreground">Trades</div>
            <div className="text-sm font-bold">{performance.totalDecisions}</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className={`text-sm font-bold ${winRate >= 50 ? 'text-primary' : 'text-destructive'}`}>
              {winRate.toFixed(0)}%
            </div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-xs text-muted-foreground">P&L</div>
            <div className={`text-sm font-bold ${performance.totalPnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {performance.totalPnl >= 0 ? '+' : ''}
              {formatMoney(performance.totalPnl, currency, fxRate)}
            </div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="text-sm">
              {isAutoRunning ? (
                <span className="text-yellow-500">Trading</span>
              ) : aiRunning ? (
                <span className="text-primary">Analyzing</span>
              ) : (
                <span className="text-muted-foreground">Idle</span>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Decision History */}
      {decisionHistory.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Recent AI Decisions</span>
            <span className="text-[10px] text-muted-foreground">{decisionHistory.length} total</span>
          </div>
          <div className="space-y-0.5 max-h-24 overflow-y-auto">
            {decisionHistory.slice(-5).reverse().map((d, i) => (
              <div key={`${d.timestamp}-${i}`} className="flex items-center justify-between text-xs bg-elevated/50 px-2 py-1 rounded">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.symbol}</span>
                  <span className="text-muted-foreground">{CONTRACT_LABELS[d.contract]}</span>
                  <span className={d.direction === 'rise' || d.direction === 'over' || d.direction === 'match' || d.direction === 'even' ? 'text-primary' : 'text-destructive'}>
                    {d.direction.toUpperCase()}
                  </span>
                  {d.barrier !== undefined && <span className="text-muted-foreground">|{d.barrier}</span>}
                  <span className="text-muted-foreground">{d.confidence.toFixed(0)}%</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(d.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-execute toggle */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={autoExecute}
            onCheckedChange={setAutoExecute}
            id="auto-execute"
            disabled={isAutoRunning}
          />
          <Label htmlFor="auto-execute" className="text-xs cursor-pointer">
            Auto-execute decisions
          </Label>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {autoExecute ? 'AI will trade automatically' : 'Review before trading'}
        </span>
      </div>

      {/* Auto-execute warning */}
      {autoExecute && !isAutoRunning && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2">
          <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <strong>Auto-execute is ON.</strong> The AI will automatically place trades when it finds a good opportunity.
          </div>
        </div>
      )}

      {/* Manual stop button if AI is running */}
      {isAutoRunning && (
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => stopAutoTrade()}
        >
          <Square className="h-3 w-3 mr-1" />
          Stop AI Trading
        </Button>
      )}
    </div>
  );
}