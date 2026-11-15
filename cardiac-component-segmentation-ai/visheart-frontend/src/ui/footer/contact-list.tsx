import { CURRENT_TEAM } from "@/data/currentTeam";
import { ContactStrip } from "./contact-strip";

export function ContactList() {
  return (
    <ul className="grid auto-rows-fr grid-cols-1 gap-3 md:auto-cols-[21rem] md:grid-flow-col md:grid-cols-none md:grid-rows-[repeat(4,1fr)]">
      {CURRENT_TEAM.map((member) => (
        <li key={member.key} className="min-w-0">
          <ContactStrip
            name={member.name}
            photo={member.photo}
            tooltip={member.role}
            detail={member.email ? { label: member.email, href: `mailto:${member.email}` } : { label: member.role }}
          />
        </li>
      ))}
    </ul>
  );
}
