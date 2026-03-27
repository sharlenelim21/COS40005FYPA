import { CheckCircle2, AlertCircle, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectSegmentationStatus } from "@/hooks/useProjectSegmentationStatus";

interface SegmentationIndicatorProps {
  status: ProjectSegmentationStatus | undefined;
  variant?: "badge" | "icon";
}

export function SegmentationIndicator({ status, variant = "badge" }: SegmentationIndicatorProps) {
  if (!status) {
    return null;
  }

  const { hasMasks, loading, error } = status;

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
            <p>Checking segmentation status...</p>
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
            <p>Error checking segmentation: {error}</p>
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
          {hasMasks ? (
            variant === "badge" ? (
              <Badge variant="outline" className="gap-1 border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300 text-xs whitespace-nowrap">
                <CheckCircle2 className="h-3 w-3" />
                Segmented
              </Badge>
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            )
          ) : (
            variant === "badge" ? (
              <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300 text-xs whitespace-nowrap">
                <AlertCircle className="h-3 w-3" />
                No Masks
              </Badge>
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600" />
            )
          )}
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {hasMasks 
              ? "This project has segmentation masks" 
              : "This project does not have segmentation masks yet"
            }
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
