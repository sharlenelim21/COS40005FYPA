import { redirect } from "next/navigation";
import { TECHNICAL_GUIDE_HREF } from "@/components/doc/guides";

const LEGACY_TAB_SECTIONS: Record<string, string> = {
  introduction: "introduction",
  "getting-started": "getting-started",
  accounts: "accounts",
  "how-it-works": "how-it-works",
  "landmark-detection": "landmark-detection",
  reconstruction: "reconstruction",
};

export default async function DocIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  const section = typeof tab === "string" ? LEGACY_TAB_SECTIONS[tab] : undefined;
  redirect(section ? `${TECHNICAL_GUIDE_HREF}#${section}` : TECHNICAL_GUIDE_HREF);
}
