export type ImageFormat = "iso" | "chd" | "rvz";

export interface OpticalDrive {
  id: string;
  letter: string;
  name: string;
  mediaLoaded: boolean;
}

export interface SystemProfile {
  name: string;
  manufacturer: string;
  shortName: string;
  media: string[];
  fileFormats: string[];
  description: string;
}

export interface DiscProbe {
  system: SystemProfile | null;
  evidence: string;
  metadata: DiscMetadata;
}

export interface DiscMetadata {
  title: string | null;
  gameId: string | null;
  region: string | null;
  volumeLabel: string | null;
  fileSystem: string | null;
  sizeBytes: number | null;
  external: ExternalGameMetadata | null;
}

export type MetadataProvider = "screenscraper" | "launchbox" | "mobygames" | "steamgriddb";

export interface MetadataCredentials {
  apiKey?: string;
  username?: string;
  password?: string;
  developerId?: string;
  developerPassword?: string;
  endpoint?: string;
}

export interface ExternalGameMetadata {
  provider: MetadataProvider;
  id: string;
  title: string;
  url: string | null;
}

export interface PreservationJob {
  drive: OpticalDrive;
  format: ImageFormat;
  destination: string;
  title: string;
  system?: SystemProfile | null;
  metadata?: DiscMetadata;
}

export interface ToolStatus {
  name: string;
  available: boolean;
  purpose: string;
}

export interface GameMetadataResult {
  provider: MetadataProvider;
  id: string;
  title: string;
  url: string | null;
}

export interface GameMetadataLookup {
  provider: MetadataProvider;
  configured: boolean;
  results: GameMetadataResult[];
  message?: string;
}

export interface JobResult {
  started: boolean;
  message: string;
}

export type VerificationStatus = "verified" | "mismatch" | "missing" | "unverified";

export interface LibraryItem {
  manifestPath: string;
  title: string;
  platform: string;
  capturedAt: string | null;
  format: string;
  localStatus: VerificationStatus;
  onlineStatus: "not-configured" | "pending";
}

export interface LibraryVerificationResult {
  manifestPath: string;
  status: VerificationStatus;
  message: string;
  verifiedAt: string;
}