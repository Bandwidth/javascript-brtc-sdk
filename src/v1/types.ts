import { MediaType } from "../types";

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
  /**
   * Per-track stream metadata keyed by track id, sent alongside the offer that
   * adds a call's subscribe track. The SDK derives stream-available from the
   * offer gaining an active audio m-section (ontrack) rather than from a
   * separate RPC; this map lets it enrich that event with caller identity.
   * Present only on the offer that adds a call's track; omitted otherwise.
   */
  trackMetadata?: {
    [trackId: string]: TrackMetadata;
  };
}

/**
 * Caller identity for a single subscribe track, carried on the gateway's
 * subscribe sdpOffer. Intentionally omits the internal BRTC call id, which the
 * browser has no use for.
 */
export interface TrackMetadata {
  from?: string;
  fromType?: string;
  autoAccepted?: boolean;
  tags?: string;
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
  /**
   * Codec preferences the stream was originally published with. Retained so a
   * republish after a reconnect negotiates the same codecs as the first publish.
   */
  codecPreferences?: CodecPreferences;
  /**
   * Constraints the stream was acquired with, when the SDK acquired it. Retained
   * so tracks that ended while the websocket was down can be re-acquired from the
   * same devices. Undefined when the application supplied its own MediaStream.
   */
  constraints?: MediaStreamConstraints;
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
}
