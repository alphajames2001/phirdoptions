// src/routes/risk.tsx
import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/layout/Publiclayout";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/risk")({
  head: () => ({
    meta: [
      { title: "Risk Disclosure — Phird Options" },
      { name: "description", content: "Important risk disclosure for trading synthetic indices on Phird Options." },
    ],
  }),
  component: RiskPage,
});

function RiskPage() {
  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Risk Disclosure</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>
        </div>

        <Card className="p-6 md:p-8 space-y-6">
          <div className="flex items-start gap-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
            <AlertTriangle className="h-6 w-6 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-500">Important: High Risk Warning</h3>
              <p className="text-sm text-muted-foreground">
                Trading synthetic indices and derivatives carries a high level of risk and may not be suitable for all investors. You should carefully consider your investment objectives, level of experience, and risk appetite before trading.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">1. Overview</h2>
            <p className="text-sm text-muted-foreground">
              This Risk Disclosure Statement provides you with important information about the risks associated with trading synthetic indices on the Phird Options platform. It is your responsibility to understand these risks before you start trading.
            </p>
            <p className="text-sm text-muted-foreground">
              Trading synthetic indices involves significant financial risk. You may lose some or all of your invested capital. Past performance is not indicative of future results.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">2. Types of Risks</h2>
            
            <h3 className="text-md font-medium mt-4">2.1 Market Risk</h3>
            <p className="text-sm text-muted-foreground">
              Synthetic indices prices are influenced by a variety of factors, including market sentiment, economic conditions, and volatility. Prices can move rapidly and unpredictably, resulting in significant losses.
            </p>

            <h3 className="text-md font-medium mt-4">2.2 Leverage Risk</h3>
            <p className="text-sm text-muted-foreground">
              Our platform offers leveraged trading, which amplifies both potential profits and potential losses. Even small market movements can result in substantial losses that may exceed your initial investment.
            </p>

            <h3 className="text-md font-medium mt-4">2.3 Liquidity Risk</h3>
            <p className="text-sm text-muted-foreground">
              In certain market conditions, it may be difficult to enter or exit positions at desired prices. This can result in slippage and unexpected losses.
            </p>

            <h3 className="text-md font-medium mt-4">2.4 Technology Risk</h3>
            <p className="text-sm text-muted-foreground">
              Our platform relies on internet connectivity and technology infrastructure. Disruptions, delays, or technical failures may affect your ability to trade and could result in financial losses.
            </p>

            <h3 className="text-md font-medium mt-4">2.5 Counterparty Risk</h3>
            <p className="text-sm text-muted-foreground">
              We act as the counterparty to all trades. While we maintain robust financial controls, there is a risk of default or financial failure.
            </p>

            <h3 className="text-md font-medium mt-4">2.6 Regulatory Risk</h3>
            <p className="text-sm text-muted-foreground">
              Changes in laws and regulations may impact the trading environment, including the availability of certain products or the imposition of new restrictions.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">3. Important Considerations</h2>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 pl-4">
              <li>
                <strong>Only invest what you can afford to lose.</strong> Never use funds that are essential for your daily living expenses or financial obligations.
              </li>
              <li>
                <strong>Understand the products you are trading.</strong> Before trading any synthetic index, ensure you fully understand how it works and the factors that affect its price.
              </li>
              <li>
                <strong>Monitor your positions regularly.</strong> Market conditions can change rapidly. We recommend that you actively monitor your open positions and use available risk management tools.
              </li>
              <li>
                <strong>No guarantee of profit.</strong> There is no guarantee that you will make a profit from trading. All trading involves risk, and losses are possible.
              </li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">4. Risk Management Tools</h2>
            <p className="text-sm text-muted-foreground">
              We provide several tools to help you manage your risk:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Stop-loss orders</li>
              <li>Take-profit orders</li>
              <li>Position size limits</li>
              <li>Real-time position monitoring</li>
              <li>Account balance alerts</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              These tools are not guaranteed to prevent losses, and it is your responsibility to use them appropriately.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">5. Suitability Assessment</h2>
            <p className="text-sm text-muted-foreground">
              Before trading, consider whether trading synthetic indices is suitable for you based on:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Your financial situation and resources</li>
              <li>Your investment objectives and goals</li>
              <li>Your level of trading experience and knowledge</li>
              <li>Your risk tolerance and capacity for loss</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              We recommend that you consult with a qualified financial advisor before trading.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">6. No Investment Advice</h2>
            <p className="text-sm text-muted-foreground">
              We do not provide investment advice, recommendations, or trading signals. All information provided on the Platform is for informational purposes only and should not be construed as financial advice. You are solely responsible for your trading decisions.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">7. Acknowledgement</h2>
            <p className="text-sm text-muted-foreground">
              By using the Phird Options platform, you acknowledge that:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>You have read and understood this Risk Disclosure Statement</li>
              <li>You are aware of the risks associated with trading synthetic indices</li>
              <li>You accept full responsibility for all trading decisions and outcomes</li>
              <li>You have sufficient financial resources to bear any losses</li>
              <li>You understand that trading is not suitable for everyone</li>
            </ul>
          </div>

          <Separator />

          <div className="flex items-start gap-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <ShieldAlert className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive">Warning</h3>
              <p className="text-sm text-muted-foreground">
                Trading synthetic indices is not a way to get rich quickly. The majority of retail traders lose money. Only trade with funds that you can afford to lose entirely.
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <a href="/terms" className="hover:text-foreground">Terms of Service</a>
          <span className="text-border">|</span>
          <a href="/privacy" className="hover:text-foreground">Privacy Policy</a>
          <span className="text-border">|</span>
          <a href="/risk" className="hover:text-foreground">Risk Disclosure</a>
          <span className="text-border">|</span>
          <a href="/cookies" className="hover:text-foreground">Cookie Policy</a>
        </div>
      </div>
    </PublicLayout>
  );
}
