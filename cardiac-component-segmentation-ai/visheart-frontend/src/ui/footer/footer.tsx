"use client";

import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import { Linkedin, Mail, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import visheartLogo from "@/../public/visheart_logo.svg";
import { CURRENT_TEAM } from "@/data/currentTeam";
import { PREVIOUS_TEAM, displayName } from "@/data/previousTeam";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About Us" },
  { href: "/doc", label: "User Guide" },
  { href: "/sample", label: "Sample NIfTI files" },
  { href: "/policy", label: "Privacy Policy" },
] as const;

const HEADING_CLASS = "text-sm font-semibold text-foreground";
// Same red-to-pink gradient wordmark as the header (ui/header/header.tsx), so the footer logo
// reads as the same brand instead of a flat-colored lookalike.
const WORDMARK_CLASS = "bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text font-bold text-transparent";

// The icon itself is the link now, not decorative next to a printed address -- clicking it opens
// the mail app directly, per direct request (no visible email/"LinkedIn profile" text anymore).
function TeamEntry({ name, role, email, style }: { name: string; role: string; email?: string; style?: CSSProperties }) {
  return (
    <div className="min-w-0 space-y-0.5" style={style}>
      <div className="flex items-center space-x-1.5 text-[13px]">
        {email ? (
          <a href={`mailto:${email}`} aria-label={`Email ${name}`} title={email} className="shrink-0 text-primary transition-colors hover:text-primary/70">
            <Mail className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : (
          <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span className="min-w-0 font-medium text-foreground">{name}</span>
      </div>
      <div className="ml-5 text-xs text-muted-foreground">{role}</div>
    </div>
  );
}

// VisHeart 1.0 (previous team) has no verified university emails, so LinkedIn is the contact
// link here instead of mailto -- the icon itself links out when a profile URL was given.
function PreviousTeamEntry({ name, role, linkedin, style }: { name: string; role: string; linkedin?: string; style?: CSSProperties }) {
  return (
    <div className="min-w-0 space-y-0.5" style={style}>
      <div className="flex items-center space-x-1.5 text-[13px]">
        {linkedin ? (
          <a href={linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${name} on LinkedIn (opens in a new tab)`} className="shrink-0 text-primary transition-colors hover:text-primary/70">
            <Linkedin className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : (
          <Linkedin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span className="min-w-0 font-medium text-foreground">{name}</span>
      </div>
      <div className="ml-5 text-xs text-muted-foreground">{role}</div>
    </div>
  );
}

// 3 rows so 6 people split evenly 3/3 and 5 people split 3/2 (per direct request, so the 2nd
// column isn't just the overflow of the 1st).
const TEAM_ROWS = 3;

// VisHeart 2.0 and 1.0 used to be two separate, independent grid containers. Even with the same
// gap value, each grid sizes its own rows from its own content -- "Sharlene Lim / Project Lead &
// Backend Developer" wraps to 2 lines on the 2.0 side with nothing to match it on the 1.0 side,
// so the rows drift apart (reported live, 2026-11-15). Placing every entry in ONE shared grid
// instead (explicit column/row per person, not grid-flow auto-placement) makes row height a
// property of the whole grid, not each side's own content, so corresponding rows are always the
// same height on both sides.
function teamGridStyle(index: number, colOffset: number): CSSProperties {
  return {
    gridColumn: colOffset + Math.floor(index / TEAM_ROWS) + 1,
    gridRow: 2 + (index % TEAM_ROWS),
  };
}

export default function Footer({ minimal = false }: { minimal?: boolean }) {
  if (minimal) {
    return (
      <footer className="w-full bg-background border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-4 text-center">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} VisHeart. All rights reserved.</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="w-full bg-background border-t border-border mt-auto">
      {/* Tailwind's `.container` (not a fixed max-w-7xl), matching the dashboard page's own
          "container mx-auto" -- a fixed max-width diverges from it on wide monitors (1536px+),
          which is why the footer sat narrower/more inset than the cards above it. */}
      <div className="container mx-auto px-4 md:px-6 py-6">
        {/* 3 logical sections (Logo, Navigation, team sections). Navigation's column is `auto`
            (shrinks to its own content) instead of an equal 1fr share, which is what was leaving
            a big gap between it and the next section -- a short nav list doesn't need as much
            width as the team sections. The team sections are themselves ONE shared grid (see
            teamGridStyle), not two separate ones, so their rows stay aligned with each other. */}
        <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(14rem,1.1fr)_auto_minmax(0,2fr)]">
          {/* Logo / Brand */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Image src={visheartLogo} width={28} height={28} alt="VisHeart Logo" />
              <span className={cn("text-xl", WORDMARK_CLASS)}>VisHeart</span>
            </div>
            <p className="text-justify text-sm text-muted-foreground">
              Advanced AI-powered cardiac segmentation platform for medical imaging analysis. Developed at Swinburne University for research and clinical applications.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center space-x-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="font-medium text-foreground">Visit Us</span>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Swinburne University of Technology Sarawak</p>
                <p>Jalan Simpang Tiga, Kuching</p>
                <p>Sarawak, Malaysia</p>
                <a href="https://maps.google.com/?q=1.5315896,110.3568957" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors underline">
                  View on Google Maps
                </a>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="space-y-3">
            <h3 className={HEADING_CLASS}>Navigation</h3>
            <nav aria-label="Footer" className="flex flex-col space-y-1.5">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm whitespace-nowrap text-muted-foreground hover:text-primary transition-colors">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* VisHeart 2.0 Team (ours) + VisHeart 1.0 Team (previous developers), one shared grid
              -- not a separate acknowledgement block below, per direct request. LinkedIn instead
              of email for 1.0: see PreviousTeamEntry. */}
          <div className="grid min-w-0 grid-cols-4 gap-x-6 gap-y-4">
            <h3 className={HEADING_CLASS} style={{ gridColumn: "1 / span 2", gridRow: 1 }}>VisHeart 2.0 Team</h3>
            <h3 className={HEADING_CLASS} style={{ gridColumn: "3 / span 2", gridRow: 1 }}>VisHeart 1.0 Team</h3>
            {CURRENT_TEAM.map((member, i) => (
              <TeamEntry key={member.key} name={member.name} role={member.role} email={member.email} style={teamGridStyle(i, 0)} />
            ))}
            {PREVIOUS_TEAM.map((member, i) => (
              <PreviousTeamEntry key={member.key} name={displayName(member)} role={member.role} linkedin={member.linkedin} style={teamGridStyle(i, 2)} />
            ))}
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="text-base text-muted-foreground">© {new Date().getFullYear()} VisHeart. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
