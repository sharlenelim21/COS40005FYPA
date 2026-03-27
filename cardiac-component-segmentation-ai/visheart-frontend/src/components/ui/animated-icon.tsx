"use client";

import { motion } from "framer-motion";
import React from "react";

interface AnimatedIconProps {
  children: React.ReactNode;
  className?: string;
  floatingAnimation?: boolean;
  hoverRotation?: number;
  hoverScale?: number;
}

export function AnimatedIcon({ 
  children, 
  className = "", 
  floatingAnimation = false,
  hoverRotation = 10,
  hoverScale = 1.1 
}: AnimatedIconProps) {
  return (
    <motion.div
      className={className}
      animate={floatingAnimation ? {
        y: [0, -10, 0],
      } : undefined}
      transition={floatingAnimation ? {
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut"
      } : undefined}
      whileHover={{ 
        rotate: hoverRotation, 
        scale: hoverScale,
        transition: { duration: 0.3 }
      }}
    >
      {children}
    </motion.div>
  );
}
