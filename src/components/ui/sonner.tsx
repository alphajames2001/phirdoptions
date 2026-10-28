import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// The app's theme is class-based (.dark on <html>), not OS-based, so Sonner's
// own "system" detection would pick the wrong palette. Follow the class instead.
function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const isDark = useIsDark();

  return (
    <Sonner
      className="toaster group"
      theme={isDark ? "dark" : "light"}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--card)",
          "--success-text": "var(--foreground)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--card)",
          "--error-text": "var(--foreground)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--card)",
          "--warning-text": "var(--foreground)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--card)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "bg-card! text-foreground! border-border! shadow-lg!",
          description: "text-muted-foreground!",
          actionButton: "bg-primary! text-primary-foreground! hover:bg-primary/90!",
          cancelButton: "bg-transparent! text-foreground! border! border-input!",
          success: "text-foreground!",
          error: "text-foreground!",
          warning: "text-foreground!",
          info: "text-foreground!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
