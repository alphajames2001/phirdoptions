import { useApp, VOLATILITIES, type VolatilityId } from "@/lib/store";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ChevronDown, ArrowUp, ArrowDown } from "lucide-react";

export function VolatilityIndicator() {
  const volatility = useApp((s) => s.volatility);
  const setVolatility = useApp((s) => s.setVolatility);
  const price = useApp((s) => s.price);
  const prev = useApp((s) => s.prevPrice);
  const meta = VOLATILITIES.find((v) => v.id === volatility)!;
  const change = price - prev;
  const pct = prev !== 0 ? (change / prev) * 100 : 0;
  const up = change >= 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center justify-between gap-2 rounded-md bg-card px-3 py-2 text-left hover:bg-accent">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{meta.name}</div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-mono">{price.toFixed(3)}</span>
              <span className={up ? "text-primary" : "text-destructive"}>
                {up ? "+" : ""}
                {change.toFixed(3)} ({pct.toFixed(3)}%)
              </span>
              {up ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-destructive" />}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {VOLATILITIES.map((v) => (
          <DropdownMenuItem key={v.id} onClick={() => setVolatility(v.id as VolatilityId)}>
            {v.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}