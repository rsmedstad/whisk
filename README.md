# Whisk

A personal recipe manager that works like a native app on your phone. Manage recipes, plan meals, build shopping lists, and use AI to discover new dishes — all from a fast, offline-capable PWA you fully own and control.

Free to host on Cloudflare's free tier. No coding required.

---

**Contents:** [Features](#features) · [Tech Stack](#tech-stack) · [Self-Hosting](#self-hosting-guide) · [AI Setup](#ai-features) · [Household Sharing](#sharing-with-your-household) · [Updates](#updating-your-app) · [Development](#local-development) · [License](#license)

---

## Features

### Recipes
- Import from URL, Google Sheets, CSV, photos, or paste from anywhere
- Full-text search, tags, favorites, and category browsing
- Cook mode with step-by-step view, wake lock, text-to-speech, and timers

### Meal Planning
- Weekly calendar with configurable meal slots (breakfast, lunch, dinner, snack, dessert, extra)
- Quick-fill with smart suggestions or plan conversationally via the AI assistant

### Shopping Lists
- Auto-generate from meal plans or build manually
- Scan handwritten lists with your camera
- Categorized by aisle

### AI Assistant
- Recipe suggestions, substitutions, cooking tips, and meal planning
- Streams responses in real time with tappable recipe cards
- Multi-provider: Groq, Gemini, OpenAI, Anthropic, Cerebras, xAI

### Discover Feed
- Browse trending recipes from configurable sources (add any recipe site)
- Auto-detects site framework (Next.js, Dotdash Meredith) for optimized scraping
- AI-tagged by cuisine, diet, and cook time

### More
- Photo recognition — snap a dish, get the recipe
- Multi-user household sharing with simple password auth
- Offline-first — works without internet, syncs in background
- 11 seasonal accent themes that auto-switch for holidays
- PWA — install to your home screen for a native app feel

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4 |
| Backend | Cloudflare Pages Functions (serverless, file-based routing) |
| Storage | Cloudflare KV (data) + R2 (photos) |
| Search | Cloudflare Vectorize + Workers AI (semantic recipe search) |
| AI | Groq (recommended), Gemini, Cerebras, OpenAI, Anthropic, xAI |

---

## Self-Hosting Guide

Whisk is fully self-hostable — no code changes needed. Fork the repository, follow the setup guide below, and deploy to your own Cloudflare Pages project.

### What You'll Need

- A **GitHub account** (free) — [github.com/join](https://github.com/join)
- A **Cloudflare account** (free) — [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
- A **Groq account** (free, for AI features) — [console.groq.com](https://console.groq.com) *(recommended)*
- About **15-20 minutes** for the initial setup

No credit card is required for any of the above.

### Step 1: Fork the Repository

1. Go to [github.com/rsmedstad/whisk](https://github.com/rsmedstad/whisk)
2. Click **Fork** > **Create fork**
3. Note your fork URL: `github.com/YOUR-USERNAME/whisk`

### Step 2: Choose an App Password

Pick a password for your recipe app (not your GitHub or Cloudflare password). This is what you and your household will use to log in.

### Step 3: Get a Groq API Key

1. Go to [console.groq.com](https://console.groq.com) and sign up (free, no credit card)
2. Click **API Keys** > **Create API Key**
3. Copy the key (starts with `gsk_`)

### Step 4: Create Cloudflare Storage

1. In the Cloudflare dashboard, go to **Storage & Databases** > **KV** > create a namespace called `whisk-data`
2. Go to **R2 Object Storage** > create a bucket called `whisk-photos`

### Step 5: Deploy to Cloudflare Pages

1. Go to **Workers & Pages** > **Create** > **Pages** > **Connect to Git**
2. Select your `whisk` fork
3. Configure the build:
   - **Build command**: `bun install && bun run build`
   - **Build output directory**: `dist`
4. Add environment variables:

| Variable | Value |
|----------|-------|
| `NODE_VERSION` | `20` |
| `APP_SECRET` | your app password |
| `GROQ_API_KEY` | your Groq API key |

5. Click **Save and Deploy**

### Step 6: Connect Storage

1. Go to your Pages project > **Settings** > **Bindings**
2. Add **KV namespace**: variable `WHISK_KV` → select `whisk-data`
3. Add **R2 bucket**: variable `WHISK_R2` → select `whisk-photos`
4. Go to **Deployments** > retry the latest deployment

### Step 7: Log In

Open `https://your-project.pages.dev`, tap **Join an Existing Book**, enter your name and password.

**Add to home screen** for a native app experience:
- **iPhone**: Safari > Share > Add to Home Screen
- **Android**: Chrome > Menu > Install App

---

## AI Features

Groq is the recommended AI provider — free, fast, and supports both text and photo recognition. Configure your provider in **Settings > AI**.

### Other Providers

Add API keys in Cloudflare (**Workers & Pages** > your project > **Settings** > **Variables and Secrets**):

| Variable | Provider | Free? |
|----------|----------|-------|
| `GROQ_API_KEY` | **Groq (recommended)** | Yes |
| `CEREBRAS_API_KEY` | Cerebras | $5/mo credit |
| `OPENAI_API_KEY` | OpenAI | Paid |
| `GEMINI_API_KEY` | Google Gemini | Yes |
| `ANTHROPIC_API_KEY` | Anthropic | Paid |
| `XAI_API_KEY` | xAI Grok | Paid |

### Optional: Browser Rendering

Some recipe sites block direct access. Browser Rendering uses a headless browser as a fallback.

1. Find your **Account ID** in the Cloudflare dashboard URL
2. Create an API token: **My Profile** > **API Tokens** > **Custom token** with **Browser Rendering: Edit** permission
3. Add both as environment variables:

| Variable | Value |
|----------|-------|
| `CF_ACCOUNT_ID` | your Cloudflare account ID |
| `CF_BR_TOKEN` | the API token |

Check status in **Settings > AI > Browser Rendering**.

### Optional: Instagram Import

Import recipes from Instagram post captions using Apify.

1. Create a free account at [apify.com](https://apify.com) (includes $5/month credit)
2. Copy your API token from **Settings** > **Integrations**
3. Add as `APIFY_API_TOKEN` in Cloudflare environment variables

---

## Sharing With Your Household

Share your app URL and password with family members. Each person picks their own display name. The first person to log in becomes the owner and can manage members in **Settings > Account**.

---

## Updating Your App

1. Go to your fork on GitHub
2. Click **Sync fork** > **Update branch**
3. Cloudflare automatically rebuilds (1-2 minutes)

---

## Changing Your App Password

Update `APP_SECRET` in Cloudflare (**Workers & Pages** > your project > **Settings** > **Variables and Secrets**), then retry deployment. All members will need to log in again.

---

## Local Development

```bash
bun install          # Install dependencies
bun run dev          # Start dev server on :5173
bun run build        # TypeScript check + production build
```

Create a `.dev.vars` file:

```
APP_SECRET=your-password
GROQ_API_KEY=your-key-here
```

---

## Support

If you find Whisk useful, consider making a donation to the [American Diabetes Association](https://diabetes.org/ways-to-contribute). This project is dedicated to the memory of a loved one.

## Issues & Feedback

Bug reports and suggestions are welcome — please [open an issue](https://github.com/rsmedstad/whisk/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for code contribution guidelines.

## License

[AGPL-3.0](LICENSE) — free to self-host, modify, and share. Modified versions deployed as a network service must make source code available under the same license.
