import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";

const short = z.string().max(2000);
const prose = z.string().max(50000);
const ids = z.array(privateId).max(300);
const safeUrl = z.string().max(4000).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
});
const placeFact = z.object({ kind: z.enum(["birth", "residence", "death", "evacuation"]), place: short.min(1), dateText: short.optional(), sourceIds: ids, status: short }).strict();
const person = z.object({ id: privateId, name: short.min(1), dates: short, relation: short, biography: prose, branch: short, status: short, livingStatus: z.enum(["living", "deceased", "unknown"]).optional(), sourceIds: ids, photoIds: ids, generation: z.number().int().min(0).max(12), birthDate: short.optional(), birthPlace: short.optional(), deathDate: short.optional(), deathPlace: short.optional(), residencePlaces: z.array(short).max(100).optional(), placeFacts: z.array(placeFact).max(100).optional() }).strict();
const source = z.object({ id: privateId, title: short.min(1), url: safeUrl, locator: prose, kind: short, text: prose.optional() }).strict();
const photo = z.object({ id: privateId, title: short, caption: prose, personIds: ids, sourceId: privateId, dataUrl: z.string().max(12 * 1024 * 1024).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/) }).strict();
const relationship = z.object({ id: privateId, from: privateId, to: privateId, label: short, status: short, sourceIds: ids, kind: z.enum(["parent_child", "partner", "other"]).optional(), parentRole: z.enum(["father", "mother", "parent"]).optional() }).strict().refine(value => !value.parentRole || value.kind === "parent_child");
export const researchSchema = z.object({ schemaVersion: z.literal(1), title: short.min(1), owner: z.object({ name: short.min(1), subtitle: short.optional(), personId: privateId.optional() }).strict(), summary: prose, people: z.array(person).max(300), relationships: z.array(relationship).max(800), sources: z.array(source).max(500), photos: z.array(photo).max(30), questions: z.array(z.object({ title: short, why: prose, nextStep: prose }).strict()).max(100) }).strict();
export type PrivateResearch = z.infer<typeof researchSchema>;
export type ResearchPerson = PrivateResearch["people"][number];
export type ResearchPhoto = PrivateResearch["photos"][number];

export function parseResearch(input: unknown): PrivateResearch {
  const parsed = researchSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_RESEARCH");
  const data = parsed.data;
  const unique = (items: Array<{ id: string }>) => { const set = new Set(items.map(x => x.id)); if (set.size !== items.length) throw new PrivateCaseError("INVALID_RESEARCH"); return set; };
  const people = unique(data.people), sources = unique(data.sources), photos = unique(data.photos); unique(data.relationships);
  const check = (references: string[], set: Set<string>) => { if (references.some(id => !set.has(id))) throw new PrivateCaseError("INVALID_RESEARCH"); };
  if (data.owner.personId) check([data.owner.personId], people);
  data.people.forEach(p => { check(p.sourceIds, sources); check(p.photoIds, photos); p.placeFacts?.forEach(f => check(f.sourceIds, sources)); });
  data.photos.forEach(p => { check(p.personIds, people); check([p.sourceId], sources); });
  data.relationships.forEach(r => { check([r.from, r.to], people); check(r.sourceIds, sources); });
  return data;
}
