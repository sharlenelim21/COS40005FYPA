import type { ReactNode } from "react";
import { FlaskConical, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalloutVariant } from "@/content/medicalGuide";

interface VariantStyle {
  icon: typeof Info;
  label: string;
  className: string;
  iconClassName: string;
  titleClassName?: string;
  bodyClassName?: string;
}

const VARIANTS: Record<CalloutVariant, VariantStyle> = {
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
  // Research-only output (e.g. RV strain): red, and the text is red too.
  warning: {
    icon: FlaskConical,
    label: "Warning",
    className: "border-red-300 bg-red-50 border-l-4 border-l-red-600 dark:border-red-800 dark:bg-red-950/40 dark:border-l-red-500",
    iconClassName: "text-red-600 dark:text-red-400",
    titleClassName: "text-red-700 dark:text-red-300",
    bodyClassName: "text-red-800 dark:text-red-200",
  },
};

interface CalloutProps {
  variant: CalloutVariant;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Callout({ variant, title, children, className }: CalloutProps) {
  const { icon: Icon, label, className: variantClassName, iconClassName, titleClassName, bodyClassName } =
    VARIANTS[variant];
  return (
    <aside
      role="note"
      aria-label={label}
      className={cn("flex gap-3 rounded-lg border p-4", variantClassName, className)}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconClassName)} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className={cn("text-base font-semibold", titleClassName)}>{title}</p>
        <div className={cn("text-muted-foreground space-y-1 text-base", bodyClassName)}>{children}</div>
      </div>
    </aside>
  );
}
