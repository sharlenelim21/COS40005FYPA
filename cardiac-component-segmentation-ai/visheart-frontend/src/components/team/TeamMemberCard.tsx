import Image from "next/image";
import { Linkedin, Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/data/previousTeam";
import { cn } from "@/lib/utils";

const AVATAR_SIZE = 40;

export interface TeamMemberCardProps {
  name: string;
  role: string;
  photo?: string;
  email?: string;
  linkedin?: string;
  className?: string;
}

const iconButtonClass =
  "text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none";

function Avatar({ name, photo }: { name: string; photo?: string }) {
  if (photo) {
    return (
      <Image
        src={photo}
        alt={`Photo of ${name}`}
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        sizes={`${AVATAR_SIZE}px`}
        className="h-10 w-10 shrink-0 rounded-full border object-cover"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={`Photo of ${name}`}
      className="bg-muted text-muted-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
    >
      {initials(name)}
    </span>
  );
}

export function TeamContactLinks({
  name,
  email,
  linkedin,
  className,
  buttonClassName = iconButtonClass,
}: {
  name: string;
  email?: string;
  linkedin?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const mail = email?.trim();
  const link = linkedin?.trim();
  if (!mail && !link) return null;

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      {mail && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a href={`mailto:${mail}`} aria-label={`Email ${name} (opens your mail app)`} className={buttonClassName}>
              <Mail className="h-4 w-4" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent>Email {name}</TooltipContent>
        </Tooltip>
      )}
      {link && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${name} on LinkedIn (opens in a new tab)`}
              className={buttonClassName}
            >
              <Linkedin className="h-4 w-4" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent>LinkedIn</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function TeamMemberCard({ name, role, photo, email, linkedin, className }: TeamMemberCardProps) {
  return (
    <div className={cn("bg-card flex h-full min-w-0 items-center gap-3 rounded-lg border p-3", className)}>
      <Avatar name={name} photo={photo} />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm leading-snug font-medium break-words">{name}</p>
        <p className="text-muted-foreground text-xs leading-snug break-words">{role}</p>
      </div>
      <TeamContactLinks name={name} email={email} linkedin={linkedin} />
    </div>
  );
}

export const TEAM_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3";
