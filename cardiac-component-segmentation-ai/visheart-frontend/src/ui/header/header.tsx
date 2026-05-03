"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useState, useEffect } from "react";
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from "@/components/ui/navigation-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "../theme-toggle";
import visheartLogo from "@/../public/visheart_logo.svg";
import { useAuth } from "@/context/auth-context";
import { AuthenticatedUserView } from "@/components/AuthenticatedUserView";
import { cn } from "@/lib/utils";
import { Menu, X, User, FileText, Info, Download, Shield, Users } from "lucide-react";

// Constants for menu items to avoid recreation on each render
const MOBILE_MENU_ITEMS = [
  {
    title: "Information",
    items: [
      {
        title: "Documentation",
        href: "/doc",
        icon: FileText,
        badge: "Updated",
        isComingSoon: false,
      },
      {
        title: "About Us",
        href: "/about",
        icon: Info,
        badge: undefined,
        isComingSoon: false,
      },
    ],
  },
] as const;

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Constants for header heights
  const HEADER_HEIGHT_NORMAL = 64; // h-16 = 64px
  const HEADER_HEIGHT_SCROLLED = 40; // h-10 = 40px
  const SCROLL_THRESHOLD = 20;

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > SCROLL_THRESHOLD);
          ticking = false;
        });
        ticking = true;
      }
    };

    // Add passive listener for better performance
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 right-0 left-0 z-[60]",
          "supports-[backdrop-filter]:bg-background/60 border-b backdrop-blur-md",
          "flex items-center",
          isScrolled ? "bg-background/95 border-border/80 h-10 shadow-sm" : "bg-background/50 border-border/40 h-16",
        )}
      >
        <div className="container mx-auto h-full px-4">
          <div className="flex h-full min-h-0 items-center justify-between">
            {/* Logo and Brand */}
            <div className="flex min-w-0 items-center space-x-2">
              <Link href="/" className="group flex items-center space-x-2">
                <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center">
                  <Image
                    src={visheartLogo}
                    width={32}
                    height={32}
                    alt="VisHeart Logo"
                    className={cn("transition-transform duration-200 ease-in-out", isScrolled ? "scale-90" : "scale-100")}
                  />
                </div>
                <span className="bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-xl font-bold whitespace-nowrap text-transparent">VisHeart</span>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden flex-shrink-0 items-center md:flex ml-[40vw]">
              <NavigationMenu>
                <NavigationMenuList className="space-x-1">
                  <ProfileDropDown />
                  <HomeDropDown />
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            {/* Right side controls */}
            <div className="flex flex-shrink-0 items-center space-x-2">
              <ThemeToggle iconSize={1.5} />

              {/* Mobile menu button */}
              <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="bg-background fixed top-0 right-0 h-full w-80 border-l shadow-lg">
            <div className="flex items-center justify-between border-b p-4">
              <span className="text-lg font-semibold">Menu</span>
              <Button variant="ghost" size="sm" onClick={() => setIsMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <MobileMenu onClose={() => setIsMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Spacer to prevent content from going under fixed header */}
      <div
        style={{
          height: isScrolled ? HEADER_HEIGHT_SCROLLED : HEADER_HEIGHT_NORMAL,
        }}
      />
    </>
  );
}

