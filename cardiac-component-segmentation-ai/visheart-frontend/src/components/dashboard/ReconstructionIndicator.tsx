import { AlertCircle, Loader2, XCircle, Box } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectReconstructionStatus } from "@/hooks/useProjectReconstructionStatus";

interface ReconstructionIndicatorProps {
  status: ProjectReconstructionStatus | undefined;
  variant?: "badge" | "icon";
}

export function ReconstructionIndicator({ status, variant = "badge" }: ReconstructionIndicatorProps) {
  if (!status) {
    return null;
  }

  const { hasReconstructions, reconstructionCount, loading, error } = status;

  // Loading state
  if (loading) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            {variant === "badge" ? (
              <Badge variant="outline" className="gap-1 text-xs whitespace-nowrap">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking...
              </Badge>
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p>Checking reconstruction status...</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Error state
  if (error) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            {variant === "badge" ? (
              <Badge variant="outline" className="gap-1 border-orange-300 text-orange-700 text-xs whitespace-nowrap">
                <XCircle className="h-3 w-3" />
                Unknown
              </Badge>
            ) : (
              <XCircle className="h-4 w-4 text-orange-500" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p>Error checking reconstruction: {error}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Success states
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          {hasReconstructions ? (
            variant === "badge" ? (
              <Badge variant="outline" className="gap-1 border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs whitespace-nowrap">
                <Box className="h-3 w-3" />
                {reconstructionCount && reconstructionCount > 1 ? `${reconstructionCount} Models` : "Reconstructed"}
              </Badge>
            ) : (
              <Box className="h-4 w-4 text-blue-600" />
            )
          ) : (
            variant === "badge" ? (
              <Badge variant="outline" className="gap-1 border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 text-xs whitespace-nowrap">
                <AlertCircle className="h-3 w-3" />
                No 4D Model
              </Badge>
            ) : (
              <AlertCircle className="h-4 w-4 text-gray-600" />
            )
          )}
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {hasReconstructions 
              ? `This project has ${reconstructionCount || 1} 4D reconstruction${reconstructionCount && reconstructionCount > 1 ? 's' : ''}` 
              : "This project does not have 4D reconstructions yet"
            }
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
