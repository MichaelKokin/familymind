import MemberNotes from "@/components/MemberNotes";
import { notesText as t } from "@/i18n/notes";

export default function MembersPage() {
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}><a href="/case/explore">← {t.back}</a><MemberNotes /></main>;
}
