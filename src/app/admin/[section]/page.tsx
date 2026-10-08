import { notFound, redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsEvents,
  auditLogs,
  brandAssets,
  brandingEvents,
  brandingSettings,
  cmsSections,
  leads,
  mediaAssets,
  portfolioProjects,
  projects,
  services,
  siteSettings,
  users,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getSiteConfig, DEFAULT_SITE_CONFIG } from "@/lib/content";
import { resolveBrand } from "@/lib/branding";
import {
  AdminBranding,
  AdminContent,
  AdminLeads,
  AdminMedia,
  AdminProjects,
  AdminAudit,
  AdminUsers,
  type AdminData,
} from "@/components/admin/AdminViews";

export const dynamic = "force-dynamic";

const SECTIONS = ["leads", "projects", "content", "branding", "media", "users", "audit"] as const;
type SectionKey = (typeof SECTIONS)[number];

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!SECTIONS.includes(section as SectionKey)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/portal");

  const brand = await resolveBrand();
  const shared = {
    user: { name: user.name, email: user.email, role: user.role },
    brand: {
      logoUrl: brand.logoUrl,
      iconUrl: brand.iconUrl,
      accent: brand.accent,
      accent2: brand.accent2,
      mode: brand.mode,
      version: brand.version,
      eventName: brand.event?.name ?? null,
      tagline: brand.tagline,
    },
  };

  if (section === "leads") {
    const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));
    return (
      <AdminLeads
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          projects: [],
          sections: [],
          services: [],
          portfolio: [],
          media: [],
          users: [],
          audit: [],
          branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
          site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
          leads: rows.map((lead) => ({
            id: lead.id,
            name: lead.name,
            email: lead.email,
            company: lead.company,
            projectType: lead.projectType,
            idea: lead.idea,
            timeline: lead.timeline,
            budget: lead.budget,
            status: lead.status,
            score: lead.score,
          })),
        }}
      />
    );
  }

  if (section === "projects") {
    const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
    return (
      <AdminProjects
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          leads: [],
          sections: [],
          services: [],
          portfolio: [],
          media: [],
          users: [],
          audit: [],
          branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
          site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
          projects: rows.map((project) => ({
            id: project.id,
            name: project.name,
            stage: project.stage,
            status: project.status,
            progress: project.progress,
            health: project.health,
          })),
        }}
      />
    );
  }

  if (section === "content") {
    const [sectionRows, serviceRows, portfolioRows, siteRows] = await Promise.all([
      db.select().from(cmsSections).orderBy(cmsSections.pageKey, cmsSections.sortOrder),
      db.select().from(services).orderBy(services.sortOrder),
      db.select().from(portfolioProjects).orderBy(portfolioProjects.sortOrder),
      getSiteConfig(),
    ]);

    return (
      <AdminContent
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          leads: [],
          projects: [],
          media: [],
          users: [],
          audit: [],
          branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
          sections: sectionRows.map((row) => ({
            id: row.id,
            pageKey: row.pageKey,
            sectionKey: row.sectionKey,
            eyebrow: row.eyebrow ?? "",
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
          })),
          services: serviceRows.map((row) => ({
            id: row.id,
            title: row.title,
            tagline: row.tagline,
            description: row.description,
            accent: row.accent,
            published: row.published,
          })),
          portfolio: portfolioRows.map((row) => ({
            id: row.id,
            title: row.title,
            summary: row.summary,
            category: row.category,
            published: row.published,
          })),
          site: {
            company: siteRows.company,
            social: siteRows.social,
            nav: siteRows.nav,
            seo: siteRows.seo,
          },
        }}
      />
    );
  }

  if (section === "branding") {
    const [assetRows, eventRows, settingsRows] = await Promise.all([
      db.select().from(brandAssets).orderBy(desc(brandAssets.createdAt)),
      db.select().from(brandingEvents).orderBy(desc(brandingEvents.priority)),
      db.select().from(brandingSettings).limit(1),
    ]);
    const defaultLogo = assetRows.find((asset) => asset.id === settingsRows[0]?.defaultLogoId);

    return (
      <AdminBranding
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          leads: [],
          projects: [],
          sections: [],
          services: [],
          portfolio: [],
          media: [],
          users: [],
          audit: [],
          site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
          branding: {
            assets: assetRows.map((asset) => ({
              id: asset.id,
              name: asset.name,
              type: asset.type,
              fileUrl: asset.fileUrl,
              variant: asset.variant,
              context: asset.context,
            })),
            events: eventRows.map((event) => ({
              id: event.id,
              name: event.name,
              kind: event.kind,
              status: event.status,
              priority: event.priority,
              startAt: event.startAt.toISOString(),
              endAt: event.endAt.toISOString(),
              timezone: event.timezone,
              accentColor: event.accentColor,
              announcement: event.announcement,
              heroTitle: event.heroTitle,
              heroSubtitle: event.heroSubtitle,
              particles: event.particles,
              logoUrl: assetRows.find((asset) => asset.id === event.logoAssetId)?.fileUrl ?? null,
            })),
            settings: {
              mode: settingsRows[0]?.mode ?? "auto",
              version: settingsRows[0]?.version ?? 1,
              defaultLogoUrl: defaultLogo?.fileUrl ?? null,
              tagline: settingsRows[0]?.tagline ?? brand.tagline,
            },
          },
        }}
      />
    );
  }

  if (section === "media") {
    const rows = await db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt)).limit(60);
    return (
      <AdminMedia
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          leads: [],
          projects: [],
          sections: [],
          services: [],
          portfolio: [],
          users: [],
          audit: [],
          branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
          site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
          media: rows.map((asset) => ({
            id: asset.id,
            name: asset.name,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            createdAt: asset.createdAt.toISOString(),
          })),
        }}
      />
    );
  }

  if (section === "users") {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return (
      <AdminUsers
        data={{
          ...shared,
          stats: [],
          analytics: [],
          popular: [],
          leads: [],
          projects: [],
          sections: [],
          services: [],
          portfolio: [],
          media: [],
          audit: [],
          branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
          site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
          users: rows.map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          })),
        }}
      />
    );
  }

  const [auditRows, eventRows] = await Promise.all([
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40),
    db
      .select({ name: analyticsEvents.name, count: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .groupBy(analyticsEvents.name),
  ]);

  return (
    <AdminAudit
      data={{
        ...shared,
        stats: [],
        popular: [],
        leads: [],
        projects: [],
        sections: [],
        services: [],
        portfolio: [],
        media: [],
        users: [],
        branding: { assets: [], events: [], settings: { mode: brand.mode, version: brand.version, defaultLogoUrl: null, tagline: brand.tagline } },
        site: { company: DEFAULT_SITE_CONFIG.company, social: [], nav: [], seo: DEFAULT_SITE_CONFIG.seo },
        audit: auditRows.map((row) => ({
          id: row.id,
          actorLabel: row.actorLabel,
          action: row.action,
          entity: row.entity,
          createdAt: row.createdAt.toISOString(),
          ip: row.ip,
        })),
        analytics: eventRows.map((row) => ({ name: row.name, count: Number(row.count) })),
      }}
    />
  );
}
