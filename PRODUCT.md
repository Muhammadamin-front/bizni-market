# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Chosen and approved in `docs/ARCHITECTURE.md` (2026-11-07): TypeScript monorepo, Next.js (App Router) for the website, the Telegram Mini App (`/tma`) and the admin (`/admin`), Tailwind CSS, a Fastify API, a BullMQ worker, PostgreSQL, Redis. The Mini App is mobile web inside Telegram, so the platform is `web`.

## Users
**Primary: ordinary people (retail customers) in Uzbekistan** who shop for stationery and everyday groceries and want to order from the owner's two physical shops through a website or in Telegram. Most arrive on a phone, many from inside Telegram. They choose Uzbek or Russian. They are not professional buyers: they do not know SKU codes or pack structures and judge a shop by whether prices and availability look right.

**Secondary: the shop owner and staff.** They manage the whole range, prices, stock, images and descriptions in MoySklad, and use the admin only to watch synchronisation, handle orders, and manage banners and featured products.

## Product Purpose
Let the owner's two existing shops (a stationery shop and a grocery shop) sell their real, current range online. Customers browse, search, fill one cart and place an order; the order lands in MoySklad as a customer order for staff to fulfil. Success is a customer finding an item that is truly in stock at the shown price, ordering it in a few taps, and the shop receiving a clean order without double entry.

## Positioning
**Live stock and live prices.** Every price and availability number on the site and in the Mini App is the number in MoySklad, kept in sync automatically, so a customer can trust what they see is on the shelf now. A neighbouring shop that keeps its online catalog by hand could not truthfully claim this.

## Operating Context
- MoySklad is the back office and the single source of truth for products, categories, prices, stock, images and descriptions. The platform never edits product data; it reads it and writes orders back.
- Two merchandise segments under one roof: **kanselyariya (stationery)** and **oziq-ovqat (grocery)**, one cart, one order.
- Interface in **Uzbek (Latin script) and Russian**; currency **UZS** (so'm / сум). Product names and descriptions come from MoySklad in a single language (currently transliterated Latin), so they are not translated.
- Surfaces: responsive website, Telegram Mini App with a native-feeling bottom-tab shell, and an admin panel.
- Orders: guest checkout by name, phone and delivery address on the website; Telegram-identified users in the Mini App. Order statuses are the MoySklad order states.

## Capabilities and Constraints
- Catalog with categories, brand filter, price and availability filters, sorting, instant search suggestions, product detail with gallery and related products, cart, checkout, order history and status (Mini App), favourites (Mini App).
- Must work equally on mobile and desktop, load fast, and be SEO-friendly.
- MoySklad API credentials never reach the frontend; all MoySklad traffic goes through the backend. Product images are copied to our own storage.
- Open facts, decided later from the real account (see `docs/ARCHITECTURE.md` §12): MoySklad tariff (webhooks), where brand lives, exact price type and warehouses, product and image counts, whether prices are public.
- Product names are transliterated Latin while users may type Cyrillic; search must handle both.

## Brand Commitments
- **No brand name, logo or brand colours exist yet.** Use the neutral working name "Shop" and a swappable wordmark slot; keep the accent colour a placeholder that can change in one token. Do not invent a name or logo.
- Binding from the brief: take structural inspiration from mirl.uz (catalog structure, brand presentation, product presentation) but do not clone it, and avoid generic AI-dashboard looks, excessive gradients, unnecessary animation, oversized rounded cards and cluttered layouts.

## Evidence on Hand
- Real product data is not available yet (arrives from MoySklad). No photography, testimonials, customer counts, shop addresses, opening hours or delivery rules have been provided; none may be fabricated.
- Reference screenshots of mirl.uz (home and catalog) captured 2026-11-07 live only in the session scratchpad, not in the repo; they are inspiration, not content.
- `docs/ARCHITECTURE.md` and `docs/moysklad-api-notes.md` hold the verified technical facts.

## Product Principles
1. **MoySklad is the truth.** Show only what MoySklad says; never invent or hand-edit a product, price or stock figure. Say plainly when something is out of stock.
2. **Two shops, one basket.** Stationery and grocery browse, search and check out together; the category structure helps people move between them.
3. **Phone first, Telegram native.** Design for a thumb on a small screen first; the website and the Mini App share one set of patterns so a customer never relearns the shop.
4. **Ordering must feel safe and quick.** Honest availability, visible totals, guest checkout in few fields, and clear confirmation.
5. **Uzbek and Russian are equals.** Both languages get the full interface from day one, with text that fits in either.

## Accessibility & Inclusion
Target WCAG AA contrast, visible keyboard focus and 44 px touch targets on mobile (adopted in the architecture plan, not an owner-stated requirement). Interface text must fit both Uzbek and Russian, which run longer than English, and the Mini App must follow Telegram's light and dark themes.
