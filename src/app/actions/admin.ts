"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  announcements,
  brandAssets,
  brandingAudit,
  brandingEvents,
  brandingSettings,
  cmsSections,
  leads,
  mediaAssets,
  portfolioProjects,
  services,
  siteSettings,
  users,
} from "@/db/schema";
import { assertPermission, hashPassword, rateLimit, recordAudit, requestMeta, type SessionUser } from "@/lib/auth";
import { invalidateBrandCache } from "@/lib/branding";

export type ActionState = { ok?: boolean; error?: string; message?: string } | null;

const ALLOWED_IMAGE = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];
const MAX_UPLOAD = 3 * 1024 * 1024;

/** SVG sanitiser — removes scripts, event handlers and external references. */
function sanitizeSvg(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<\s*i?frame[^>]*>/gi, "")
    .replace(/xlink:href\s*=\s*"(?!#)[^"]*"/gi, 'xlink:href="#"');
}

async function storeUpload(file: File, folder: string, actor: SessionUser | null) {
  if (!ALLOWED_IMAGE.includes(file.type)) throw new Error("Unsupported file type. Use PNG, JPEG, WEBP, GIF or SVG.");
  if (file.size > MAX_UPLOAD) throw new Error("File is larger than 3 MB.");

  const buffer = Buffer.from(await file.arrayBuffer());
  let data = buffer.toString("base64");
  if (file.type === "image/svg+xml") {
    const text = buffer.toString("utf8");
    if (/<script/i.test(text)) throw new Error("SVG contains a script tag and was rejected.");
    data = Buffer.from(sanitizeSvg(text)).toString("base64");
  }

  const inserted = await db
    .insert(mediaAssets)
    .values({
      name: file.name.slice(0, 120),
      mimeType: file.type,
      sizeBytes: file.size,
      data,
      folder,
      createdBy: actor?.id ?? null,
    })
    .returning();

  return inserted[0];
}

/* ------------------------------ CMS ------------------------------ */

export async function updateSectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("cms.manage");
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing section id" };

    await db
      .update(cmsSections)
      .set({
        eyebrow: String(formData.get("eyebrow") ?? ""),
        title: String(formData.get("title") ?? ""),
        subtitle: String(formData.get("subtitle") ?? ""),
        body: String(formData.get("body") ?? ""),
        updatedAt: new Date(),
      })
      .where(eq(cmsSections.id, id));

    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "cms.section.updated", entity: "cms_section", entityId: id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Section published." };
  } catch {
    return { error: "Could not save this section." };
  }
}

export async function updateSiteSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("settings.manage");
    const value = {
      company: {
        name: String(formData.get("companyName") ?? "SEVAYO"),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        address: String(formData.get("address") ?? ""),
        hours: String(formData.get("hours") ?? ""),
      },
      social: String(formData.get("social") ?? "")
        .split("\n")
        .map((line) => line.split("|").map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
        .map((parts) => ({ label: parts[0], href: parts[1] })),
      nav: String(formData.get("nav") ?? "")
        .split("\n")
        .map((line) => line.split("|").map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
        .map((parts) => ({ label: parts[0], href: parts[1] })),
      seo: {
        title: String(formData.get("seoTitle") ?? ""),
        description: String(formData.get("seoDescription") ?? ""),
        keywords: String(formData.get("seoKeywords") ?? ""),
        canonical: String(formData.get("canonical") ?? ""),
      },
    };

    const existing = await db.select().from(siteSettings).where(eq(siteSettings.key, "site")).limit(1);
    if (existing[0]) {
      await db.update(siteSettings).set({ value, updatedAt: new Date(), updatedBy: actor.id }).where(eq(siteSettings.id, existing[0].id));
    } else {
      await db.insert(siteSettings).values({ key: "site", value, updatedBy: actor.id });
    }

    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "settings.updated", entity: "site_settings" });
    revalidatePath("/", "layout");
    return { ok: true, message: "Site settings published." };
  } catch {
    return { error: "Could not save site settings." };
  }
}

/* ------------------------------ Services / portfolio ------------------------------ */

export async function updateServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("cms.manage");
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing service id" };
    await db
      .update(services)
      .set({
        title: String(formData.get("title") ?? ""),
        tagline: String(formData.get("tagline") ?? ""),
        description: String(formData.get("description") ?? ""),
        accent: String(formData.get("accent") ?? "#2e9bff"),
        published: formData.get("published") === "on",
        updatedAt: new Date(),
      })
      .where(eq(services.id, id));
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "service.updated", entity: "service", entityId: id });
    revalidatePath("/services");
    revalidatePath("/", "layout");
    return { ok: true, message: "Service updated." };
  } catch {
    return { error: "Could not update service." };
  }
}

