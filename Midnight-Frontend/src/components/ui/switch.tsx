import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-[background,border-color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=unchecked]:border-switch-off-border data-[state=unchecked]:bg-switch-off data-[state=unchecked]:shadow-[inset_0_1px_3px_oklch(0.3_0.05_300/18%)]",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_8px_20px_-10px_oklch(0.25_0.1_300/70%)]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[1.375rem] w-[1.375rem] rounded-full bg-primary-foreground shadow-[0_2px_6px_oklch(0.25_0.05_300/35%),inset_0_-2px_4px_oklch(0.7_0.05_300/25%)] ring-0 transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)] data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
