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
      // Sonner paints toasts from these variables, and its own selectors are
      // more specific than Tailwind utilities, so bg-*/text-* classes alone
      // can lose and leave a light toast with white text. Setting the
      // variables is the reliable route.
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--surface)",
          "--success-text": "var(--foreground)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--surface)",
          "--error-text": "var(--foreground)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--surface)",
          "--warning-text": "var(--foreground)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--surface)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "bg-surface! text-foreground! border-border! shadow-none!",
          description: "text-muted-foreground!",
          actionButton: "bg-foreground! text-background!",
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
