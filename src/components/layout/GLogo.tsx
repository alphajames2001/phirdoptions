import logoDark from "/logo_dark_no_bg.png";
import logoLight from "/logo_light_no_bg.png";
import { useApp } from "@/lib/store";

export default function GLogo({ className = "" }: { className?: string }) {
  const theme = useApp((s) => s.theme);
  const isDark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const src = isDark ? logoDark : logoLight;
  return <img src={src} alt="Phird Options" className={className} />;
}