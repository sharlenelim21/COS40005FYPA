import Image from "next/image";
import { initials } from "@/data/previousTeam";
import { cn } from "@/lib/utils";

export interface ContactStripDetail {
  label: string;
  href?: string;
  external?: boolean;
}

interface ContactStripProps {
  name: string;
  photo?: string;
  detail: ContactStripDetail;
  tooltip?: string;
  size?: "default" | "compact";
}

export function ContactStrip({ name, photo, detail, tooltip, size = "default" }: ContactStripProps) {
  const compact = size === "compact";
  const avatarPx = compact ? 34 : 40;
  const avatarClass = compact ? "h-[34px] w-[34px]" : "h-10 w-10";

  return (
    <div
      title={tooltip}
      className="flex h-full min-w-0 items-stretch gap-2.5 rounded-lg border border-border bg-muted/30 p-2.5"
    >
      <span className="flex shrink-0 items-center">
        {photo ? (
          <Image
            src={photo}
            alt=""
            width={avatarPx}
            height={avatarPx}
            sizes={`${avatarPx}px`}
            className={cn(avatarClass, "rounded-full object-cover")}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(avatarClass, "flex items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground")}
          >
            {initials(name)}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center">
        <span className="h-[70%] w-px bg-border" />
      </span>
      <span className="flex min-w-0 flex-col justify-center">
        <span className="text-sm leading-snug font-semibold text-foreground">{name}</span>
        {detail.href ? (
          <a
            href={detail.href}
            {...(detail.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-xs leading-snug break-all text-muted-foreground hover:text-foreground hover:underline"
          >
            {detail.label}
          </a>
        ) : (
          <span className="text-xs leading-snug text-muted-foreground">{detail.label}</span>
        )}
      </span>
    </div>
  );
}
