// This component appears when no project with the given ID is found.

"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Heart, ArrowLeft } from "lucide-react";

interface ErrorProjectProps {
  error?: string; // Optional error message to display
}

/**
 *
 * @param error - Optional error message to display
 * @returns A component that displays a "Project Not Found" message with an option to return to the dashboard.
 */
export const ErrorProject = ({ error }: ErrorProjectProps) => {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
          <Heart className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-foreground text-2xl font-bold">An error has occured. 😞</h1>
          <p className="text-muted-foreground">{error ? error : "An unknown error has occured. 🤷"}</p>
        </div>
        <Button onClick={() => router.push("/dashboard")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
};
