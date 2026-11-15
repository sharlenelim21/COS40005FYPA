"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { ContactList } from "./contact-list";
import { PreviousTeamGrid } from "./previous-team";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About Us" },
  { href: "/doc", label: "User Guide" },
  { href: "/sample", label: "Sample NIfTI files" },
  { href: "/policy", label: "Privacy Policy" },
] as const;

const HEADING_CLASS = "text-sm font-semibold text-foreground";

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
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center space-x-2">
          <Heart className="h-8 w-8 text-primary" aria-hidden="true" />
          <span className="text-2xl font-bold text-foreground">VisHeart</span>
        </div>

        <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(14rem,0.8fr)_auto_minmax(0,1.2fr)]">
          <div className="grid min-w-0 grid-cols-1 items-start gap-8 md:grid-cols-3 xl:col-span-2 2xl:col-span-1 2xl:grid-cols-1">
            <p className="min-w-0 max-w-prose text-sm text-muted-foreground">
              Advanced AI-powered cardiac segmentation platform for medical imaging analysis. Developed at Swinburne University for research and clinical applications.
            </p>

            <section aria-labelledby="footer-visit-us" className="min-w-0 space-y-3">
              <h3 id="footer-visit-us" className={HEADING_CLASS}>Visit Us</h3>
              <address className="text-sm not-italic text-muted-foreground">
                <p>Swinburne University of Technology Sarawak</p>
                <p>Jalan Simpang Tiga, Kuching</p>
                <p>Sarawak, Malaysia</p>
                <a href="https://maps.google.com/?q=1.5315896,110.3568957" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors underline">
                  View on Google Maps
                </a>
              </address>
            </section>

            <section aria-labelledby="footer-navigation" className="min-w-0 space-y-3">
              <h3 id="footer-navigation" className={HEADING_CLASS}>Navigation</h3>
              <nav aria-label="Footer" className="flex flex-col space-y-2">
                {NAV_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                ))}
              </nav>
            </section>
          </div>

          <section aria-labelledby="footer-contact" className="min-w-0 space-y-3">
            <h3 id="footer-contact" className={HEADING_CLASS}>Contact Us</h3>
            <ContactList />
          </section>

          <section aria-labelledby="footer-previous-team" className="min-w-0 space-y-3">
            <div>
              <h3 id="footer-previous-team" className={HEADING_CLASS}>Previous Team</h3>
              <p className="mt-1 text-xs text-muted-foreground">Original VisHeart developers</p>
            </div>
            <PreviousTeamGrid />
          </section>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-6 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} VisHeart. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
