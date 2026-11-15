import { PREVIOUS_TEAM, displayName, type PreviousTeamMember } from "@/data/previousTeam";
import { ContactStrip, type ContactStripDetail } from "./contact-strip";

function detailFor(member: PreviousTeamMember): ContactStripDetail {
  const email = member.email?.trim();
  if (email) return { label: email, href: `mailto:${email}` };
  const linkedin = member.linkedin?.trim();
  if (linkedin) return { label: "LinkedIn profile", href: linkedin, external: true };
  return { label: member.role };
}

export function PreviousTeamGrid() {
  return (
    <ul className="grid auto-rows-fr grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2">
      {PREVIOUS_TEAM.map((member) => (
        <li key={member.key} className="min-w-0">
          <ContactStrip
            size="compact"
            name={displayName(member)}
            photo={member.photo}
            tooltip={member.role}
            detail={detailFor(member)}
          />
        </li>
      ))}
    </ul>
  );
}
