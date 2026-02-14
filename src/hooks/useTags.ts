import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import type { TagIndex, TagDefinition } from "../types";
import { PRESET_TAGS } from "../lib/tags";

const DEFAULT_INDEX: TagIndex = {
  tags: PRESET_TAGS,
  updatedAt: new Date().toISOString(),
};

export function useTags() {
  // Instant from cache
  const [tagIndex, setTagIndex] = useState<TagIndex>(
    () => getLocal<TagIndex>(CACHE_KEYS.TAG_INDEX) ?? DEFAULT_INDEX
  );
  const [isLoading, setIsLoading] = useState(false);

  // Background sync
  useEffect(() => {
    api
      .get<TagIndex>("/tags")
      .then((data) => {
        if (data) {
          const existingNames = new Set(data.tags.map((t) => t.name));
          const missingPresets = PRESET_TAGS.filter(
            (p) => !existingNames.has(p.name)
          );
          const merged = {
            ...data,
            tags: [...data.tags, ...missingPresets],
          };
          setTagIndex(merged);
          setLocal(CACHE_KEYS.TAG_INDEX, merged);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Optimistic save
  const saveTags = useCallback(async (updated: TagIndex) => {
    const withTimestamp = { ...updated, updatedAt: new Date().toISOString() };
    setTagIndex(withTimestamp);
    setLocal(CACHE_KEYS.TAG_INDEX, withTimestamp);
    api.put("/tags", withTimestamp).catch(() => {});
  }, []);

  const addCustomTag = useCallback(
    async (name: string) => {
      const tag: TagDefinition = {
        name: name.toLowerCase().trim(),
        type: "custom",
        group: "custom",
        usageCount: 0,
      };
      await saveTags({ ...tagIndex, tags: [...tagIndex.tags, tag] });
      return tag;
    },
    [tagIndex, saveTags]
  );

  const deleteCustomTag = useCallback(
    async (name: string) => {
      await saveTags({
        ...tagIndex,
        tags: tagIndex.tags.filter(
          (t) => !(t.name === name && t.type === "custom")
        ),
      });
    },
    [tagIndex, saveTags]
  );

  const renameTag = useCallback(
    async (oldName: string, newName: string) => {
      await saveTags({
        ...tagIndex,
        tags: tagIndex.tags.map((t) =>
          t.name === oldName ? { ...t, name: newName.toLowerCase().trim() } : t
        ),
      });
    },
    [tagIndex, saveTags]
  );

  const allTagNames = tagIndex.tags.map((t) => t.name);
  const presetTags = tagIndex.tags.filter((t) => t.type === "preset");
  const customTags = tagIndex.tags.filter((t) => t.type === "custom");

  return {
    tagIndex,
    allTagNames,
    presetTags,
    customTags,
    isLoading,
    fetchTags: () => {},
    addCustomTag,
    deleteCustomTag,
    renameTag,
  };
}
