# Whisk

A personal recipe manager that works like a native app on your phone. Manage recipes, plan meals, build shopping lists, and use AI to suggest recipes, identify dishes from photos, and scan handwritten lists.

Whisk is free to host on Cloudflare's free tier. No coding required to set up.

---

## What You'll Need

Before starting, grab a notepad (or open a notes app). You'll collect a few pieces of information during setup that you'll need at the end.

- A **GitHub account** (free) — [github.com/join](https://github.com/join)
- A **Cloudflare account** (free) — [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
- A **Groq account** (free, for AI features) — [console.groq.com](https://console.groq.com) *(strongly recommended)*
- About **15-20 minutes** for the initial setup

No credit card is required for any of the above.

---

## Setup Guide

### Step 1: Copy the Whisk Code to Your GitHub

1. Make sure you're logged in to GitHub
2. Go to [github.com/rsmedstad/whisk](https://github.com/rsmedstad/whisk)
3. Click the **Fork** button in the top-right corner
4. On the next screen, leave everything as-is and click **Create fork**
5. Wait a few seconds — you now have your own copy of Whisk

Write down your fork URL. It will look like: `github.com/YOUR-USERNAME/whisk`

### Step 2: Choose a Password for Your App

Pick a password that you (and anyone in your household) will use to log in to Whisk. This is NOT your GitHub or Cloudflare password — it's a separate password just for your recipe app.

Write it down: **App Password**: _______________

### Step 3: Get Your Groq API Key (for AI Features)

Groq is the recommended AI provider for Whisk — it's free, fast, and supports both text chat and photo recognition. Other providers work too, but Groq has the best free tier and is the most tested.

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up with your email or GitHub account (no credit card needed)
3. Once logged in, click **API Keys** in the left sidebar
4. Click **Create API Key**, give it a name like "whisk"
5. Copy the key (it starts with `gsk_`) — you won't be able to see it again

Write it down: **Groq API Key**: _______________

### Step 4: Create Your Cloudflare Account

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Enter your email and choose a password
3. Verify your email if prompted
4. You should now see the Cloudflare dashboard

### Step 5: Create Storage for Your Recipes (KV)

Cloudflare KV is where your recipes, shopping lists, and meal plans are stored. Think of it as your app's database.

1. In the Cloudflare dashboard sidebar, click **Storage & Databases** > **KV**
2. Click **Create a namespace**
3. For the name, type `whisk-data`
4. Click **Add**

That's it — you'll connect this to your app in a later step.

### Step 6: Create Storage for Your Photos (R2)

R2 is where recipe photos are stored. Think of it like a photo album in the cloud.

1. In the sidebar, click **R2 Object Storage** > **Overview**
2. Click **Create bucket**
3. For the bucket name, type `whisk-photos`
4. Leave location on **Automatic**
5. Click **Create bucket**

### Step 7: Connect Your Fork to Cloudflare Pages

This tells Cloudflare to build and host your app whenever you update it.

1. In the sidebar, click **Workers & Pages**
2. Click **Create**
3. Select the **Pages** tab
4. Click **Connect to Git**
5. If this is your first time, you'll be asked to connect your GitHub account — click **Connect GitHub** and authorize Cloudflare to access your repositories
6. Find and select your `whisk` fork from the list
7. Click **Begin setup**

Now configure the build:

8. **Project name**: Leave as `whisk` (or change it — this becomes your URL: `project-name.pages.dev`)
9. **Production branch**: `main`
10. **Framework preset**: Leave as `None`
11. **Build command**: `bun install && bun run build`
12. **Build output directory**: `dist`
13. Expand the **Environment variables** section
14. Add these three variables (click **Add variable** for each):

| Variable name | Value |
|---|---|
| `NODE_VERSION` | `20` |
| `APP_SECRET` | the app password from Step 2 |
| `GROQ_API_KEY` | the Groq API key from Step 3 |

15. Click **Save and Deploy**

The first build may take 1-2 minutes. It might fail — that's OK! We still need to connect the storage.

Write down your project URL. It will look like: `your-project-name.pages.dev`

### Step 8: Connect Storage to Your App

This step tells your app where to find its database and photo storage.

1. Go to **Workers & Pages** > click on your Whisk project name
2. Click the **Settings** tab
3. In the left sidebar, click **Bindings**
4. Click **Add**
5. Select **KV namespace**:
   - Variable name: `WHISK_KV`
   - KV namespace: select `whisk-data` from the dropdown
   - Click **Save**
6. Click **Add** again
7. Select **R2 bucket**:
   - Variable name: `WHISK_R2`
   - R2 bucket: select `whisk-photos` from the dropdown
   - Click **Save**

### Step 9: Trigger a Fresh Deploy

Now that storage is connected, let's rebuild:

1. Go to **Workers & Pages** > your Whisk project
2. Click the **Deployments** tab
3. Find the most recent deployment and click the **...** menu on the right
4. Click **Retry deployment**
5. Wait 1-2 minutes for the build to complete
6. Once it shows **Success**, your app is live!

### Step 10: Open Your App and Log In

1. Open your browser and go to `https://your-project-name.pages.dev` (the URL from Step 7)
2. Tap **Join an Existing Book**
3. Enter your display name (your first name is fine) and the app password from Step 2
4. You're in! Start adding recipes.

**Add to your home screen** for a native app experience:
- **iPhone**: Open in Safari > tap the Share button > **Add to Home Screen**
- **Android**: Open in Chrome > tap the menu > **Add to Home Screen** or **Install App**

---

## AI Features

AI features let Whisk suggest recipes based on what you have, identify dishes from photos, and scan handwritten shopping lists. You can configure your AI provider in the app at **Settings > AI Model Configuration**.

### Why Groq?

**Groq is strongly recommended** as the primary AI provider. It's the most tested with Whisk and offers:
- Free tier with no credit card required
- Very fast response times (under 1 second for most queries)
- Both text and photo recognition support
- Generous daily usage limits

If you followed the setup guide above, Groq is already configured. The app will auto-detect it and set it as your default provider.

Other providers (Gemini, OpenAI, Anthropic, Cerebras, xAI) are supported but may have untested edge cases. If you want to experiment, you can add multiple providers and switch between them in Settings.

### Other Providers

To add another provider, go to **Workers & Pages** > your project > **Settings** > **Variables and Secrets**, add the API key as a new variable, then retry your deployment.

| Variable | Provider | Free? | Sign up |
|---|---|---|---|
| `GROQ_API_KEY` | **Groq (recommended)** | Yes | [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | Google Gemini | Yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `CEREBRAS_API_KEY` | Cerebras | $5/mo credit | [cloud.cerebras.ai](https://cloud.cerebras.ai/) |
| `OPENAI_API_KEY` | OpenAI | Paid | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | Anthropic | Paid | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `XAI_API_KEY` | xAI Grok | Paid | [console.x.ai](https://console.x.ai/) |

### Optional: Instagram Recipe Import

This lets you paste an Instagram post URL and automatically extract the recipe from the caption.

1. Go to [apify.com](https://apify.com) and create a free account (includes $5/month credit)
2. Go to **Settings** > **Integrations**
3. Copy your **Personal API token**
4. Add it as `APIFY_API_TOKEN` in Cloudflare (**Workers & Pages** > your project > **Settings** > **Variables and Secrets**)
5. Retry deployment

---

## Sharing With Your Household

Whisk uses a shared password — anyone with the password can access the same recipe book. Share your app URL and password with family members. Each person picks their own display name when they first log in.

### Managing Members

The first person to log in becomes the **owner**. In **Settings > Account**, the owner can:
- See all household members and when they joined
- **Remove members** — this immediately logs them out (their sessions are revoked)
- Transfer ownership to another member

If you shared access with someone temporarily (like a friend trying the app), just remove them in Settings. They'll be logged out right away and won't be able to access your recipes. You can also change your `APP_SECRET` in Cloudflare for extra security, but it's not required — removing them is enough.

---

## Updating Your App

When new features or bug fixes are released, you can update in under a minute.

### From GitHub (Recommended)

1. Go to your fork on GitHub (e.g., `github.com/YOUR-USERNAME/whisk`)
2. Near the top, you'll see a message like **"This branch is X commits behind rsmedstad:main"**
3. Click **Sync fork**
4. Click **Update branch**
5. Done! Cloudflare will automatically rebuild your app (takes 1-2 minutes)

If you don't see the "Sync fork" banner, your fork is already up to date.

### Automatic Cache Updates

Whisk automatically detects new deployments and refreshes itself. If you ever need to force it, go to **Settings** > **Data** > **Clear Cache & Reload**.

### From the Command Line (Advanced)

```bash
# One-time: add the original repo as "upstream"
git remote add upstream https://github.com/rsmedstad/whisk.git

# To update:
git fetch upstream
git merge upstream/main
git push
```

---

## Changing Your App Password

If you need to change your app password (for example, after removing a temporary member):

1. Go to the Cloudflare dashboard
2. Navigate to **Workers & Pages** > your Whisk project > **Settings** > **Variables and Secrets**
3. Find `APP_SECRET` and update its value
4. Go to **Deployments** > latest > **...** > **Retry deployment**
5. After the deploy completes, all members will need to log in again with the new password

---

## Local Development

For developers who want to modify the code:

```bash
# Install Bun: https://bun.sh
bun install          # Install dependencies
bun run dev          # Start dev server on :5173
bun run build        # TypeScript check + production build
bun run deploy       # Build + deploy to Cloudflare Pages
```

Create a `.dev.vars` file for local environment variables:

```
APP_SECRET=test-password
GROQ_API_KEY=your-key-here
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4
- **Backend**: Cloudflare Pages Functions (serverless, file-based routing)
- **Storage**: Cloudflare KV (recipes, lists, plans) + R2 (photos)
- **AI**: Groq (recommended), Gemini, Cerebras, OpenAI, Anthropic, xAI (all optional)

## License

See [LICENSE](LICENSE) for details.
