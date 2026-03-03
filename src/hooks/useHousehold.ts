import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import type { Household, HouseholdMember } from "../types";

const EMPTY_HOUSEHOLD: Household = {
  members: [],
  updatedAt: new Date().toISOString(),
};

export function useHousehold() {
  const [household, setHousehold] = useState<Household>(EMPTY_HOUSEHOLD);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get<Household>("/household")
      .then((data) => setHousehold(data ?? EMPTY_HOUSEHOLD))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const currentUserId = localStorage.getItem("whisk_user_id");
  const currentMember = household.members.find((m) => m.id === currentUserId);
  const isOwner = currentMember?.isOwner ?? false;

  const removeMember = useCallback(
    async (memberId: string) => {
      const updated: Household = {
        ...household,
        members: household.members.filter((m) => m.id !== memberId),
        updatedAt: new Date().toISOString(),
      };
      setHousehold(updated);
      await api.put("/household", updated);
    },
    [household]
  );

  const renameMember = useCallback(
    async (memberId: string, newName: string) => {
      const updated: Household = {
        ...household,
        members: household.members.map((m) =>
          m.id === memberId ? { ...m, name: newName } : m
        ),
        updatedAt: new Date().toISOString(),
      };
      setHousehold(updated);
      await api.put("/household", updated);

      // If renaming self, update local storage
      if (memberId === currentUserId) {
        localStorage.setItem("whisk_display_name", newName);
      }
    },
    [household, currentUserId]
  );

  const transferOwnership = useCallback(
    async (newOwnerId: string) => {
      const updated: Household = {
        ...household,
        members: household.members.map((m) => ({
          ...m,
          isOwner: m.id === newOwnerId,
        })),
        updatedAt: new Date().toISOString(),
      };
      setHousehold(updated);
      await api.put("/household", updated);
    },
    [household]
  );

  return {
    household,
    isLoading,
    isOwner,
    currentUserId,
    removeMember,
    renameMember,
    transferOwnership,
  };
}
