import Image from "next/image";
import { Linkedin } from "lucide-react";
import { PREVIOUS_TEAM, displayName, initials, type PreviousTeamMember } from "@/data/previousTeam";

const AVATAR_SIZE = 40;

function Avatar({ member, name }: { member: PreviousTeamMember; name: string }) {
  if (member.photo) {
    return (
      <Image
        src={member.photo}
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

export function PreviousTeam() {
  return (
    <section aria-labelledby="footer-previous-team" className="border-border mt-8 border-t pt-6">
      <h3 id="footer-previous-team" className="text-foreground text-sm font-semibold">
        Previous Team
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">Original VisHeart team (FYP A)</p>
      <ul className="mt-4 grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {PREVIOUS_TEAM.map((member) => {
          const name = displayName(member);
          const linkedin = member.linkedin?.trim();
          return (
            <li key={member.key} className="flex min-w-0 items-center gap-3">
              <Avatar member={member} name={name} />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">{name}</p>
                <p className="text-muted-foreground truncate text-xs">{member.role}</p>
              </div>
              {linkedin && (
                <a
                  href={linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${name} on LinkedIn (opens in a new tab)`}
                  className="text-muted-foreground hover:text-primary focus-visible:ring-ring shrink-0 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Linkedin className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
