# Shop — kanselyariya va oziq-ovqat: sayt + Telegram Mini App + MoySklad

MoySklad'dagi tovarlar (narx, qoldiq, rasm) sayt va Telegram Mini App'da ko'rinadi; buyurtmalar MoySklad'ga `customerorder` bo'lib tushadi. Statuslar MoySklad'da.
Arxitektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · MoySklad API faktlari: [docs/moysklad-api-notes.md](docs/moysklad-api-notes.md) · **holat va qolgan ishlar: [docs/STATUS.md](docs/STATUS.md)** · joylash: [docs/DEPLOY.md](docs/DEPLOY.md)

## Faqat uchta narsa kerak (kod o'zgarmaydi, faqat sozlama)
| # | Nima | Qayerga |
|---|---|---|
| 1 | **MoySklad tokeni** (alohida xodim; mahsulot, qoldiq, buyurtma, kontragent ruxsatlari) | `MOYSKLAD_TOKEN` (+ `MOYSKLAD_BASE_URL` ni asl manzilga) |
| 2 | **Telegram bot tokeni va username** (BotFather) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, so'ng `pnpm telegram:setup` |
| 3 | **Domen** (https) | `PUBLIC_URL` (+ Caddy: `DOMAIN`) |

Narx turi, omborlar, tashkilot, buyurtma statuslari, brend maydoni — hammasi kodda emas, **/admin → Настройки** da MoySklad ro'yxatidan tanlanadi.
Token kelgach avval faqat o'qiydigan tekshiruv: `pnpm probe` (hech narsa yozmaydi; narx turlari, omborlar, soat zonasi, rasm havolalari, webhook imkoniyatini chiqaradi).

## Lokal ishga tushirish
```bash
corepack enable && pnpm install
pnpm stores:up                 # Postgres + Redis (Docker)
cp .env.example .env           # MEDIA_DIR ni absolyut yo'l qiling; demo uchun pastdagi qiymatlar
pnpm dev                       # mock MoySklad :4010, api :4000, worker, web :3000
```
Demo uchun `.env`: `MOYSKLAD_BASE_URL=http://localhost:4010/api/remap/1.2`, `MOYSKLAD_TOKEN=demo-token`, `TMA_DEV_MODE=true`, `ADMIN_EMAIL/ADMIN_PASSWORD`.
Mock MoySklad boshqaruv sahifasi: http://localhost:4010/__mock (narx, qoldiq, buyurtma holatini "MoySklad'da" o'zgartirish).

## Tekshiruvlar
```bash
pnpm check                     # typecheck + lint + testlar (Postgres va Redis kerak)
node scripts/smoke.mjs         # haqiqiy Chrome'da: sayt → buyurtma → MoySklad → admin → Mini App (stek ishlab turishi kerak)
```
