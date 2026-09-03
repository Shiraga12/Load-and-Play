export type ImageFormat = "iso" | "chd" | "rvz";

export interface OpticalDrive {
  id: string;
  letter: string;
  name: string;
  mediaLoaded: boolean;
}

export interface PreservationJob {
  drive: OpticalDrive;
  format: ImageFormat;
  destination: string;
  title: string;
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