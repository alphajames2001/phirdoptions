// src/components/trade/AutoTradeResultModal.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, type Currency } from "@/lib/store";
import { Trophy, AlertTriangle, XCircle, TrendingUp, TrendingDown, Clock, Percent, BarChart3 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface AutoTradeResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: {
    reason: 'take_profit' | 'stop_loss' | 'max_trades' | 'manual_stop' | 'insufficient_balance' | 'error';
    totalPnl: number;
    tradesCount: number;
    wins: number;
    losses: number;
    startedAt: number | null;
    stoppedAt: number;
    currency: Currency;
    fxRate: number;
    direction?: string;
    contract?: string;
    stopLoss?: number;
    takeProfit?: number;
  };
}

export function AutoTradeResultModal({ open, onOpenChange, result }: AutoTradeResultModalProps) {
  const navigate = useNavigate();

  const duration = result.startedAt 
    ? Math.round((result.stoppedAt - result.startedAt) / 1000 / 60) 
    : 0;

  const winRate = result.tradesCount > 0 
    ? (result.wins / result.tradesCount) * 100 
    : 0;

  const averagePnl = result.tradesCount > 0 
    ? result.totalPnl / result.tradesCount 
    : 0;

  const getReasonDetails = () => {
    switch (result.reason) {
      case 'take_profit':
        return {
          icon: Trophy,
          title: '🎯 Take Profit Reached!',
          description: 'Your auto trading session completed successfully.',
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          borderColor: 'border-primary/30',
        };
      case 'stop_loss':
        return {
          icon: AlertTriangle,
          title: '⛔ Stop Loss Hit',
          description: 'Your auto trading session was stopped due to reaching the stop loss limit.',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
        };
      case 'max_trades':
        return {
          icon: BarChart3,
          title: '📊 Max Trades Reached',
          description: 'Your auto trading session completed the maximum number of trades.',
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          borderColor: 'border-primary/30',
        };
      case 'manual_stop':
        return {
          icon: XCircle,
          title: '🛑 Manual Stop',
          description: 'You manually stopped the auto trading session.',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          borderColor: 'border-muted/30',
        };
      case 'insufficient_balance':
        return {
          icon: AlertTriangle,
          title: '⚠️ Insufficient Balance',
          description: 'Auto trading stopped due to insufficient balance.',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
        };
      default:
        return {
          icon: XCircle,
          title: '⛔ Auto Trading Stopped',
          description: 'Your auto trading session has ended.',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          borderColor: 'border-muted/30',
        };
    }
  };

  const details = getReasonDetails();
  const IconComponent = details.icon;
  const isProfit = result.totalPnl >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Auto Trading Result</DialogTitle>
          <DialogDescription className="sr-only">
            Your auto trading session has ended. Here are the results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Header */}
          <div className={`flex items-center gap-3 rounded-lg border p-4 ${details.bgColor} ${details.borderColor}`}>
            <IconComponent className={`h-6 w-6 ${details.color}`} />
            <div>
              <h3 className={`font-semibold ${details.color}`}>{details.title}</h3>
              <p className="text-sm text-muted-foreground">{details.description}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Total P&L</div>
              <div className={`text-lg font-bold ${isProfit ? 'text-primary' : 'text-destructive'}`}>
                {result.totalPnl >= 0 ? '+' : ''}
                {formatMoney(result.totalPnl, result.currency, result.fxRate)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Total Trades</div>
              <div className="text-lg font-bold">{result.tradesCount}</div>
            </Card>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3 text-center">
              <div className="text-xs text-muted-foreground">Wins</div>
              <div className="text-lg font-bold text-primary">{result.wins}</div>
            </Card>
            <Card className="p-3 text-center">
              <div className="text-xs text-muted-foreground">Losses</div>
              <div className="text-lg font-bold text-destructive">{result.losses}</div>
            </Card>
            <Card className="p-3 text-center">
              <div className="text-xs text-muted-foreground">Win Rate</div>
              <div className="text-lg font-bold">{winRate.toFixed(1)}%</div>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Duration
              </div>
              <div className="text-sm font-semibold">{duration} minute{duration !== 1 ? 's' : ''}</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                Avg P&L per trade
              </div>
              <div className={`text-sm font-semibold ${averagePnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {averagePnl >= 0 ? '+' : ''}
                {formatMoney(averagePnl, result.currency, result.fxRate)}
              </div>
            </Card>
          </div>

          {/* Session details */}
          <div className="rounded-lg border border-border bg-elevated p-3">
            <div className="grid grid-cols-2 gap-1 text-xs">
              <span className="text-muted-foreground">Direction</span>
              <span className="text-right font-medium capitalize">{result.direction || '—'}</span>
              <span className="text-muted-foreground">Contract</span>
              <span className="text-right font-medium capitalize">{result.contract?.replace('_', ' ') || '—'}</span>
              {result.stopLoss !== undefined && (
                <>
                  <span className="text-muted-foreground">Stop Loss</span>
                  <span className="text-right font-medium text-destructive">
                    {formatMoney(result.stopLoss, result.currency, result.fxRate)}
                  </span>
                </>
              )}
              {result.takeProfit !== undefined && (
                <>
                  <span className="text-muted-foreground">Take Profit</span>
                  <span className="text-right font-medium text-primary">
                    {formatMoney(result.takeProfit, result.currency, result.fxRate)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => {
                onOpenChange(false);
                navigate({ to: '/trade' });
              }}
            >
              Back to Trade
            </Button>
            <Button 
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                onOpenChange(false);
                navigate({ to: '/wallet' });
              }}
            >
              View Wallet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}