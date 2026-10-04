import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          // Dark background for ALL toasts regardless of status — the status
          // (success / error / info / warning) is communicated purely by
          // sonner's built-in icon (green check, red ✕, etc.), NOT by the
          // background colour.  `richColors` is intentionally NOT set on the
          // <Toaster> (see App.js) so the per-type coloured backgrounds are
          // off.  Slightly slimmer than default (py-2 vs the ~16px default).
          toast:
            "group toast group-[.toaster]:bg-[#1c1c1e] group-[.toaster]:text-white group-[.toaster]:border-white/10 group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:py-2 group-[.toaster]:px-3.5 group-[.toaster]:min-h-0",
          description: "group-[.toast]:text-white/70",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-black",
          cancelButton:
            "group-[.toast]:bg-white/15 group-[.toast]:text-white",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
