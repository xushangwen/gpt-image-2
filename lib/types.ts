export type AspectRatio = "auto" | "1:1" | "3:2" | "2:3";
export type Quality = "low" | "medium" | "high";
export type ProviderChoice = "tuzi" | "bltcy";
export type AIEngine = "openai" | "gemini";
export type ImageResult = { b64?: string; url?: string; mediaType: string };

export type HistoryEntry = {
  id: string;
  prompt: string;
  aspect: AspectRatio;
  effectiveAspect?: string;
  quality: Quality;
  count: number;
  timestamp: number;
  thumbnail: string;
  imageCount: number;
  referenceName?: string;
  versionLabel?: string;
  engine?: AIEngine;
};

export type VersionEntry = HistoryEntry & {
  images: ImageResult[];
  referenceThumbnail?: string;
};
