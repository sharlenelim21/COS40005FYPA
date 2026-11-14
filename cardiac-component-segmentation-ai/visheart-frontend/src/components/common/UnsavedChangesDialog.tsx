"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

interface UnsavedChangesDialogProps {
  open: boolean;
  description: string;
  onStay: () => void;
  onLeave: () => void;
}

export function UnsavedChangesDialog({ open, description, onStay, onLeave }: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onStay(); }}>
      <AlertDialogContent onOverlayClick={onStay}>
        <AlertDialogHeader>
          <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Go back and save</AlertDialogCancel>
          <AlertDialogAction onClick={onLeave} className={buttonVariants({ variant: "destructive" })}>
            Leave anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
