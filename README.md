# Whisk

A personal recipe manager that works like a native app on your phone. Manage recipes, plan meals, build shopping lists, and optionally use AI to suggest recipes and identify dishes from photos.

Whisk is free to host on Cloudflare's free tier. No coding required to set up.

---

## What You'll Need

Before starting, grab a notepad (or open a notes app). You'll collect a few pieces of information during setup that you'll need at the end.

- A **GitHub account** (free) — [github.com/join](https://github.com/join)
- A **Cloudflare account** (free) — [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
- About **15-20 minutes** for the initial setup

No credit card is required for any of the free tiers mentioned below.

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

### Step 3: Create Your Cloudflare Account

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Enter your email and choose a password
3. Verify your email if prompted
4. You should now see the Cloudflare dashboard

### Step 4: Create Storage for Your Recipes (KV)

Cloudflare KV is where your recipes, shopping lists, and meal plans are stored. Think of it as your app's database.

1. In the Cloudflare dashboard sidebar, click **Storage & Databases** > **KV**
2. Click **Create a namespace**
3. For the name, type `whisk-data`
4. Click **Add**

That's it — you'll connect this to your app in a later step.

### Step 5: Create Storage for Your Photos (R2)

R2 is where recipe photos are stored. Think of it like a photo album in the cloud.

1. In the sidebar, click **R2 Object Storage** > **Overview**
2. Click **Create bucket**
3. For the bucket name, type `whisk-photos`
4. Leave location on **Automatic**
5. Click **Create bucket**

### Step 6: Connect Your Fork to Cloudflare Pages

This tells Cloudflare to build and host your app whenever you update it.

1. In the sidebar, click **Workers & Pages** > **Overview**
2. Click **Create**
3. Click the **Pages** tab at the top
4. Click **Connect to Git**
5. If this is your first time, click **Connect GitHub** and authorize Cloudflare to see your repositories
6. Find and select your `whisk` fork from the list
7. Click **Begin setup**

Now configure the build:

8. **Project name**: Leave as `whisk` (or change it — this becomes your URL: `project-name.pages.dev`)
9. **Production branch**: `main`
10. **Framework preset**: Leave as `None`
11. **Build command**: `bun install && bun run build`
12. **Build output directory**: `dist`
13. Click **Environment variables (advanced)** to expand that section
14. Click **Add variable**:
    - Variable name: `NODE_VERSION`
    - Value: `20`
15. Click **Add variable** again:
    - Variable name: `APP_SECRET`
    - Value: the app password you wrote down in Step 2
16. Click **Save and Deploy**

The first build may take 1-2 minutes. It might fail — that's OK! We still need to connect the storage.

Write down your project URL. It will look like: `your-project-name.pages.dev`

### Step 7: Connect Storage to Your App

This is the step that tells your app where to find its database and photo storage.

1. Go to **Workers & Pages** > click on your Whisk project name
2. Click the **Settings** tab at the top
3. In the left sidebar, click **Bindings**
4. Click **Add**
5. Select **KV namespace**:
   - Variable name: `KV`
   - KV namespace: select `whisk-data` from the dropdown
   - Click **Save**
6. Click **Add** again
7. Select **R2 bucket**:
   - Variable name: `R2`
   - R2 bucket: select `whisk-photos` from the dropdown
   - Click **Save**

Important: These bindings need to be set for Production. By default Cloudflare applies them to both Production and Preview, so you should be all set.

### Step 8: Trigger a Fresh Deploy

Now that storage is connected, let's rebuild:

1. Go to **Workers & Pages** > your Whisk project
2. Click the **Deployments** tab
3. Find the most recent deployment (at the top) and click the **...** menu on the right
4. Click **Retry deployment**
5. Wait 1-2 minutes for the build to complete
6. Once it says **Success**, your app is live!

### Step 9: Open Your App and Log In

1. Open your browser and go to `https://your-project-name.pages.dev` (the URL from Step 6)
2. Enter the app password from Step 2
3. Choose a display name (your first name is fine)
4. You're in! Add your first recipe.

**Tip**: On your phone, you can add Whisk to your home screen for a native app experience:
- **iPhone**: Open in Safari > tap the Share button > **Add to Home Screen**
- **Android**: Open in Chrome > tap the three-dot menu > **Add to Home Screen** or **Install App**

---

## Optional: Add AI Features

AI features let Whisk suggest recipes, identify dishes from photos, and intelligently parse imported recipe URLs. You only need **one** AI provider, and several have generous free tiers.

### Recommended Free Options

**Groq** (best free option — fast, supports text + photo recognition):
1. Go to [console.groq.com](https://console.groq.com) and sign up
2. Click **API Keys** in the sidebar
3. Click **Create API Key**, give it a name like "whisk"
4. Copy the key (it starts with `gsk_`)
5. In Cloudflare: **Workers & Pages** > your project > **Settings** > **Environment variables**
6. Click **Add variable**: name = `GROQ_API_KEY`, value = paste your key
7. Click **Save** > then **Retry deployment** (Deployments tab > latest > ... > Retry)

**Google Gemini** (also free, also supports photos):
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API key** and select any Google Cloud project (or create one)
3. Copy the key
4. Add it as `GEMINI_API_KEY` in Cloudflare environment variables (same process as Groq above)

### Other Providers (Paid)

| Variable | Provider | Sign up |
|---|---|---|
| `CEREBRAS_API_KEY` | Cerebras (free $5/mo credit) | [cloud.cerebras.ai](https://cloud.cerebras.ai/) |
| `OPENAI_API_KEY` | OpenAI (paid) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ANTHROPIC_API_KEY` | Anthropic (paid) | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `XAI_API_KEY` | xAI Grok (paid) | [console.x.ai](https://console.x.ai/) |

You can add multiple providers. The app auto-detects which are available and you can configure which provider to use for each feature in **Settings > AI Model Configuration**.

### Optional: Instagram Recipe Import

This lets you paste an Instagram post URL and automatically extract the recipe from the caption.

1. Go to [apify.com](https://apify.com) and create a free account (includes $5/month credit)
2. Go to **Settings** > **Integrations**
3. Copy your **Personal API token**
4. Add it as `APIFY_API_TOKEN` in Cloudflare environment variables
5. Retry deployment

---

## Updating Your App

When new features or bug fixes are released, you can update your instance in under a minute.

### From GitHub (Recommended)

1. Go to your fork on GitHub (e.g., `github.com/YOUR-USERNAME/whisk`)
2. Near the top of the page, you'll see a message like **"This branch is X commits behind rsmedstad:main"**
3. Click **Sync fork**
4. Click **Update branch**
5. Done! Cloudflare Pages will automatically detect the change and rebuild your app (takes 1-2 minutes)

If you don't see the "Sync fork" banner, your fork is already up to date.

### Automatic Cache Updates

Whisk automatically detects when a new version has been deployed. The app checks for updates periodically, and when one is found, it clears old cached files and reloads with the latest version. No manual action needed.

If you ever need to force an update, go to **Settings** > **Data** > **Clear Cache & Reload**.

### From the Command Line (Advanced)

If you prefer using git:

```bash
# One-time: add the original repo as "upstream"
git remote add upstream https://github.com/rsmedstad/whisk.git

# To update:
git fetch upstream
git merge upstream/main
git push
```

---

## Sharing With Your Household

Whisk uses a single shared password — anyone with the password can access the same recipe book. Just share your app URL and password with family members. Each person picks their own display name when they first log in.

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
- **AI**: Groq, Gemini, Cerebras, OpenAI, Anthropic, xAI (all optional)

## License

See [LICENSE](LICENSE) for details.
