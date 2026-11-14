import Image from "next/image";
import { TeamContactLinks } from "@/components/team/TeamMemberCard";
import { initials } from "@/data/previousTeam";

export interface TeamProfileCardProps {
  name: string;
  role: string;
  photo?: string;
  bio?: string;
  email?: string;
  linkedin?: string;
}

const overlayIconClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export function TeamProfileCard({ name, role, photo, bio, email, linkedin }: TeamProfileCardProps) {
  return (
    <div className="group bg-card text-card-foreground relative overflow-hidden rounded-lg border shadow-sm transition-all duration-300 hover:shadow-xl">
      {photo ? (
        <Image
          src={photo}
          alt={name}
          width={400}
          height={400}
          className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center text-5xl font-semibold" aria-hidden="true">
          {initials(name)}
        </div>
      )}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 to-transparent p-4 transition-all duration-300">
        <div className={bio ? "translate-y-8 transition-transform duration-300 group-hover:translate-y-0" : undefined}>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xl font-bold text-white">{name}</h3>
              <p className="text-sm text-red-400">{role}</p>
            </div>
            <TeamContactLinks name={name} email={email} linkedin={linkedin} buttonClassName={overlayIconClass} />
          </div>
          {bio && (
            <p className="mt-2 text-sm text-gray-300 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              {bio}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