// Enhanced ListItem component with icons and better styling
const ListItem = React.memo(function ListItem({
  title,
  children,
  href,
  icon: Icon,
  badge,
  isComingSoon = false,
  as = "li",
  className,
  ...props
}: React.ComponentPropsWithoutRef<"a"> & {
  href: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string;
  isComingSoon?: boolean;
  as?: "li" | "div";
  className?: string;
}) {
  const handleClick = (e: React.MouseEvent) => {
    if (isComingSoon) {
      e.preventDefault();
    }
  };

  const Component = as;

  return (
    <Component className={cn("flex", className)}>
      <NavigationMenuLink asChild>
        <Link
          href={isComingSoon ? "#" : href}
          className={cn(
            "group relative flex h-full w-full flex-col space-y-1 rounded-lg p-4 leading-none no-underline outline-none select-none",
            "hover:bg-accent/50 hover:scale-[1.02] hover:shadow-md",
            "focus:bg-accent focus:text-accent-foreground",
            "hover:border-border/50 border border-transparent",
            isComingSoon && "cursor-not-allowed opacity-60",
          )}
          onClick={handleClick}
          {...props}
        >
          <div className="flex items-center space-x-3">
            {Icon && (
              <div className="bg-primary/10 group-hover:bg-primary/20 flex-shrink-0 rounded-md p-2">
                <Icon className="text-primary h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <span className="group-hover:text-primary truncate text-base font-semibold">{title}</span>
                {badge && (
                  <Badge variant="secondary" className="text-xs">
                    {badge}
                  </Badge>
                )}
                {isComingSoon && (
                  <Badge variant="outline" className="text-xs">
                    Soon
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <p className="text-muted-foreground mt-1 flex-1 text-sm leading-snug">{children}</p>
        </Link>
      </NavigationMenuLink>
    </Component>
  );
});

// Enhanced HomeDropDown component
const HomeDropDown = React.memo(function HomeDropDown() {
  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger className="group hover:bg-accent/50 data-[state=open]:bg-accent/50 h-10 bg-transparent px-4 py-2">
        <div className="flex items-center space-x-2">
          <Info className="h-4 w-4" />
          <span>Help</span>
        </div>
      </NavigationMenuTrigger>
      <NavigationMenuContent className="bg-background/95 border shadow-lg backdrop-blur-md">
        <div className="w-[400px] p-6">
          <ul className="flex flex-col space-y-3">
            <ListItem href="/doc" title="Documentation" icon={FileText} badge="Updated" className="min-h-20">
              A work in progress guide on using VisHeart&apos;s features, tools, and best practices for cardiac imaging.
            </ListItem>
            <ListItem href="/sample" title="Sample NIfTI" icon={Download} className="min-h-16">
              Download sample cardiac imaging files for testing.
            </ListItem>
            <ListItem href="/policy" title="Privacy Policy" icon={Shield} className="min-h-16">
              Review our privacy policy and terms of service.
            </ListItem>
            <ListItem href="/about" title="About Us" icon={Users} className="min-h-20">
              Meet the VisHeart team and learn about our mission to advance cardiac imaging technology.
            </ListItem>
          </ul>
        </div>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
});

// Enhanced ProfileDropDown component
const ProfileDropDown = React.memo(function ProfileDropDown() {
  const { user } = useAuth();

  if (user) {
    // Show profile dropdown for authenticated users
    return (
      <NavigationMenuItem>
        <NavigationMenuTrigger className="group hover:bg-accent/50 data-[state=open]:bg-accent/50 h-10 bg-transparent px-4 py-2">
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4" />
            <span>Profile</span>
          </div>
        </NavigationMenuTrigger>
        <NavigationMenuContent className="bg-background/95 border shadow-lg backdrop-blur-md">
          <div className="p-4">
            <AuthenticatedUserView />
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
    );
  } else {
    // Show login button that redirects to /login page
    return (
      <NavigationMenuItem>
        <Link href="/login" className="group hover:bg-accent/50 data-[state=open]:bg-accent/50 flex h-10 items-center rounded-md bg-transparent px-4 py-2">
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4" />
            <span>Sign In</span>
          </div>
        </Link>
      </NavigationMenuItem>
    );
  }
});

// Mobile Menu Component
const MobileMenu = React.memo(function MobileMenu({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4">
        {/* User Section */}
        <div className="border-b pb-4">
          {user ? (
            <div className="space-y-3">
              <AuthenticatedUserView />
            </div>
          ) : (
            <div className="space-y-3">
              <Link href="/login" onClick={onClose} className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center space-x-3 rounded-lg p-3">
                <User className="h-4 w-4" />
                <span className="font-medium">Sign In</span>
              </Link>
            </div>
          )}
        </div>

        {/* Menu Sections */}
        {MOBILE_MENU_ITEMS.map((section) => (
          <div key={section.title} className="space-y-3">
            <h3 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{section.title}</h3>
            <div className="space-y-2">
              {section.items.map((item) => (
                <div key={item.title}>
                  <Link
                    href={item.isComingSoon ? "#" : item.href}
                    onClick={item.isComingSoon ? (e) => e.preventDefault() : onClose}
                    className={cn("flex items-center space-x-3 rounded-lg p-3", "hover:bg-accent hover:text-accent-foreground", item.isComingSoon && "cursor-not-allowed opacity-60")}
                  >
                    <div className="bg-primary/10 flex-shrink-0 rounded-md p-2">
                      <item.icon className="text-primary h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="truncate font-medium">{item.title}</span>
                        {item.badge && (
                          <Badge variant="secondary" className="text-xs">
                            {item.badge}
                          </Badge>
                        )}
                        {item.isComingSoon && (
                          <Badge variant="outline" className="text-xs">
                            Soon
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
