"use client";

import Link from "next/link";
import { Heart, MapPin } from "lucide-react";
import { FooterSection } from "./footer-section";
import { CurrentTeamGrid } from "./current-team";
import { PreviousTeamGrid } from "./previous-team";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About Us" },
  { href: "/doc", label: "User Guide" },
  { href: "/sample", label: "Sample NIfTI files" },
  { href: "/policy", label: "Privacy Policy" },
] as const;

export default function Footer({ minimal = false }: { minimal?: boolean }) {
  if (minimal) {
    return (
      <footer className="w-full bg-background border-t border-border mt-auto">
        <div className="container mx-auto px-4 md:px-6 py-4 text-center">
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
      <div className="container mx-auto px-4 md:px-6 py-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center space-x-2">
              <Heart className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold text-foreground">VisHeart</span>
            </div>
            <p className="text-muted-foreground max-w-prose">
              Advanced AI-powered cardiac segmentation platform for medical imaging analysis. Developed at Swinburne University for research and clinical applications.
            </p>
          </div>

          <FooterSection id="footer-navigation" title="Navigation">
            <nav aria-label="Footer" className="flex flex-col space-y-2">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {link.label}
                </Link>
              ))}
            </nav>
          </FooterSection>

          <div className="min-w-0 space-y-3">
            <div className="flex items-center space-x-2 text-sm">
              <MapPin className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-foreground">Visit Us</h3>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Swinburne University of Technology Sarawak </p>
              <p>Jalan Simpang Tiga, Kuching</p>
              <p>Sarawak, Malaysia</p>
              <a href="https://maps.google.com/?q=1.5315896,110.3568957" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors underline">
                View on Google Maps
              </a>
            </div>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 sm:space-y-8 sm:border-t sm:border-border sm:pt-6">
          <FooterSection id="footer-current-team" title="Current Team">
            <CurrentTeamGrid />
          </FooterSection>

          <FooterSection id="footer-previous-team" title="Previous Team" subtitle="Original VisHeart developers">
            <PreviousTeamGrid />
          </FooterSection>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} VisHeart. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
