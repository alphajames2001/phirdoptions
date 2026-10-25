// src/routes/cookies.tsx
import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/layout/Publiclayout";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Cookie, Shield, Settings, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy — Phird Options" },
      { name: "description", content: "Cookie policy for Phird Options trading platform." },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cookie Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>
        </div>

        <Card className="p-6 md:p-8 space-y-6">
          <div className="flex items-start gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <Cookie className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold">About This Policy</h3>
              <p className="text-sm text-muted-foreground">
                This Cookie Policy explains how Phird Options uses cookies and similar tracking technologies on our website, mobile application, and related services (collectively, the "Platform").
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">1. What Are Cookies</h2>
            <p className="text-sm text-muted-foreground">
              Cookies are small text files that are stored on your device (computer, tablet, or mobile phone) when you visit a website. They are widely used to make websites work more efficiently, enhance user experience, and provide information to the website owners.
            </p>
            <p className="text-sm text-muted-foreground">
              Cookies do not typically contain any personal information that can identify you, but they may be linked to personal information that we hold about you.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">2. Types of Cookies We Use</h2>
            
            <div className="grid gap-4 mt-4">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <h3 className="font-medium">Essential Cookies</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  These cookies are necessary for the Platform to function properly. They enable core features such as security, authentication, and account management. You cannot opt out of these cookies.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Authentication</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Security</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Session management</span>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <Settings className="h-5 w-5 text-primary" />
                  <h3 className="font-medium">Functional Cookies</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  These cookies enable enhanced functionality and personalization, such as remembering your preferences and settings.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Language preferences</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Theme settings</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Favorites</span>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <h3 className="font-medium">Analytics Cookies</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  These cookies help us understand how users interact with our Platform, allowing us to improve performance and user experience. We use this data for internal analysis only.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Page views</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">User behavior</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">Performance metrics</span>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">3. Third-Party Cookies</h2>
            <p className="text-sm text-muted-foreground">
              We may allow third-party service providers to set cookies on our Platform. These providers help us with:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>Analytics and performance monitoring</li>
              <li>Fraud detection and security</li>
              <li>Payment processing</li>
              <li>Customer support</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              We do not control third-party cookies, and you should review the privacy policies of these third parties for more information.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">4. How Long Do Cookies Last</h2>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>
                <strong>Session cookies:</strong> These are temporary cookies that expire when you close your browser or end your session.
              </li>
              <li>
                <strong>Persistent cookies:</strong> These remain on your device for a set period or until you delete them. We use persistent cookies for preferences and authentication.
              </li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">5. Managing Cookie Preferences</h2>
            <p className="text-sm text-muted-foreground">
              You can control and manage cookies in several ways:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>
                <strong>Browser settings:</strong> Most browsers allow you to block, delete, or manage cookies. Refer to your browser's help section for instructions.
              </li>
              <li>
                <strong>Platform settings:</strong> You can adjust your cookie preferences in your account settings.
              </li>
              <li>
                <strong>Opt-out tools:</strong> Some third-party analytics providers offer opt-out tools.
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Please note that disabling certain cookies may affect the functionality of the Platform and your user experience.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">6. How to Manage Cookies in Common Browsers</h2>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-4">
              <li>
                <strong>Google Chrome:</strong> Settings → Privacy and Security → Cookies and other site data
              </li>
              <li>
                <strong>Mozilla Firefox:</strong> Options → Privacy & Security → Cookies and Site Data
              </li>
              <li>
                <strong>Safari:</strong> Preferences → Privacy → Manage Website Data
              </li>
              <li>
                <strong>Microsoft Edge:</strong> Settings → Cookies and site permissions → Manage and delete cookies and site data
              </li>
            </ul>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">7. Updates to This Policy</h2>
            <p className="text-sm text-muted-foreground">
              We may update this Cookie Policy from time to time. We will notify you of any material changes through the Platform or via email. Your continued use of the Platform after changes become effective constitutes your acceptance of the revised Cookie Policy.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">8. Contact Us</h2>
            <p className="text-sm text-muted-foreground">
              If you have any questions about this Cookie Policy, please contact us at:
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
