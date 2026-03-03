interface Env {
  APP_SECRET: string;
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

    if (password !== env.APP_SECRET) {
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
      // Find existing member by name (case-insensitive)
      member = household.members.find(
        (m) => m.name.toLowerCase() === displayName.toLowerCase()
      );

      if (!member) {
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

    // Store session with user identity (backwards-compatible: works with or without name)
    const sessionData = member
      ? JSON.stringify({ userId: member.id, name: member.name })
      : "valid";

    await env.WHISK_KV.put(`session:${token}`, sessionData, {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    return new Response(
      JSON.stringify({
        token,
        userId: member?.id ?? null,
        name: member?.name ?? null,
        isOwner: member?.isOwner ?? false,
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
