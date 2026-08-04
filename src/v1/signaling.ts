const sdkVersion = require("../../package.json").version;
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";
import { Client as JsonRpcClient } from "rpc-websockets";
import logger from "../logging";
import { EndpointType, HangupResult, OutboundConnectionResult, RtcAuthParams, RtcOptions } from "../types";
import { PublishSdpAnswer, PublishMetadata, ReadyMetadata, SetMediaPreferencesWebRtcResponse, SdpAnswer } from "./types";
import { Diagnostics, DiagnosticsBatcher } from "./diagnostics";

class Signaling extends EventEmitter {
  private defaultWebsocketUrl: string = "wss://gateway.pv.prod.global.aws.bandwidth.com/prod/gateway-service/api/v1/endpoints";
  private ws: JsonRpcClient | null = null;
  private pingInterval?: NodeJS.Timeout;
  private uniqueDeviceId: string = uuid();
  private isReady: boolean = false;
  private readyMetadata: ReadyMetadata | null = null;
  private diagnosticsBatcher?: DiagnosticsBatcher;
  private rtcOptions?: RtcOptions;

  constructor(diagnosticsBatcher?: DiagnosticsBatcher) {
    super();
    if (diagnosticsBatcher) {
      this.diagnosticsBatcher = diagnosticsBatcher;
      this.diagnosticsBatcher.on("diagnostics", this.sendDiagnostics.bind(this));
    }
  }

