import type { Metadata } from "next";
import PrivateExplore from "@/components/PrivateExplore";
import { exploreText as t } from "@/i18n/explore";
export const metadata: Metadata = { title: t.pageTitle, description: t.description, robots: { index: false, follow: false } };
export default function ExplorePage() { return <PrivateExplore />; }
