import { useState, useCallback } from "react";
import { compressForUpload, compressImage } from "../lib/compress";
import { api } from "../lib/api";

interface UploadResult {
  heroUrl: string;
  thumbnailUrl: string;
}

export function useImageCompress() {
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadRecipePhoto = useCallback(
    async (file: File, recipeId: string): Promise<UploadResult> => {
      setIsCompressing(true);
      setProgress(0);

      try {
        // Compress
        setProgress(30);
        const { hero, thumbnail } = await compressForUpload(file);

        // Upload hero
        setProgress(60);
        const heroResult = await api.upload<{ url: string }>(
          "/upload",
          hero,
          `${recipeId}-hero.webp`
        );

        // Upload thumbnail
        setProgress(80);
        const thumbResult = await api.upload<{ url: string }>(
          "/upload",
          thumbnail,
          `${recipeId}-thumb.webp`
        );

        setProgress(100);
        return {
          heroUrl: heroResult.url,
          thumbnailUrl: thumbResult.url,
        };
      } finally {
        setIsCompressing(false);
      }
    },
    []
  );

  const uploadStepPhoto = useCallback(
    async (file: File, recipeId: string, stepIndex: number): Promise<string> => {
      setIsCompressing(true);
      try {
        const compressed = await compressImage(file, "step");
        const result = await api.upload<{ url: string }>(
          "/upload",
          compressed,
          `${recipeId}-step-${stepIndex}.webp`
        );
        return result.url;
      } finally {
        setIsCompressing(false);
      }
    },
    []
  );

  return { isCompressing, progress, uploadRecipePhoto, uploadStepPhoto };
}
