export const FULL_NAME_PLACEHOLDER = "[FULL NAME]";

export type PreviousTeamKey = "jas" | "james" | "cla" | "zia" | "qh";

export interface PreviousTeamMember {
  key: PreviousTeamKey;
  name: string;
  fullName: string;
  role: string;
  photo?: string;
  linkedin?: string;
  email?: string;
}

export const PREVIOUS_TEAM: readonly PreviousTeamMember[] = [
  {
    key: "james",
    name: "James",
    fullName: FULL_NAME_PLACEHOLDER,
    role: "Lead Developer",
    photo: "/images/about/pfp-james.jpg",
    linkedin: "https://www.linkedin.com/in/james-muking-2ba515313/",
    email: "",
  },
  {
    key: "cla",
    name: "Clarissa",
    fullName: FULL_NAME_PLACEHOLDER,
    role: "Backend Developer",
    photo: "/images/about/pfp-cla.jpg",
    linkedin: "https://www.linkedin.com/in/clarissa-wong-tech/",
    email: "",
  },
  {
    key: "jas",
    name: "Jesmine",
    fullName: FULL_NAME_PLACEHOLDER,
    role: "AWS Developer",
    photo: "/images/about/pfp-jes.jpg",
    linkedin: "https://www.linkedin.com/in/jesmineting/",
    email: "",
  },
  {
    key: "qh",
    name: "Qian Hui",
    fullName: FULL_NAME_PLACEHOLDER,
    role: "Frontend Developer",
    photo: "/images/about/pfp-qh.jpg",
    linkedin: "https://www.linkedin.com/in/qian-hui-yee-2773262b8/",
    email: "",
  },
  {
    key: "zia",
    name: "Zia",
    fullName: FULL_NAME_PLACEHOLDER,
    role: "ML Engineer",
    photo: "/images/about/pfp-zia.jpg",
    linkedin: "https://www.linkedin.com/in/zia-tan-4064562b7/",
    email: "",
  },
];

export function displayName(member: PreviousTeamMember): string {
  const fullName = member.fullName.trim();
  return fullName && fullName !== FULL_NAME_PLACEHOLDER ? fullName : member.name;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