  connect(authParams: RtcAuthParams, options?: RtcOptions) {
    let rpc_id = 1;

    return new Promise<void>((resolve, reject) => {
      let rtcOptions: RtcOptions = {
        websocketUrl: this.defaultWebsocketUrl,
      };

      if (options) {
        rtcOptions = { ...rtcOptions, ...options };
      }
      this.rtcOptions = rtcOptions;
      const websocketUrl = `${rtcOptions.websocketUrl}?client=node&sdkVersion=${sdkVersion}&uniqueId=${this.uniqueDeviceId}&endpointToken=${authParams.endpointToken}`;
      logger.debug(`Connecting to ${websocketUrl}`);
      console.log(`Connecting to ${websocketUrl}`);

      const ws = new JsonRpcClient(websocketUrl, {
        autoconnect: true,
        reconnect: true,
        max_reconnects: 0, // Unlimited
      });

      logger.debug(`Connected to ${websocketUrl}`);
      this.ws = ws;

      ws.on("sdpOffer", (event: any) => {
        this.emit("sdpOffer", event);
      });

      ws.on("established", (event: any) => {
        this.emit("established", event);
      });

      ws.on("open", async () => {
        logger.debug("Websocket open");
        if (globalThis.addEventListener) {
          globalThis.addEventListener("beforeunload", (event) => {
            this.disconnect();
          });
        }
        // TODO: handle reconnections
        let preferencesResponse = await this.setMediaPreferences();
        // logger.debug(`Media preferences set`, preferencesResponse);
        // Setup Peers
        this.emit("init", preferencesResponse);

        this.pingInterval = setInterval(() => {
          ws.call("ping", {});
        }, 60000);
        logger.debug("Websocket configured");
      });

      ws.on("ready", async (readyMetadata: ReadyMetadata) => {
        logger.debug("Websocket ready", readyMetadata);
        this.isReady = true;
        this.readyMetadata = readyMetadata;
        this.emit("ready", readyMetadata);
        resolve();
      });

      ws.on("error", (error: ErrorEvent) => {
        if (error.message === "Unexpected server response: 403") {
          logger.error("Authentication error: Invalid token");
          ws.close(403);
          ws.setAutoReconnect(false);
          reject(new Error("Invalid token"));
          // Disconnect without calling leave since we are not connected
          this._disconnect(false);
        }
        // TODO: make this a more informative error message
        logger.error(`Websocket error: ${error.message}`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
      });

      ws.on("close", (code: number) => {
        logger.debug(`Websocket closed: ${code}`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
        if (code == 1000) {
          // We were asked to go away and not come back. We should disconnect without calling leave.
          this._disconnect(false);
        }
        this.isReady = false;
      });
    });
  }

  private setMediaPreferences(): Promise<{}> {
    const autoAccept = this.rtcOptions?.autoAccept ?? true;
    logger.debug(`Calling "setMediaPreferences"`, { protocol: "WEBRTC", autoAccept });
    return this.ws?.call("setMediaPreferences", {
      protocol: "WEBRTC",
      autoAccept,
    }) as Promise<SetMediaPreferencesWebRtcResponse>;
  }

  private _disconnect(notifyLeave: boolean) {
    logger.debug("Disconnecting websocket");
    if (this.ws) {
      if (notifyLeave) {
        try {
          this.ws.notify("leave");
        } catch (err) {
          logger.error("Error calling `leave`", err);
        }
      }
      if (this.diagnosticsBatcher) {
        try {
          this.diagnosticsBatcher.shutdown();
          const finalDiagnostics = this.diagnosticsBatcher.getDiagnostics();
          this.sendDiagnostics(finalDiagnostics);
        } catch (err) {
          logger.error("Error sending diagnostics... websocket may be disconnected", err);
        }
      }
      // Stop auto-reconnect BEFORE closing. The client is constructed with
      // `reconnect: true, max_reconnects: 0` (unlimited), and rpc-websockets
      // only skips reconnecting when the close code is exactly 1000 — so any
      // other code (notably 1001/StatusGoingAway, which the gateway sends
      // whenever it wants the device to come back) puts the client into an
      // endless reconnect loop. That loop outlives this disconnect: because
      // removeAllListeners() has already run, the reconnected socket has no
      // "open" handler, so it never calls setMediaPreferences, never creates
      // peer connections, and never answers the heartbeat — an inert
      // connection on the gateway that nothing on either side reaps.
      //
      // Reconnect stays enabled for the lifetime of a live connection (that is
      // the point of it); it is only disabled here, where the caller has asked
      // to disconnect and we are tearing this client down for good.
      try {
        this.ws.setAutoReconnect(false);
      } catch (err) {
        logger.error("Error disabling auto-reconnect", err);
      }
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch (err) {
        logger.error(err);
      }
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.isReady = false;
  }

  disconnect() {
    this._disconnect(true);
  }

  requestOutboundConnection(id: string, type: EndpointType): Promise<OutboundConnectionResult> {
    logger.debug(`Calling "requestOutboundConnection"`, { id: id, type: type });
    return this.ws?.call("requestOutboundConnection", {
      id: id,
      type: type,
    }) as Promise<OutboundConnectionResult>;
  }

  hangupConnection(endpoint: string, type: EndpointType): Promise<HangupResult> {
    logger.debug(`Calling "hangupConnection"`, { endpoint: endpoint, type: type });
    return this.ws?.call("hangupConnection", {
      endpoint: endpoint,
      type: type,
    }) as Promise<HangupResult>;
  }

  acceptStream(): Promise<void> {
    logger.debug(`Calling "acceptStream"`);
    return this.ws?.call("acceptStream", {}) as Promise<void>;
  }

  declineStream(): Promise<void> {
    logger.debug(`Calling "declineStream"`);
    return this.ws?.call("declineStream", {}) as Promise<void>;
  }

  offerSdp(peerType: string, sdpOffer: string): Promise<SdpAnswer> {
    logger.debug(`Calling "offerSdp"`, { sdpOffer: sdpOffer, peerType: peerType });
    return this.ws?.call("offerSdp", { sdpOffer: sdpOffer, peerType: peerType }) as Promise<SdpAnswer>;
  }

  answerSdp(sdpAnswer: string, peerType: string): Promise<void> {
    logger.debug(`Calling "answerSdp"`, { sdpAnswer: sdpAnswer });
    return this.ws?.call("answerSdp", {
      peerType: peerType,
      sdpAnswer: sdpAnswer,
    }) as Promise<void>;
  }

  private sendDiagnostics(diagnostics: Diagnostics): Promise<void> {
    logger.debug(`Calling "deviceDiagnostics"`);
    return this.ws?.notify("deviceDiagnostics", diagnostics).catch((err: any) => {
      logger.error("Error sending diagnostics", err);
    }) as Promise<void>;
  }
}

export default Signaling;
