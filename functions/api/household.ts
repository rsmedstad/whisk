interface Env {
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

// GET /api/household — list members (non-owners only see themselves + owner)
export const onRequestGet: PagesFunction<Env> = async ({ env, data }) => {
  const household = await env.WHISK_KV.get<Household>("household", "json");
  if (!household) {
    return new Response(
      JSON.stringify({ members: [], updatedAt: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const requestingUserId = (data as Record<string, string>).userId;
  const requester = household.members.find((m) => m.id === requestingUserId);

  // Owner sees all members; non-owners see only themselves + the owner
  if (requester && !requester.isOwner) {
    const filtered: Household = {
      ...household,
      members: household.members.filter((m) => m.isOwner || m.id === requestingUserId),
    };
    return new Response(JSON.stringify(filtered), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(household), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/household — update household (rename/remove members, transfer ownership)
export const onRequestPut: PagesFunction<Env> = async ({ request, env, data }) => {
  try {
    const requestingUserId = (data as Record<string, string>).userId;
    const current = await env.WHISK_KV.get<Household>("household", "json");

    // Only owner can modify the household
    if (current) {
      const requester = current.members.find((m) => m.id === requestingUserId);
      if (!requester?.isOwner) {
        return new Response(JSON.stringify({ error: "Only the owner can manage the household" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const updated = (await request.json()) as Household;
    updated.updatedAt = new Date().toISOString();

    // Ensure at least one owner exists
    if (updated.members.length > 0 && !updated.members.some((m) => m.isOwner)) {
      const first = updated.members[0];
      if (first) first.isOwner = true;
    }

    // Detect removed members and invalidate their sessions
    if (current) {
      const updatedIds = new Set(updated.members.map((m) => m.id));
      const removedMembers = current.members.filter((m) => !updatedIds.has(m.id));

      for (const removed of removedMembers) {
        // Delete all active session tokens for the removed user
        const sessionsKey = `user_sessions:${removed.id}`;
        const tokens = await env.WHISK_KV.get<string[]>(sessionsKey, "json");
        if (tokens) {
          await Promise.all(tokens.map((t) => env.WHISK_KV.delete(`session:${t}`)));
          await env.WHISK_KV.delete(sessionsKey);
        }
      }
    }

    await env.WHISK_KV.put("household", JSON.stringify(updated));
    return new Response(JSON.stringify(updated), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
