"use client";

import Link from "next/link";
import { Heart, Mail, MapPin } from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full bg-background border-t border-border mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Main Content */}
        <div className="flex flex-col lg:flex-row justify-between items-start gap-8">
          {/* Logo / Brand */}
          <div className="space-y-4 max-w-md">
            <div className="flex items-center space-x-2">
              <Heart className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold text-foreground">VisHeart</span>
            </div>
            <p className="text-muted-foreground">
              Advanced AI-powered cardiac segmentation platform for medical imaging analysis. Developed at Swinburne University for research and clinical applications.
            </p>

            {/* Location Section */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">Visit Us</span>
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

          {/* Navigation Links */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Navigation</h3>
            <div className="flex flex-col space-y-2">
              <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                Home
              </Link>
              <Link href="/about" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                About Us
              </Link>
              <Link href="/doc" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                Documentation
              </Link>
              <Link href="/sample" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                Sample NIfTI files
              </Link>
              <Link href="/policy" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                Privacy Policy
              </Link>
            </div>
          </div>

          {/* Contact Us Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Contact Us</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-sm">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">Dr. Miko Chang M.L.</span>
                </div>
                <div className="text-xs text-muted-foreground ml-6">Supervisor</div>
                <div className="text-xs ml-6">
                  <a href="mailto:mchang@swinburne.edu.my" className="text-muted-foreground hover:text-primary transition-colors">
                    mchang@swinburne.edu.my
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-sm">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">Kathy Wong H.Y.</span>
                </div>
                <div className="text-xs text-muted-foreground ml-6">Co-Supervisor</div>
                <div className="text-xs ml-6">
                  <a href="mailto:hywong@swinburne.edu.my" className="text-muted-foreground hover:text-primary transition-colors">
                    hywong@swinburne.edu.my
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-sm">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">James M.</span>
                </div>
                <div className="text-xs text-muted-foreground ml-6">Lead Developer</div>
                <div className="text-xs ml-6">
                  <a href="mailto:102775371@students.swinburne.edu.my" className="text-muted-foreground hover:text-primary transition-colors">
                    102775371@students.swinburne.edu.my
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-sm">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">Jesmine T.</span>
                </div>
                <div className="text-xs text-muted-foreground ml-6">Full-Stack Cloud Architect</div>
                <div className="text-xs ml-6">
                  <a href="mailto:102773605@students.swinburne.edu.my" className="text-muted-foreground hover:text-primary transition-colors">
                    102773605@students.swinburne.edu.my
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} VisHeart. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
