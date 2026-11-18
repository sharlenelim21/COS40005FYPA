import { Linkedin, Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const iconButtonClass =
  "text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none";

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
