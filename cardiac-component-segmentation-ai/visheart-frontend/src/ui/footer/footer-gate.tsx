"use client";

import { usePathname } from "next/navigation";
import Footer from "./footer";

const MINIMAL_FOOTER_PREFIXES = ["/admin", "/extend-training"];

/** Keeps the root layout a server component — this is the only piece that needs the
 *  current path, to show the full site footer everywhere except the admin-only pages
 *  (Admin Panel, UNet Extend Training), which get just the copyright line instead. */
export default function FooterGate() {
  const pathname = usePathname();
  const minimal = pathname ? MINIMAL_FOOTER_PREFIXES.some((prefix) => pathname.startsWith(prefix)) : false;
  return <Footer minimal={minimal} />;
}
