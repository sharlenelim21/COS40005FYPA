// This component toggles between light and dark themes using Next.js's `next-themes` package.
// To choose the size of the icons, you can pass an `iconSize` prop in rem units.
// Example:
// <ThemeToggle iconSize={0.75} />  // 0.75rem icons
// <ThemeToggle iconSize={1.5} />   // 1.5rem icons

"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

enum Theme {
  Light = "light",
  Dark = "dark",
}

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Define the props for the ThemeToggle component
interface ThemeToggleProps {
  iconSize?: number; // size in rem units
}

// ThemeToggle component that allows users to switch between light and dark themes
// Default icon size is set to 1rem, but can be customized via the `iconSize` prop
export default function ThemeToggle({ iconSize = 1 }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Get opposite theme
  const getOppositeTheme = () => {
    return resolvedTheme === Theme.Light ? Theme.Dark : Theme.Light;
  };

  if (!mounted) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground hover:!bg-background/20 h-9 w-9 !bg-transparent transition-all duration-200 hover:backdrop-blur-sm"
            suppressHydrationWarning
            style={
              {
                "--icon-size": `${iconSize}rem`,
                width: `${iconSize * 2.25}rem`,
                height: `${iconSize * 2.25}rem`,
              } as React.CSSProperties
            }
          >
            <Sun
              style={{ width: `${iconSize}rem`, height: `${iconSize}rem` }}
            />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="w-auto text-center">
          <div className="text-sm">Toggle Theme</div>
          <p className="text-muted-foreground">
            Switch to <span className="capitalize">dark</span>{" "}
            mode.
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() =>
            setTheme(resolvedTheme === Theme.Light ? Theme.Dark : Theme.Light)
          }
          className="text-foreground hover:!bg-background/20 h-9 w-9 !bg-transparent transition-all duration-200 hover:backdrop-blur-sm"
          suppressHydrationWarning
          style={
            {
              "--icon-size": `${iconSize}rem`,
              width: `${iconSize * 2.25}rem`,
              height: `${iconSize * 2.25}rem`,
            } as React.CSSProperties
          }
        >
          {resolvedTheme === "light" ? (
            <Sun
              style={{ width: `${iconSize}rem`, height: `${iconSize}rem` }}
            />
          ) : (
            <Moon
              style={{ width: `${iconSize}rem`, height: `${iconSize}rem` }}
            />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="w-auto text-center">
        <div className="text-sm">Toggle Theme</div>
        <p className="text-muted-foreground">
          Switch to <span className="capitalize">{getOppositeTheme()}</span>{" "}
          mode.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
