import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Follows the site's light/dark switch (the `dark` class on <html>) so toasts never stay light in dark mode. */
function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ className, toastOptions, ...props }: ToasterProps) => {
  const theme = useDocumentTheme();
  return (
    <Sonner
      theme={theme}
      className={cn("toaster group", className)}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: "group toast app-toast",
          title: "app-toast-title",
          description: "app-toast-description",
          actionButton: "app-toast-action",
          cancelButton: "app-toast-cancel",
          closeButton: "app-toast-close",
          success: "app-toast-success",
          error: "app-toast-error",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
