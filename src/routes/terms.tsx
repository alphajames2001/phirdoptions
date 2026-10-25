// src/routes/terms.tsx
import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/layout/Publiclayout";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Phird Options" },
      { name: "description", content: "Terms and conditions for using Phird Options trading platform." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>
        </div>

        <Card className="p-6 md:p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p className="text-sm text-muted-foreground">
              Welcome to Phird Options ("we," "our," "us"). These Terms of Service ("Terms") govern your access to and use of the Phird Options platform, website, mobile application, and related services (collectively, the "Platform"). By using the Platform, you agree to be bound by these Terms.
            </p>
            <p className="text-sm text-muted-foreground">
              Please read these Terms carefully before using the Platform. If you do not agree to these Terms, you may not access or use the Platform.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">2. Eligibility</h2>
            <p className="text-sm text-muted-foreground">
              To use the Platform, you must:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Be at least 18 years old</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
              <li>Not be a resident of a jurisdiction where trading synthetic indices or derivatives is prohibited</li>
              <li>Not be on any sanctions list or prohibited from using financial services</li>
              <li>Provide accurate and complete information during registration</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">3. Account Registration</h2>
            <p className="text-sm text-muted-foreground">
              To access certain features of the Platform, you must create an account. You agree to:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Notify us immediately of any unauthorized access</li>
              <li>Be solely responsible for all activities under your account</li>
              <li>Not share your account credentials with anyone</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">4. Trading Services</h2>
            <p className="text-sm text-muted-foreground">
              The Platform provides access to synthetic indices trading. By using our trading services, you acknowledge and agree that:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>All trading is conducted on a principal-to-principal basis</li>
              <li>We act as the counterparty to all trades</li>
              <li>Prices are determined by our proprietary pricing models</li>
              <li>Trading involves significant risk of loss</li>
              <li>Past performance does not guarantee future results</li>
              <li>We may adjust spreads and fees at any time</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">5. Deposits and Withdrawals</h2>
            <p className="text-sm text-muted-foreground">
              You may deposit funds into your account and withdraw funds subject to the following conditions:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Minimum deposit and withdrawal amounts apply</li>
              <li>Withdrawals may be subject to processing time</li>
              <li>Withdrawals require KYC verification</li>
              <li>We reserve the right to delay or refuse withdrawals</li>
              <li>Fees may apply to deposits and withdrawals</li>
              <li>Funds are held in segregated accounts</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">6. Fees and Charges</h2>
            <p className="text-sm text-muted-foreground">
              You agree to pay all fees and charges associated with your use of the Platform. These may include:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Trading commissions and spreads</li>
              <li>Deposit and withdrawal fees</li>
              <li>Inactivity fees</li>
              <li>Currency conversion fees</li>
              <li>Any other fees disclosed on the Platform</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Fees are subject to change with prior notice. You are responsible for reviewing the applicable fees.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">7. Risk Acknowledgment</h2>
            <p className="text-sm text-muted-foreground">
              Trading synthetic indices and derivatives involves substantial risk. You acknowledge and accept that:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>You may lose all or part of your investment</li>
              <li>Leverage amplifies both profits and losses</li>
              <li>Market conditions can change rapidly</li>
              <li>We do not provide investment advice</li>
              <li>You are solely responsible for your trading decisions</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">8. Prohibited Activities</h2>
            <p className="text-sm text-muted-foreground">
              You agree not to engage in any of the following activities:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Fraudulent or deceptive trading practices</li>
              <li>Market manipulation or price distortion</li>
              <li>Money laundering or terrorist financing</li>
              <li>Unauthorized access to the Platform</li>
              <li>Use of automated trading systems without authorization</li>
              <li>Abusive or harassing behavior</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">9. Intellectual Property</h2>
            <p className="text-sm text-muted-foreground">
              All content on the Platform, including text, graphics, logos, software, and trademarks, is our property or licensed to us. You may not:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Copy, modify, or distribute any content without permission</li>
              <li>Reverse engineer any software or system</li>
              <li>Use our trademarks without prior written consent</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">10. Termination</h2>
            <p className="text-sm text-muted-foreground">
              We reserve the right to suspend or terminate your account at our sole discretion, without prior notice, if:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>You violate these Terms</li>
              <li>You engage in fraudulent or illegal activities</li>
              <li>We are required to do so by law</li>
              <li>Your account becomes dormant for an extended period</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">11. Disclaimer of Warranties</h2>
            <p className="text-sm text-muted-foreground">
              The Platform is provided "as is" and "as available." We make no warranties, express or implied, regarding the Platform, including but not limited to:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Merchantability or fitness for a particular purpose</li>
              <li>Uninterrupted or error-free service</li>
              <li>Accuracy or reliability of any information</li>
              <li>Security or privacy of your data</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">12. Limitation of Liability</h2>
            <p className="text-sm text-muted-foreground">
              To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Loss of profits or revenue</li>
              <li>Loss of data or business interruption</li>
              <li>Losses resulting from trading activities</li>
              <li>Unauthorized access to your account</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">13. Governing Law</h2>
            <p className="text-sm text-muted-foreground">
              These Terms are governed by the laws of Kenya. Any disputes arising from these Terms shall be resolved in the courts of Kenya.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">14. Changes to Terms</h2>
            <p className="text-sm text-muted-foreground">
              We reserve the right to modify these Terms at any time. We will notify you of material changes through the Platform or via email. Your continued use of the Platform after changes become effective constitutes your acceptance of the revised Terms.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">15. Contact Us</h2>
            <p className="text-sm text-muted-foreground">
              If you have any questions about these Terms, please contact us at:
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Email:</strong> legal@gwave.co.ke<br />
              <strong>Address:</strong> Nairobi, Kenya
            </p>
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
