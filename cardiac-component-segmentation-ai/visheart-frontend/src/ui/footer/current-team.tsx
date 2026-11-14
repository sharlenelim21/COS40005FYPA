import { CURRENT_TEAM } from "@/data/currentTeam";
import { TEAM_GRID_CLASS, TeamMemberCard } from "@/components/team/TeamMemberCard";

export function CurrentTeamGrid() {
  return (
    <ul className={TEAM_GRID_CLASS}>
      {CURRENT_TEAM.map((member) => (
        <li key={member.key} className="min-w-0">
          <TeamMemberCard
            name={member.name}
            role={member.role}
            photo={member.photo}
            email={member.email}
            linkedin={member.linkedin}
          />
        </li>
      ))}
    </ul>
  );
}
