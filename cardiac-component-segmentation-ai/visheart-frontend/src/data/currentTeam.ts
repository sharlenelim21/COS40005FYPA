export type CurrentTeamGroup = "supervisor" | "student";

export interface CurrentTeamMember {
  key: string;
  name: string;
  role: string;
  group: CurrentTeamGroup;
  email?: string;
  linkedin?: string;
  photo?: string;
  bio: string;
}

export const CURRENT_TEAM: readonly CurrentTeamMember[] = [
  {
    key: "miko",
    name: "Dr. Miko Chang M.L.",
    role: "Supervisor",
    group: "supervisor",
    email: "mchang@swinburne.edu.my",
    photo: "/images/about/miko.jpg",
    bio: "Overseeing the project's technical direction and ensuring academic rigor.",
  },
  {
    key: "kathy",
    name: "Kathy Wong H.Y.",
    role: "Co-Supervisor",
    group: "supervisor",
    email: "hywong@swinburne.edu.my",
    photo: "/images/about/kathy.jpg",
    bio: "Providing guidance on project management and user experience design.",
  },
  {
    key: "sharlene",
    name: "Sharlene Lim",
    role: "Project Lead & Backend Developer",
    group: "student",
    email: "102783112@students.swinburne.edu.my",
    photo: "/images/about/pfp-shar.jpg",
    bio: "Leading the team’s direction, overseeing technical decisions, and supporting system development with a focus on overall project coordination.",
  },
  {
    key: "stefani",
    name: "Stefani Lee Shi Huey",
    role: "Backend Developer",
    group: "student",
    email: "102783196@students.swinburne.edu.my",
    photo: "/images/about/pfp-shi.jpg",
    bio: "Supporting system development and implementation, with a focus on ensuring functionality, stability, and integration across components.",
  },
  {
    key: "jiayi",
    name: "Ngui Jia Yi",
    role: "Backend Developer",
    group: "student",
    email: "102783222@students.swinburne.edu.my",
    photo: "/images/about/pfp-jia.jpg",
    bio: "Managing product requirements, prioritizing features, and ensuring alignment between client expectations and system development.",
  },
  {
    key: "meiqi",
    name: "Liew Mei Qi",
    role: "Frontend Developer & Scrum Master",
    group: "student",
    email: "102780236@students.swinburne.edu.my",
    photo: "/images/about/pfp-mei.jpg",
    bio: "Coordinating the team’s workflow, managing sprint progress, and ensuring smooth communication while contributing to frontend development and system integration.",
  },
];
