import React from "react";
import { CURRENT_TEAM } from "@/data/currentTeam";
import { PREVIOUS_TEAM, displayName } from "@/data/previousTeam";
import { TeamProfileCard } from "@/components/team/TeamProfileCard";

const AboutPage = () => {
  const supervisors = CURRENT_TEAM.filter((member) => member.group === "supervisor");
  const team = CURRENT_TEAM.filter((member) => member.group === "student");

  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto px-4 py-16">
        {/* Header Section */}
        <div className="mb-16 text-center">
          <h1 className="text-primary text-5xl font-extrabold tracking-tight">
            About VisHeart
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-lg">
            Innovating at the intersection of AI and cardiac care to empower
            medical professionals and researchers.
          </p>
        </div>

        {/* Mission Section */}
        <div className="mb-20 text-center">
          <h2 className="mb-4 text-3xl font-bold">Our Mission</h2>
          <p className="text-muted-foreground mx-auto max-w-3xl">
            We are a team of Swinburne University students dedicated to creating
            VisHeart, an innovative platform for cardiac segmentation. Our goal
            is to simplify cardiac imaging analysis, making powerful tools
            accessible and user-friendly for both medical experts and academic
            researchers.
          </p>
        </div>

        {/* Supervisors Section */}
        <div className="mb-20">
          <h2 className="mb-8 text-center text-3xl font-bold">
            Guidance & Leadership
          </h2>
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
            {supervisors.map((member) => (
              <TeamProfileCard key={member.key} name={member.name} role={member.role} photo={member.photo} bio={member.bio} email={member.email} linkedin={member.linkedin} />
            ))}
          </div>
        </div>

        {/* Team Section */}
        <div>
          <h2 className="mb-8 text-center text-3xl font-bold">Meet the Team</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((member) => (
              <TeamProfileCard key={member.key} name={member.name} role={member.role} photo={member.photo} bio={member.bio} email={member.email} linkedin={member.linkedin} />
            ))}
          </div>
        </div>

        <section aria-labelledby="about-previous-team" className="mt-20">
          <h2 id="about-previous-team" className="mb-2 text-center text-3xl font-bold">
            Previous Team
          </h2>
          <p className="text-muted-foreground text-center">Original VisHeart developers</p>
          <p className="text-muted-foreground mx-auto mt-2 mb-8 max-w-2xl text-center">
            VisHeart was first built by these developers. We thank them for the foundation our work continues from.
          </p>
          <ul className="flex flex-wrap justify-center gap-8">
            {PREVIOUS_TEAM.map((member) => (
              <li key={member.key} className="w-full sm:w-[calc((100%-2rem)/2)] lg:w-[calc((100%-4rem)/3)]">
                <TeamProfileCard
                  name={displayName(member)}
                  role={member.role}
                  photo={member.photo}
                  email={member.email}
                  linkedin={member.linkedin}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default AboutPage;
