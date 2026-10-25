// DepositModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { depositMpesa } from "@/lib/api";

export function DepositModal({
  open,
  onOpenChange,
  onDeposited,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeposited?: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("10");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const deposit = useApp((s) => s.deposit);
  const account = useApp((s) => s.account);
  const fetchBalances = useApp((s) => s.fetchBalances);
  const fxRate = useApp((s) => s.fxRate);

  const notAvailable = (method: "Bank" | "PayPal") => {
    toast.error(`${method} deposits are not available yet. Please use M-Pesa.`);
  };

  const submitMpesa = async () => {
    let cleanPhone = phone.replace(/\s/g, '')
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '254' + cleanPhone.substring(1)
    } else if (cleanPhone.startsWith('7')) {
      cleanPhone = '254' + cleanPhone
    } else if (cleanPhone.startsWith('+254')) {
      cleanPhone = cleanPhone.substring(1)
    }

    if (!/^254[17]\d{8}$/.test(cleanPhone)) {
      toast.error("Enter a valid Kenyan phone number (e.g., 0712345678 or 0112345678)");
      return;
    }

    const usdAmount = Number(amount);
    if (!Number.isFinite(usdAmount) || usdAmount < 1) {
      toast.error("Minimum deposit is $1");
      return;
    }

    const kesAmount = Math.round(usdAmount * fxRate);
      if (kesAmount < 520) {  // Changed from 260
        toast.error(`Minimum deposit is KES ${Math.round(520)} (~$4)`);  // Updated message
        return;
      }

    setSubmitting(true);
    
    try {
      const response = await depositMpesa(cleanPhone, kesAmount);
      
      if (response.success) {
        toast.success("STK Push sent! Check your phone to authorize the payment.", {
          duration: 8000,
        });
        
        // ✅ Trigger an immediate refresh so the pending transaction shows up right away
        onDeposited?.();
        await fetchBalances(); // Refresh balances to show pending state
        
        // ✅ Close modal after successful STK push
        setTimeout(() => {
          onOpenChange(false);
          setPhone("");
          setAmount("10");
        }, 3000);
      }
    } catch (err: any) {
      console.error('[Deposit] Error:', err);
      
      // ✅ Better error handling for common M-Pesa errors
      if (err.message?.includes('STK Push failed')) {
        toast.error("Failed to send STK push. Please try again.");
      } else if (err.message?.includes('Invalid phone number')) {
        toast.error("Invalid phone number. Please check and try again.");
      } else {
        toast.error(err.message || "Failed to initiate deposit. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit funds</DialogTitle>
          <DialogDescription>Top up your {account} account using M-Pesa.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="mpesa">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="mpesa">M-Pesa</TabsTrigger>
            <TabsTrigger value="bank">Bank</TabsTrigger>
            <TabsTrigger value="paypal">PayPal</TabsTrigger>
          </TabsList>
          <TabsContent value="mpesa" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input 
                id="phone" 
                placeholder="0712345678" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)} 
              />
              <p className="text-xs text-muted-foreground">Enter your M-Pesa registered phone number</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount (USD)</Label>
              <Input 
                id="amt" 
                type="number" 
                min={1} 
                step={1}
                value={amount} 
                onChange={(e) => setAmount(e.target.value)} 
              />
              <p className="text-xs text-muted-foreground">
                ≈ KES {Math.round(Number(amount) * fxRate).toLocaleString()}
              </p>
            </div>
            <Button 
              onClick={submitMpesa} 
              disabled={submitting} 
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? "Awaiting confirmation…" : `Send STK Push (KES ${Math.round(Number(amount) * fxRate).toLocaleString()})`}
            </Button>
          </TabsContent>
          <TabsContent value="bank" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="bank-account-name">Account holder name</Label>
              <Input
                id="bank-account-name"
                placeholder="John Doe"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Bank name</Label>
              <Input
                id="bank-name"
                placeholder="Equity Bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-account-number">Account number</Label>
              <Input
                id="bank-account-number"
                placeholder="0123456789"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-amt">Amount (USD)</Label>
              <Input
                id="bank-amt"
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                ≈ KES {Math.round(Number(amount) * fxRate).toLocaleString()}
              </p>
            </div>
            <Button
              onClick={() => notAvailable("Bank")}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Continue with bank transfer
            </Button>
          </TabsContent>
          <TabsContent value="paypal" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="paypal-email">PayPal email</Label>
              <Input
                id="paypal-email"
                type="email"
                placeholder="you@example.com"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paypal-amt">Amount (USD)</Label>
              <Input
                id="paypal-amt"
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                ≈ KES {Math.round(Number(amount) * fxRate).toLocaleString()}
              </p>
            </div>
            <Button
              onClick={() => notAvailable("PayPal")}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Continue with PayPal
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}