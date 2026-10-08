import { redirect } from "next/navigation";
import { TECHNICAL_GUIDE_HREF } from "@/components/doc/guides";

export default function DocIndexPage() {
  redirect(TECHNICAL_GUIDE_HREF);
}
