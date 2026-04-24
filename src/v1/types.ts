import { MediaType, ConnectStatus } from "../types";

export interface SetMediaPreferencesWebRtcResponse {
  endpointId: string;
  deviceId: string;
  publishSdpOffer: SdpOffer;
  subscribeSdpOffer: SdpOffer;
}
export interface SdpOffer {
  peerType: string;
  sdpOffer: string;
}

export interface SdpAnswer {
  peerType: string;
  sdpAnswer: string;
}

export interface SubscribeSdpOffer {
  sdpOffer: string;
  sdpRevision: number;
  streamSourceMetadata: {
    [streamId: string]: StreamMetadata;
  };
}

export interface PublishSdpAnswer {
  sdpAnswer: string;
  endpointId: string;
}

export interface StreamMetadata {
  media: string;
  mediaTypes: MediaType[];
  alias?: string;
  endpointId?: string;
}

export interface StreamPublishMetadata {
  alias?: string;
}

export interface DataChannelPublishMetadata {
  label: string;
  streamId: number;
}

export interface PublishedStream {
  mediaStream: MediaStream;
  metadata?: StreamPublishMetadata;
}

export interface PublishMetadata {
  mediaStreams: {
    [streamId: string]: StreamPublishMetadata;
  };
  dataChannels: {
    [dataChannelLabel: string]: DataChannelPublishMetadata;
  };
}

export interface CodecPreferences {
  audio?: RTCRtpCodec[];
  video?: RTCRtpCodec[];
}

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
