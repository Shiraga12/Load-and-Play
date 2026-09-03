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
}

export interface PreservationJob {
  drive: OpticalDrive;
  format: ImageFormat;
  destination: string;
  title: string;
  system?: SystemProfile | null;
}

export interface ToolStatus {
  name: string;
  available: boolean;
  purpose: string;
}

export interface JobResult {
  started: boolean;
  message: string;
}