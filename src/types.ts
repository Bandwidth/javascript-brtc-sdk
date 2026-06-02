export enum AudioLevel {
  SILENT = "silent",
  LOW = "low",
  HIGH = "high",
}

export enum MediaAggregationType {
  NONE = "NONE",
  COMPOSITE = "COMPOSITE",
}

export enum MediaType {
  AUDIO = "AUDIO",
  VIDEO = "VIDEO",
  APPLICATION = "APPLICATION",
}

export enum EndpointType {
  ENDPOINT = "ENDPOINT",
  CALL_ID = "CALL_ID",
  PHONE_NUMBER = "PHONE_NUMBER",
}

export enum ConnectStatus {
  INITIATED = "INITIATED",
  COMPLETED = "COMPLETED",
  TIMED_OUT = "TIMED_OUT",
  DENIED = "DENIED",
  CANCELED = "CANCELED",
  FAILED = "FAILED",
}

export type AudioLevelChangeHandler = { (audioLevel: AudioLevel): void };

/**
 * @property {string} endpointToken - The endpoint token is a "string" in the JWT format.
 * To be possible the token utilization, parse the token using "jwt_decode" function, the expected result should be a {@link JwtPayload} object.
 */
export interface RtcAuthParams {
  endpointToken: string;
}

export interface RtcOptions {
  websocketUrl?: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface RtcStream {
  mediaTypes: MediaType[];
  mediaStream?: MediaStream;
  callId?: string;
}

export class BandwidthRtcError extends Error {}

export interface ReadyMetadata {
  endpointId: string;
  deviceId: string;
  territory: string; // TODO enum
  region: string; // TODO enum
  connectStatus?: ConnectStatus;
  accountId?: string;
  sessionId?: string;
  from?: string;
  fromType?: string;
  fromTags?: string;
  to?: string;
  toType?: string;
  toTags?: string;
}

export interface OutboundConnectionResult {
  accepted: boolean;
}

export interface HangupResult {
  result: string;
}
