import React from "react";
import Image, { StaticImageData } from "next/image";

// Import images for about page
import dr_miko_image from "../../../public/images/about/miko.jpg";
import ms_kathy_image from "../../../public/images/about/kathy.jpg";
import james_image from "../../../public/images/about/pfp-james.jpg";
import clarissa_image from "../../../public/images/about/pfp-cla.jpg";
import jesmine_image from "../../../public/images/about/pfp-jes.jpg";
import qh_image from "../../../public/images/about/pfp-qh.jpg";
import zia_image from "../../../public/images/about/pfp-zia.jpg";

interface MemberCardProps {
  name: string;
  role: string;
  imageUrl: StaticImageData;
  description: string;
}

const MemberCard: React.FC<MemberCardProps> = React.memo(
  ({ name, role, imageUrl, description }) => (
    <div className="group bg-card text-card-foreground relative overflow-hidden rounded-lg border shadow-sm transition-all duration-300 hover:shadow-xl">
      <Image
        src={imageUrl}
        alt={name}
        width={400}
        height={400}
        className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 to-transparent p-4 transition-all duration-300">
        <div className="translate-y-8 transition-transform duration-300 group-hover:translate-y-0">
          <h3 className="text-xl font-bold text-white">{name}</h3>
          <p className="text-sm text-red-400">{role}</p>
          <p className="mt-2 text-sm text-gray-300 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {description}
          </p>
        </div>
      </div>
    </div>
  ),
);

MemberCard.displayName = "MemberCard";

const AboutPage = () => {
  const supervisors = [
    {
      name: "Dr. Miko",
      role: "Project Supervisor",
      imageUrl: dr_miko_image,
      description:
        "Overseeing the project's technical direction and ensuring academic rigor.",
    },
    {
      name: "Ms. Kathy",
      role: "Co-Supervisor",
      imageUrl: ms_kathy_image,
      description:
        "Providing guidance on project management and user experience design.",
    },
  ];

  const team = [
    {
      name: "James",
      role: "Lead Developer",
      imageUrl: james_image,
      description:
        "Architecting the backend, pioneering the architecture choice and integrating machine learning models.",
    },
    {
      name: "Clarissa",
      role: "Backend Developer",
      imageUrl: clarissa_image,
      description:
        "Building the server-side logic and database infrastructure for robust performance.",
    },
    {
      name: "Jesmine",
      role: "AWS Developer",
      imageUrl: jesmine_image,
      description:
        "Managing cloud infrastructure and deployment on AWS to ensure scalability and reliability.",
    },
    // {
    //   name: "Qian Hui",
    //   role: "Frontend Developer",
    //   imageUrl: qh_image,
    //   description:
    //     "Crafting a responsive and intuitive user interface for a seamless experience.",
    // },
    // {
    //   name: "Zia",
    //   role: "ML Engineer",
    //   imageUrl: zia_image,
    //   description:
    //     "Implementing and optimizing the cardiac segmentation models for accuracy.",
    // },
  ];

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
              <MemberCard key={member.name} {...member} />
            ))}
          </div>
        </div>

        {/* Team Section */}
        <div>
          <h2 className="mb-8 text-center text-3xl font-bold">Meet the Team</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((member) => (
              <MemberCard key={member.name} {...member} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
