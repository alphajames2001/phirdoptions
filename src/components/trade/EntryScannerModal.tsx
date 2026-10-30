// src/components/trade/EntryScannerModal.tsx
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApp, VOLATILITIES, type ContractType } from "@/lib/store";
import {
  buildIndexHistories,
  evaluateIndex,
  type EntryScanResult,
} from "@/lib/entry-scanner";
import {
  Radar,
  Loader2,
  Info,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface EntryScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TOTAL_INDICES = VOLATILITIES.length;
const CONTRACT_OPTIONS: { id: ContractType; label: string }[] = [
  { id: "over_under", label: "Over / Under" },
  { id: "rise_fall", label: "Rise / Fall" },
  { id: "match_differ", label: "Match / Differ" },
  { id: "even_odd", label: "Even / Odd" },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function EntryScannerModal({ open, onOpenChange }: EntryScannerModalProps) {
  const applyAutoSetup = useApp((s) => s.applyAutoSetup);

  const [contract, setContract] = useState<ContractType>("over_under");
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<EntryScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: TOTAL_INDICES, currentName: "" });
  const scanIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      scanIdRef.current += 1;
      setIsScanning(false);
      setResult(null);
      setError(null);
      setProgress({ current: 0, total: TOTAL_INDICES, currentName: "" });
    }
  }, [open]);

  const resetResults = () => {
    setResult(null);
    setError(null);
    setProgress({ current: 0, total: TOTAL_INDICES, currentName: "" });
  };

  const handleContractChange = (next: ContractType) => {
    if (isScanning) return;
    setContract(next);
    resetResults();
  };

  const runScan = async () => {
    if (isScanning) return;

    const runId = ++scanIdRef.current;
    setIsScanning(true);
    setResult(null);
    setError(null);

    const state = useApp.getState();
    const histories = buildIndexHistories(state.price, state.volatility, state.tickHistory);
    setProgress({ current: 0, total: histories.length, currentName: histories[0]?.name ?? "" });

    try {
      let best: EntryScanResult | null = null;

      for (let i = 0; i < histories.length; i++) {
        if (runId !== scanIdRef.current) return;

        setProgress({ current: i, total: histories.length, currentName: histories[i].name });
        await delay(650);
        if (runId !== scanIdRef.current) return;

        const candidate = evaluateIndex(histories[i], contract);
        if (
          !best ||
          candidate.quality > best.quality ||
          (candidate.quality === best.quality && candidate.expectedValue > best.expectedValue)
        ) {
          best = candidate;
        }

        setProgress({ current: i + 1, total: histories.length, currentName: histories[i].name });
      }

      if (runId !== scanIdRef.current) return;

      if (!best) {
        setError("No entry point found. Try another category.");
        return;
      }

      setResult(best);
      setProgress({ current: histories.length, total: histories.length, currentName: best.marketName });
    } catch {
      if (runId === scanIdRef.current) {
        setError("Scan failed. Check your connection and try again.");
      }
    } finally {
      if (runId === scanIdRef.current) {
        setIsScanning(false);
      }
    }
  };

  const loadResult = () => {
    if (!result) return;

    applyAutoSetup({
      contract: result.contract,
      volatility: result.symbol,
      direction: result.direction,
      barrier: result.barrier,
      label: result.prediction,
    });

    toast.success(`Loaded ${result.marketName}`, {
      description: `${result.tradeType} · ${result.prediction}`,
    });

    onOpenChange(false);
  };

  const progressValue = progress.total
    ? Math.min(100, (progress.current / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b border-border p-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            Entry Scanner
          </DialogTitle>
          <DialogDescription className="sr-only">
            Scan every available volatility index for the best entry point.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-elevated p-2.5">
            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              The deep scanner walks every available volatility index and surfaces the best
              entry point for the selected category.
            </p>
          </div>

          <div>
            <label
              htmlFor="entry-scanner-category"
              className="text-xs font-medium text-muted-foreground"
            >
              Market category
            </label>
            <select
              id="entry-scanner-category"
              value={contract}
              onChange={(e) => handleContractChange(e.target.value as ContractType)}
              disabled={isScanning}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {CONTRACT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {result && (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <ResultRow label="Selected Market" value={result.marketName} />
              <ResultRow label="Trade Type" value={result.tradeType} />
              <ResultRow
                label="Prediction (auto)"
                value={result.prediction}
                highlight
              />
            </div>
          )}

          {(isScanning || result) && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground">
                  {result ? result.marketName : progress.currentName || "Preparing scan…"}
                </span>
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                  {result ? `${progress.total}/${progress.total}` : `${Math.min(progress.current + 1, progress.total)}/${progress.total}`}
                </span>
              </div>
              <Progress value={progressValue} />
            </div>
          )}

          <div
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
              error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : result
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-border bg-elevated text-muted-foreground"
            }`}
          >
            {error ? (
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            ) : isScanning ? (
              <Loader2 className="h-4 w-4 flex-shrink-0 mt-0.5 animate-spin" />
            ) : result ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
            ) : (
              <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" />
            )}
            <span>
              {error
                ? error
                : isScanning
                  ? `Scanning ${progress.currentName || "indices"} (${Math.min(progress.current + 1, progress.total)}/${progress.total})…`
                  : result
                    ? `Best market: ${result.marketName} | ${result.tradeType} ${result.prediction} | Quality ${result.quality.toFixed(2)}%`
                    : "Ready to scan the available volatility indices."}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={runScan} disabled={isScanning} className="w-full">
              {isScanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deep Scanning Best Market…
                </>
              ) : result ? (
                <>
                  <Radar className="mr-2 h-4 w-4" />
                  Re-scan for Best Market
                </>
              ) : (
                <>
                  <Radar className="mr-2 h-4 w-4" />
                  Deep Scan Best Market
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={loadResult}
              disabled={!result || isScanning}
              className="w-full"
            >
              {result ? `Load ${result.marketName}` : "Load Inputs"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-primary" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}
