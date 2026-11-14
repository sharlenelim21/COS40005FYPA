import { PREVIOUS_TEAM, displayName } from "@/data/previousTeam";
import { TEAM_GRID_CLASS, TeamMemberCard } from "@/components/team/TeamMemberCard";

export function PreviousTeamGrid() {
  return (
    <ul className={TEAM_GRID_CLASS}>
      {PREVIOUS_TEAM.map((member) => (
        <li key={member.key} className="min-w-0">
          <TeamMemberCard
            name={displayName(member)}
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
