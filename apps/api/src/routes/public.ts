import { brandList, categoryBySlug, categoryTree, contentMap, getProduct, homePayload, isDemoSource, listProducts, loadSettings, productsByIds, relatedProducts, sitemapEntries, suggest, type Runtime } from "@shop/core";
import { CatalogQuery, type PublicConfig } from "@shop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { limitBy } from "../guards";

const Locale = z.enum(["uz", "ru"]).default("uz");

export function publicRoutes(app: FastifyInstance, rt: Runtime) {
  app.get("/v1/config", async (_req, reply) => {
    const settings = await loadSettings(rt);
    const body: PublicConfig = {
      demo: isDemoSource(rt.env),
      turnstileSiteKey: rt.env.TURNSTILE_SITE_KEY || null,
      botUsername: rt.env.TELEGRAM_BOT_USERNAME || null,
      tmaDevMode: rt.env.TMA_DEV_MODE,
      minimumOrderAmount: settings.minimumOrderAmount,
      content: await contentMap(rt),
    };
    return reply.header("Cache-Control", "public, max-age=30").send(body);
  });

  app.get("/v1/home", async (req) => homePayload(rt, Locale.parse((req.query as { locale?: string }).locale)));

  app.get("/v1/categories", async (req) => {
    const q = req.query as { locale?: string; empty?: string };
    const { tree } = await categoryTree(rt, Locale.parse(q.locale), { includeEmpty: q.empty === "1" });
    return tree;
  });

  app.get("/v1/categories/:slug", async (req, reply) => {
    const found = await categoryBySlug(rt, (req.params as { slug: string }).slug, Locale.parse((req.query as { locale?: string }).locale));
    return found ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/v1/brands", async () => brandList(rt));

  app.get("/v1/catalog/products", async (req) => listProducts(rt, CatalogQuery.parse(req.query)));

  app.get("/v1/products/:slug", async (req, reply) => {
    const slug = z.string().min(1).max(200).parse((req.params as { slug: string }).slug);
    const found = await getProduct(rt, slug, Locale.parse((req.query as { locale?: string }).locale));
    if (!found) return reply.code(404).send({ error: "not_found" });
    if ("redirectTo" in found) return reply.code(200).send({ redirectTo: found.redirectTo });
    return found.product;
  });

  app.get("/v1/products/:id/related", async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    return relatedProducts(rt, id);
  });

  // Cart hydration: the browser keeps only ids and quantities, and asks for fresh prices and stock here.
  app.post("/v1/products/by-ids", async (req) => {
    const { ids } = z.object({ ids: z.array(z.uuid()).max(100) }).parse(req.body);
    return productsByIds(rt, ids);
  });

  app.get("/v1/search/suggest", { preHandler: limitBy(rt, "suggest", 120, 60) }, async (req) => {
    const { q, locale } = z.object({ q: z.string().max(100).default(""), locale: Locale }).parse(req.query);
    return suggest(rt, q, locale);
  });

  app.get("/v1/sitemap", async () => sitemapEntries(rt));
}