export async function updateProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("cms.manage");
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing project id" };
    await db
      .update(portfolioProjects)
      .set({
        title: String(formData.get("title") ?? ""),
        summary: String(formData.get("summary") ?? ""),
        category: String(formData.get("category") ?? "Platform"),
        published: formData.get("published") === "on",
        updatedAt: new Date(),
      })
      .where(eq(portfolioProjects.id, id));
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "portfolio.updated", entity: "portfolio_project", entityId: id });
    revalidatePath("/work");
    return { ok: true, message: "Case study updated." };
  } catch {
    return { error: "Could not update case study." };
  }
}

/* ------------------------------ Branding ------------------------------ */

export async function uploadBrandAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("branding.manage");
    if (!rateLimit(`upload:${actor.id}`, 20, 60_000)) return { error: "Too many uploads. Wait a moment." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };

    const type = String(formData.get("type") ?? "logo");
    const name = String(formData.get("name") ?? file.name).slice(0, 120);

    const media = await storeUpload(file, "brand", actor);
    const fileUrl = `/api/media/${media.id}`;

    const inserted = await db
      .insert(brandAssets)
      .values({
        name,
        type,
        variant: String(formData.get("variant") ?? "dark"),
        context: String(formData.get("context") ?? "standard"),
        fileUrl,
        thumbnailUrl: fileUrl,
        metadata: { accent: String(formData.get("accent") ?? "#2e9bff"), mimeType: file.type },
        createdBy: actor.id,
      })
      .returning();

    void type;

    await db.insert(brandingAudit).values({
      actorId: actor.id,
      actorLabel: actor.email,
      action: "asset.uploaded",
      next: { id: inserted[0].id, name, type, fileUrl },
    });
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "brand.asset.uploaded", entity: "brand_asset", entityId: inserted[0].id });

    invalidateBrandCache();
    revalidatePath("/admin/branding");
    revalidatePath("/", "layout");
    return { ok: true, message: `${name} uploaded.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Upload failed." };
  }
}

export async function setBrandingModeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("branding.manage");
    const mode = String(formData.get("mode") ?? "auto");
    const activeLogoId = String(formData.get("activeLogoId") ?? "") || null;

    const before = (await db.select().from(brandingSettings).limit(1))[0];
    const current = before ?? (await db.insert(brandingSettings).values({}).returning())[0];

    await db
      .update(brandingSettings)
      .set({
        mode: mode === "manual" ? "manual" : "auto",
        activeLogoId: mode === "manual" ? activeLogoId : null,
        version: current.version + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(brandingSettings.id, current.id));

    await db.insert(brandingAudit).values({
      actorId: actor.id,
      actorLabel: actor.email,
      action: "branding.mode.changed",
      eventId: activeLogoId,
      previous: { mode: current.mode, activeLogoId: current.activeLogoId },
      next: { mode, activeLogoId },
    });
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "branding.mode.changed", entity: "branding_settings", meta: { mode } });

    invalidateBrandCache();
    revalidatePath("/", "layout");
    return { ok: true, message: mode === "manual" ? "Manual override active." : "Automatic branding restored." };
  } catch {
    return { error: "Could not change branding mode." };
  }
}

const eventSchema = z.object({
  name: z.string().min(2, "Event name is required"),
  kind: z.string().min(2),
  startAt: z.string().min(4, "Start date required"),
  endAt: z.string().min(4, "End date required"),
  timezone: z.string().min(2),
  priority: z.coerce.number().int().min(1).max(100),
  accentColor: z.string().optional(),
  announcement: z.string().optional(),
  heroTitle: z.string().optional(),
  heroSubtitle: z.string().optional(),
  particles: z.string().optional(),
});

export async function createBrandingEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("events.manage");
    const parsed = eventSchema.safeParse({
      name: String(formData.get("name") ?? ""),
      kind: String(formData.get("kind") ?? "custom"),
      startAt: String(formData.get("startAt") ?? ""),
      endAt: String(formData.get("endAt") ?? ""),
      timezone: String(formData.get("timezone") ?? "Asia/Kolkata"),
      priority: Number(formData.get("priority") ?? 10),
      accentColor: String(formData.get("accentColor") ?? "") || undefined,
      announcement: String(formData.get("announcement") ?? "") || undefined,
      heroTitle: String(formData.get("heroTitle") ?? "") || undefined,
      heroSubtitle: String(formData.get("heroSubtitle") ?? "") || undefined,
      particles: String(formData.get("particles") ?? "default"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid event" };

    const logoAssetId = String(formData.get("logoAssetId") ?? "") || null;
    const slugBase = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const inserted = await db
      .insert(brandingEvents)
      .values({
        name: parsed.data.name,
        slug: `${slugBase}-${Date.now().toString(36)}`,
        description: String(formData.get("description") ?? ""),
        kind: parsed.data.kind,
        logoAssetId,
        faviconAssetId: logoAssetId,
        accentColor: parsed.data.accentColor ?? null,
        announcement: parsed.data.announcement ?? null,
        heroTitle: parsed.data.heroTitle ?? null,
        heroSubtitle: parsed.data.heroSubtitle ?? null,
        particles: parsed.data.particles ?? "default",
        startAt: new Date(parsed.data.startAt),
        endAt: new Date(parsed.data.endAt),
        timezone: parsed.data.timezone,
        priority: parsed.data.priority,
        status: "scheduled",
        createdBy: actor.id,
      })
      .returning();

    await db.insert(brandingAudit).values({
      actorId: actor.id,
      actorLabel: actor.email,
      action: "event.created",
      eventId: inserted[0].id,
      next: { name: parsed.data.name, startAt: parsed.data.startAt, endAt: parsed.data.endAt },
    });
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "branding.event.created", entity: "branding_event", entityId: inserted[0].id });

    invalidateBrandCache();
    revalidatePath("/admin/branding");
    revalidatePath("/", "layout");
    return { ok: true, message: `${parsed.data.name} scheduled.` };
  } catch {
    return { error: "Could not create the event." };
  }
}

export async function setEventStatusAction(formData: FormData) {
  try {
    const actor = await assertPermission("events.manage");
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "scheduled");
    if (!id || !["draft", "scheduled", "active", "expired", "disabled"].includes(status)) return;

    await db.update(brandingEvents).set({ status, updatedAt: new Date() }).where(eq(brandingEvents.id, id));
    await db.insert(brandingAudit).values({
      actorId: actor.id,
      actorLabel: actor.email,
      action: "event.status",
      eventId: id,
      next: { status },
    });
    invalidateBrandCache();
    revalidatePath("/admin/branding");
    revalidatePath("/", "layout");
  } catch {
    /* ignored */
  }
}

export async function deleteBrandingEventAction(formData: FormData) {
  try {
    const actor = await assertPermission("events.manage");
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db.delete(brandingEvents).where(eq(brandingEvents.id, id));
    await db.insert(brandingAudit).values({ actorId: actor.id, actorLabel: actor.email, action: "event.deleted", eventId: id });
    invalidateBrandCache();
    revalidatePath("/admin/branding");
    revalidatePath("/", "layout");
  } catch {
    /* ignored */
  }
}

/* ------------------------------ Operations ------------------------------ */

export async function updateLeadAction(formData: FormData) {
  try {
    const actor = await assertPermission("leads.manage");
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "new");
    const notes = String(formData.get("notes") ?? "");
    if (!id) return;
    await db.update(leads).set({ status, notes }).where(eq(leads.id, id));
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "lead.updated", entity: "lead", entityId: id, meta: { status } });
    revalidatePath("/admin/leads");
  } catch {
    /* ignored */
  }
}

export async function createTeamUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("users.manage");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = String(formData.get("role") ?? "client");
    const password = String(formData.get("password") ?? "");
    if (!z.string().email().safeParse(email).success) return { error: "Enter a valid email" };
    if (password.length < 8) return { error: "Password must be at least 8 characters" };
    if (name.length < 2) return { error: "Name is too short" };

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) return { error: "That email already exists." };

    await db.insert(users).values({
      email,
      name,
      role: role === "admin" ? "admin" : "client",
      passwordHash: hashPassword(password),
      company: String(formData.get("company") ?? "") || null,
    });

    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "user.created", entity: "user", meta: { email, role } });
    revalidatePath("/admin/users");
    return { ok: true, message: `${name} added.` };
  } catch {
    return { error: "Could not create the user." };
  }
}

export async function setUserRoleAction(formData: FormData) {
  try {
    const actor = await assertPermission("users.manage");
    const id = String(formData.get("id") ?? "");
    const role = String(formData.get("role") ?? "client");
    if (!id || !["admin", "client"].includes(role)) return;
    if (id === actor.id) return;
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "user.role", entity: "user", entityId: id, meta: { role } });
    revalidatePath("/admin/users");
  } catch {
    /* ignored */
  }
}

export async function createAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("cms.manage");
    const message = String(formData.get("message") ?? "").trim();
    if (message.length < 6) return { error: "Message is too short" };
    await db.insert(announcements).values({
      message,
      href: String(formData.get("href") ?? "") || null,
      active: true,
    });
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "announcement.created", entity: "announcement" });
    invalidateBrandCache();
    revalidatePath("/", "layout");
    return { ok: true, message: "Announcement live." };
  } catch {
    return { error: "Could not publish the announcement." };
  }
}

export async function uploadMediaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission("media.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
    const media = await storeUpload(file, "library", actor);
    await recordAudit({ actorId: actor.id, actorLabel: actor.email, action: "media.uploaded", entity: "media", entityId: media.id });
    revalidatePath("/admin/media");
    return { ok: true, message: `${media.name} stored.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Upload failed." };
  }
}

export async function requestMetaInfo() {
  return requestMeta();
}
