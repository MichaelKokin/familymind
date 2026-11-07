import type { Metadata } from "next";
import PrivateCaseApp from "@/components/PrivateCaseApp";

export const metadata: Metadata = {
  title: "Family Mind · исследовательское дело",
  description:
    "Локальное исследовательское дело с источниками и проверкой предложений.",
  robots: { index: false, follow: false },
};

export default function PrivateCasePage() {
  return <PrivateCaseApp />;
}
