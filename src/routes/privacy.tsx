// src/routes/privacy.tsx
import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/layout/Publiclayout";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Phird Options" },
      { name: "description", content: "Privacy policy for Phird Options trading platform." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>
        </div>

        <Card className="p-6 md:p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p className="text-sm text-muted-foreground">
              At Phird Options ("we," "our," "us"), we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your personal information when you use our trading platform, website, mobile application, and related services (collectively, the "Platform").
            </p>
            <p className="text-sm text-muted-foreground">
              By using the Platform, you consent to the collection and use of your personal information as described in this Privacy Policy.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">2. Information We Collect</h2>
            <p className="text-sm text-muted-foreground">
              We collect the following types of information:
            </p>
            <h3 className="text-md font-medium mt-3">Personal Information</h3>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Full name and date of birth</li>
              <li>Email address and phone number</li>
              <li>Residential address and proof of address</li>
              <li>Government-issued ID documents</li>
              <li>Financial information and source of funds</li>
              <li>Tax identification number</li>
            </ul>
            <h3 className="text-md font-medium mt-3">Trading Information</h3>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Trading history and account balances</li>
              <li>Transaction and deposit records</li>
              <li>Trading preferences and settings</li>
              <li>Device and browser information</li>
              <li>IP address and location data</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
            <p className="text-sm text-muted-foreground">We use your personal information for the following purposes:</p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>To create and manage your trading account</li>
              <li>To verify your identity and comply with AML regulations</li>
              <li>To process deposits and withdrawals</li>
              <li>To execute your trades and manage your positions</li>
              <li>To communicate with you about your account</li>
              <li>To improve our services and user experience</li>
              <li>To detect and prevent fraud and abuse</li>
              <li>To comply with legal and regulatory obligations</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">4. Legal Basis for Processing</h2>
            <p className="text-sm text-muted-foreground">
              We process your personal information on the following legal bases:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Performance of a contract: to provide trading services</li>
              <li>Legal obligation: to comply with AML and KYC laws</li>
              <li>Legitimate interest: to improve our services and prevent fraud</li>
              <li>Consent: for marketing communications and optional features</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">5. Information Sharing</h2>
            <p className="text-sm text-muted-foreground">
              We do not sell or rent your personal information to third parties. We may share your information with:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Payment processors and financial institutions</li>
              <li>Regulatory authorities and law enforcement</li>
              <li>Service providers and partners</li>
              <li>Auditors and legal advisors</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              All third parties are bound by confidentiality and data protection obligations.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">6. Data Security</h2>
            <p className="text-sm text-muted-foreground">
              We implement appropriate technical and organizational measures to protect your personal information, including:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>256-bit AES encryption for sensitive data</li>
              <li>Secure servers and firewalls</li>
              <li>Access controls and authentication</li>
              <li>Regular security audits and testing</li>
              <li>Staff training on data protection</li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">7. Data Retention</h2>
            <p className="text-sm text-muted-foreground">
              We retain your personal information for as long as necessary to:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Provide our services and maintain your account</li>
              <li>Comply with legal and regulatory requirements</li>
              <li>Detect and prevent fraud</li>
              <li>Resolve disputes and enforce agreements</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Retention periods may extend up to 5 years after account closure or as required by law.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">8. Your Rights</h2>
            <p className="text-sm text-muted-foreground">
              You have the following rights regarding your personal information:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li><strong>Access:</strong> Request a copy of your data</li>
              <li><strong>Rectification:</strong> Correct inaccurate data</li>
              <li><strong>Erasure:</strong> Request deletion of your data (subject to legal obligations)</li>
              <li><strong>Restriction:</strong> Limit how we use your data</li>
              <li><strong>Portability:</strong> Receive your data in a portable format</li>
              <li><strong>Objection:</strong> Object to certain processing activities</li>
              <li><strong>Withdraw Consent:</strong> Withdraw consent at any time</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              To exercise these rights, please contact us at <strong>privacy@gwave.co.ke</strong>.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">9. Cookies</h2>
            <p className="text-sm text-muted-foreground">
              We use cookies and similar tracking technologies to enhance your experience on our Platform. For more information, please see our <a href="/cookies" className="text-primary hover:underline">Cookie Policy</a>.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">10. International Data Transfers</h2>
            <p className="text-sm text-muted-foreground">
              Your personal information may be transferred to and processed in countries outside of your jurisdiction. We ensure that appropriate safeguards are in place to protect your data.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">11. Children's Privacy</h2>
            <p className="text-sm text-muted-foreground">
              Our services are not directed to individuals under 18 years of age. We do not knowingly collect personal information from minors. If we become aware that we have collected personal information from a minor, we will delete it.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">12. Changes to This Policy</h2>
            <p className="text-sm text-muted-foreground">
              We may update this Privacy Policy from time to time. We will notify you of material changes through the Platform or via email. Your continued use of the Platform after changes become effective constitutes your acceptance of the revised Privacy Policy.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">13. Contact Us</h2>
            <p className="text-sm text-muted-foreground">
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Email:</strong> privacy@gwave.co.ke<br />
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
