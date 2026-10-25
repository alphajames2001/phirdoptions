import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-none",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-foreground group-[.toast]:text-background",
          cancelButton: "group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border",
          success: "!text-foreground",
          error: "!text-foreground",
          warning: "!text-foreground",
          info: "!text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
