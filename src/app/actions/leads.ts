"use server";

import { z } from "zod";
import { db } from "@/db";
import { leads, notifications } from "@/db/schema";
import { rateLimit, recordAudit, requestMeta } from "@/lib/auth";
import { ensureSeed } from "@/db/seed";

const leadSchema = z.object({
  name: z.string().min(2, "Please share your name"),
  email: z.string().email("Enter a valid email address"),
  company: z.string().optional(),
  phone: z.string().optional(),
  projectType: z.string().min(2),
  idea: z.string().min(20, "Give us at least a couple of sentences"),
  timeline: z.string().min(2),
  budget: z.string().min(2),
});

export type LeadState = {
  ok?: boolean;
  step?: number;
  error?: string;
  reference?: string;
} | null;

const SCORING: Record<string, number> = {
  "asap": 25,
  "1-3-months": 20,
  "3-6-months": 12,
  flexible: 6,
  "150k+": 30,
  "75k-150k": 24,
  "25k-75k": 16,
  undecided: 5,
};

export async function submitProjectAction(_prev: LeadState, formData: FormData): Promise<LeadState> {
  await ensureSeed();

  const parsed = leadSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    company: String(formData.get("company") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    projectType: String(formData.get("projectType") ?? ""),
    idea: String(formData.get("idea") ?? "").trim(),
    timeline: String(formData.get("timeline") ?? ""),
    budget: String(formData.get("budget") ?? ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please review the form" };
  }

  const { ip, userAgent } = await requestMeta();
  if (!rateLimit(`lead:${ip}`, 5, 10 * 60_000)) {
    return { error: "You've submitted several ideas recently. Email hello@sevayo.dev and we'll pick it up immediately." };
  }

  const score = (SCORING[parsed.data.timeline] ?? 8) + (SCORING[parsed.data.budget] ?? 8);

  const inserted = await db
    .insert(leads)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company || null,
      phone: parsed.data.phone || null,
      projectType: parsed.data.projectType,
      idea: parsed.data.idea,
      timeline: parsed.data.timeline,
      budget: parsed.data.budget,
      source: "website-wizard",
      status: "new",
      score,
    })
    .returning();

  await db.insert(notifications).values({
    audience: "admin",
    title: `New project brief: ${parsed.data.company || parsed.data.name}`,
    body: `${parsed.data.projectType} · ${parsed.data.timeline} · ${parsed.data.budget}`,
    kind: "lead",
    href: "/admin/leads",
  });

  await recordAudit({
    action: "lead.created",
    entity: "lead",
    entityId: inserted[0].id,
    meta: { projectType: parsed.data.projectType, score },
  });
  void userAgent;

  return { ok: true, reference: inserted[0].id.slice(0, 8).toUpperCase() };
}
