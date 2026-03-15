interface Env {
  APP_SECRET: string;
  OWNER_PASSWORD?: string;
  DEMO_MODE?: string;
  WHISK_KV: KVNamespace;
}

interface HouseholdMember {
  id: string;
  name: string;
  isOwner: boolean;
  joinedAt: string;
}

interface Household {
  members: HouseholdMember[];
  updatedAt: string;
}

// Check if a book (household) already exists — unauthenticated
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const household = await env.WHISK_KV.get<Household>("household", "json");
    const bookExists = !!household && household.members.length > 0;
    return new Response(JSON.stringify({ bookExists }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ bookExists: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as { password: string; name?: string };
    const { password, name } = body;

    if (!password || !env.APP_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isDemoMode = env.DEMO_MODE === "true";

    // In demo mode, accept either APP_SECRET (regular user) or OWNER_PASSWORD (owner)
    const isOwnerLogin = isDemoMode && !!env.OWNER_PASSWORD && password === env.OWNER_PASSWORD;
    const isRegularLogin = password === env.APP_SECRET;

    if (!isOwnerLogin && !isRegularLogin) {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Load or create household
    let household = await env.WHISK_KV.get<Household>("household", "json");
    if (!household) {
      household = { members: [], updatedAt: new Date().toISOString() };
    }

    const displayName = (name ?? "").trim();
    let member: HouseholdMember | undefined;

    if (displayName) {
      // In demo mode with regular login, never match an existing owner member by name
      // This prevents someone from typing "Ryan" and getting owner access
      if (isDemoMode && !isOwnerLogin) {
        member = household.members.find(
          (m) => m.name.toLowerCase() === displayName.toLowerCase() && !m.isOwner
        );
      } else {
        // Find existing member by name (case-insensitive)
        member = household.members.find(
          (m) => m.name.toLowerCase() === displayName.toLowerCase()
        );
      }

      if (!member) {
        // Check if the name is already taken by another member (prevents duplicates)
        const nameTaken = household.members.some(
          (m) => m.name.toLowerCase() === displayName.toLowerCase()
        );
        if (nameTaken) {
          return new Response(
            JSON.stringify({ error: "That name is already taken. Please choose a different name." }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }

        // Create new member — first member is the owner
        const idData = new Uint8Array(8);
        crypto.getRandomValues(idData);
        const userId = Array.from(idData)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        member = {
          id: userId,
          name: displayName,
          isOwner: household.members.length === 0,
          joinedAt: new Date().toISOString(),
        };
        household.members.push(member);
        household.updatedAt = new Date().toISOString();
        await env.WHISK_KV.put("household", JSON.stringify(household));
      }
    }

    // Generate session token
    const tokenData = new Uint8Array(32);
    crypto.getRandomValues(tokenData);
    const token = btoa(String.fromCharCode(...tokenData))
      .replace(/[+/=]/g, "")
      .slice(0, 48);

    // In demo mode, only the owner login gets isDemoOwner flag
    const isDemoOwner = isDemoMode && isOwnerLogin;

    // Store session with user identity (backwards-compatible: works with or without name)
    const sessionData = member
      ? JSON.stringify({ userId: member.id, name: member.name, isDemoOwner })
      : isDemoOwner
        ? JSON.stringify({ isDemoOwner: true })
        : "valid";

    const sessionTtl = 60 * 60 * 24 * 30;
    await env.WHISK_KV.put(`session:${token}`, sessionData, {
      expirationTtl: sessionTtl,
    });

    // Track active session tokens per user so we can revoke them on member removal
    if (member) {
      const sessionsKey = `user_sessions:${member.id}`;
      const existing = await env.WHISK_KV.get<string[]>(sessionsKey, "json");
      const tokens = existing ?? [];
      tokens.push(token);
      // Keep only last 10 tokens per user (older ones expire naturally via TTL)
      await env.WHISK_KV.put(sessionsKey, JSON.stringify(tokens.slice(-10)), {
        expirationTtl: sessionTtl,
      });
    }

    return new Response(
      JSON.stringify({
        token,
        userId: member?.id ?? null,
        name: member?.name ?? null,
        isOwner: member?.isOwner ?? false,
        demoMode: isDemoMode,
        isDemoOwner,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
