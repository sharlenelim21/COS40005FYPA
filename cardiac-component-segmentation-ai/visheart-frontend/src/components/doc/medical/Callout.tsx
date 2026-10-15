import type { ReactNode } from "react";
import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalloutVariant } from "@/content/medicalGuide";

const VARIANTS: Record<CalloutVariant, { icon: typeof Info; label: string; className: string; iconClassName: string }> = {
  info: {
    icon: Info,
    label: "Note",
    className: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
    iconClassName: "text-blue-600 dark:text-blue-400",
  },
  caution: {
    icon: TriangleAlert,
    label: "Caution",
    className: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  disclaimer: {
    icon: ShieldAlert,
    label: "Disclaimer",
    className: "border-foreground/15 bg-muted/60 border-l-4 border-l-primary",
    iconClassName: "text-foreground",
  },
};

interface CalloutProps {
  variant: CalloutVariant;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Callout({ variant, title, children, className }: CalloutProps) {
  const { icon: Icon, label, className: variantClassName, iconClassName } = VARIANTS[variant];
  return (
    <aside
      role="note"
      aria-label={label}
      className={cn("flex gap-3 rounded-lg border p-4", variantClassName, className)}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconClassName)} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <div className="text-muted-foreground space-y-1 text-sm">{children}</div>
      </div>
    </aside>
  );
}
