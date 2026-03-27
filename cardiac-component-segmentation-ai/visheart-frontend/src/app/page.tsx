"use client";

import FirstSection from "@/components/home/First";
import SecondSection from "@/components/home/Second";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <motion.main 
      className="w-full h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
    >
      <FirstSection />
      <SecondSection />
    </motion.main>
  );
}
