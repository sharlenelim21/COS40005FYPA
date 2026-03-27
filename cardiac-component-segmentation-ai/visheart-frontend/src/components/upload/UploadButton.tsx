import React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { VariantProps } from "class-variance-authority";

interface UploadButtonProps
  extends Omit<React.ComponentProps<"button">, "onClick">,
    VariantProps<typeof buttonVariants> {
  onUploadClick: () => void;
  text?: string;
  icon?: boolean;
  asChild?: boolean;
}

export function UploadButton({
  onUploadClick,
  text = "Upload New Project",
  icon = true,
  className,
  variant,
  size,
  asChild,
  ...props
}: UploadButtonProps) {
  return (
    <Button
      onClick={onUploadClick}
      className={className}
      variant={variant}
      size={size}
      asChild={asChild}
      {...props}
    >
      {icon && <Upload className="mr-2 h-4 w-4" />}
      {text}
    </Button>
  );
}
