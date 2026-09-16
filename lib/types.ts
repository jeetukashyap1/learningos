// YouTube learning resources (discovered server-side via /api/learning/youtube/search)

export type LearningResourceType = "video";
export type LearningLevel = "beginner" | "intermediate" | "advanced";
export type LearningDurationFilter = "any" | "short" | "medium" | "long";
export type YoutubeVideoStatus = "public" | "unavailable";

export interface YoutubeSearchOptions {
  query: string;
  topic?: string;
  skill?: string;
  level?: LearningLevel;
  language?: string;
  duration?: LearningDurationFilter;
  limit?: number;
}

export interface LearningResource {
  /** Database id when persisted, null when the resource could not be saved. */
  id: string | null;
  type: LearningResourceType;
  provider: "youtube";
  /** Canonical YouTube video id (11 characters, validated server-side). */
  externalId: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  status: YoutubeVideoStatus;
}

export interface RelevanceScoreBreakdown {
  topicMatch: number;
  titleMatch: number;
  descriptionMatch: number;
  educationalSignals: number;
  durationFit: number;
  levelFit: number;
  /** Preferred-video-language match (spec part 13); full weight when no preference. */
  languageMatch: number;
}

export interface ScoredLearningResource {
  resource: LearningResource;
  relevanceScore: number;
  scoreBreakdown: RelevanceScoreBreakdown;
}

/** Future watch-progress model - intentionally not wired into the progress system yet. */
export interface LearningResourceWatchState {
  resourceExternalId: string;
  started: boolean;
  completed: boolean;
  lastPositionSeconds: number;
  watchedPercent: number;
  updatedAt: string;
}
