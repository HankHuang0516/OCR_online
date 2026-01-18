
export interface ScanResult {
  id: string;
  timestamp: number;
  imageUrl: string;
  text: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
