import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { updateProfile, getKYCStatus, uploadKYCDocuments } from "@/lib/api";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Phird Options — Account" }] }),
  component: AccountPage,
});

function AccountPage() {
  const user = useApp((s) => s.user);
  const fetchUserData = useApp((s) => s.fetchUserData);
  const [name, setName] = useState(user?.name || user?.displayName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [kycStatus, setKycStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>('none');
  const [twofa, setTwofa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadKYCStatus();
  }, []);

  useEffect(() => {
    if (user?.name || user?.displayName) {
      setName(user.name || user.displayName || "");
    }
  }, [user?.name, user?.displayName]);

  const loadKYCStatus = async () => {
    try {
      const response = await getKYCStatus();
      if (response.success) {
        setKycStatus(response.data.status);
      }
    } catch (err) {
      console.error('Failed to load KYC status:', err);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      await updateProfile(name);
      await fetchUserData();
      toast.success("Profile updated successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleKYCUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length < 3) {
      toast.error("Please select all 3 documents: ID front, ID back, and selfie");
      return;
    }

    setUploading(true);
    try {
      const idFront = files[0];
      const idBack = files[1];
      const selfie = files[2];
      
      await uploadKYCDocuments(idFront, idBack, selfie);
      toast.success("KYC documents uploaded successfully! Review takes 1-2 business days.");
      await loadKYCStatus();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload KYC documents");
    } finally {
      setUploading(false);
    }
  };

  const getKYCStatusBadge = () => {
    switch (kycStatus) {
      case 'approved': return <span className="text-primary font-semibold">✅ Approved</span>;
      case 'pending': return <span className="text-yellow-500 font-semibold">⏳ Pending Review</span>;
      case 'rejected': return <span className="text-destructive font-semibold">❌ Rejected</span>;
      default: return <span className="text-muted-foreground">Not Submitted</span>;
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <h1 className="text-2xl font-bold">Account</h1>
        
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Profile</h2>
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Your full name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input 
              type="email" 
              value={email} 
              disabled 
              className="opacity-70"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>
          <Button 
            onClick={handleUpdateProfile} 
            disabled={loading}
          >
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">KYC Verification</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Status</div>
              <div className="text-sm">{getKYCStatusBadge()}</div>
            </div>
          </div>
          
          {kycStatus !== 'approved' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Upload ID Front, ID Back, and Selfie for verification
              </div>
              <div className="flex flex-wrap gap-2">
                <Label className="cursor-pointer">
                  <span className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    {uploading ? "Uploading..." : "Upload Documents"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={handleKYCUpload}
                    disabled={uploading}
                  />
                </Label>
                <p className="text-xs text-muted-foreground self-center">
                  {kycStatus === 'pending' ? 'Documents pending review' : 'Select 3 files: ID front, ID back, Selfie'}
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Security</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Two-factor authentication</div>
              <div className="text-xs text-muted-foreground">Require an authenticator code on sign in.</div>
            </div>
            <Switch 
              checked={twofa} 
              onCheckedChange={(v) => { 
                setTwofa(v); 
                toast.success(v ? "2FA enabled" : "2FA disabled");
              }} 
            />
          </div>
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" placeholder="••••••••" />
          </div>
          <Button 
            variant="outline" 
            onClick={() => toast.success("Password changed")}
          >
            Change password
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}
