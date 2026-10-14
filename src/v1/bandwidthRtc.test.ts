import { BandwidthRtc } from "./bandwidthRtc";
import { setupMocks, setupNavigatorMocks } from "../mocks";
import { BandwidthRtcError } from "../types";
import logger from "../logging";

// Mock Signaling class
jest.mock("./signaling", () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  }));
});

// Mock DiagnosticsBatcher
jest.mock("./diagnostics", () => ({
  DiagnosticsBatcher: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    flushDiagnostics: jest.fn(),
  })),
}));

describe("bandwidhthRtcV1 constructor", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  test("should create instance without error", () => {
    const bandwidthRtc = new BandwidthRtc("debug");
    expect(bandwidthRtc).toBeDefined();
    expect(bandwidthRtc).toBeInstanceOf(BandwidthRtc);
  });

  test("should initialize DiagnosticsBatcher and Signaling in constructor", () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    // Verify the instance was created
    expect(bandwidthRtc).toBeDefined();

    // Access private properties via reflection to verify they were initialized
    const privateBandwidthRtc = bandwidthRtc as any;
    expect(privateBandwidthRtc.diagnosticsBatcher).toBeDefined();
    expect(privateBandwidthRtc.signaling).toBeDefined();
  });

  test("should bind methods in constructor", () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    // Verify methods are callable (bound correctly)
    expect(typeof bandwidthRtc.setMicEnabled).toBe("function");
    expect(typeof bandwidthRtc.setCameraEnabled).toBe("function");

    // Access private method via reflection
    const privateBandwidthRtc = bandwidthRtc as any;
    expect(typeof privateBandwidthRtc.setupNewPeerConnection).toBe("function");
  });
});

describe("bandwidthRtcV1 sendDtmf", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  function makeDtmfSender(canInsertDTMF: boolean = true) {
    return { insertDTMF: jest.fn(), canInsertDTMF };
  }

  test("calls insertDTMF on all registered senders when no streamId given", () => {
    const brtc = new BandwidthRtc();
    const sender1 = makeDtmfSender();
    const sender2 = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender1);
    (brtc as any).localDtmfSenders.set("stream-2", sender2);

    brtc.sendDtmf("5");

    expect(sender1.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender1.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
    expect(sender2.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender2.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });

  test("calls insertDTMF only on the specified stream when streamId given", () => {
    const brtc = new BandwidthRtc();
    const sender1 = makeDtmfSender();
    const sender2 = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender1);
    (brtc as any).localDtmfSenders.set("stream-2", sender2);

    brtc.sendDtmf("9", "stream-1");

    expect(sender1.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender2.insertDTMF).not.toHaveBeenCalled();
  });

  test("forwards duration and interToneGap to insertDTMF", () => {
    const brtc = new BandwidthRtc();
    const sender = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender);

    brtc.sendDtmf("1", undefined, 200, 80);

    expect(sender.insertDTMF).toHaveBeenCalledWith("1", 200, 80);
  });

  test("does not throw when no senders are registered", () => {
    const brtc = new BandwidthRtc();
    expect(() => brtc.sendDtmf("5")).not.toThrow();
  });

  test("does nothing for an unknown streamId", () => {
    const brtc = new BandwidthRtc();
    const sender = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender);

    brtc.sendDtmf("5", "nonexistent");

    expect(sender.insertDTMF).not.toHaveBeenCalled();
  });

  test("skips a sender that is not ready (canInsertDTMF false) without throwing", () => {
    const brtc = new BandwidthRtc();
    const notReady = makeDtmfSender(false);
    const ready = makeDtmfSender(true);
    (brtc as any).localDtmfSenders.set("stream-1", notReady);
    (brtc as any).localDtmfSenders.set("stream-2", ready);

    expect(() => brtc.sendDtmf("5")).not.toThrow();

    expect(notReady.insertDTMF).not.toHaveBeenCalled();
    expect(ready.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });

  test("catches an insertDTMF error on one sender and still calls the others", () => {
    const brtc = new BandwidthRtc();
    const throwing = makeDtmfSender();
    throwing.insertDTMF.mockImplementation(() => {
      throw new DOMException("not ready", "InvalidStateError");
    });
    const healthy = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", throwing);
    (brtc as any).localDtmfSenders.set("stream-2", healthy);

    expect(() => brtc.sendDtmf("5")).not.toThrow();

    expect(healthy.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });
});

describe("bandwidthRtcV1 addStreamToPublishingPeerConnection", () => {
  afterEach(() => {
    delete (global as any).RTCRtpSender;
  });

  function makeTransceiver(dtmf: RTCDTMFSender | null = { insertDTMF: jest.fn() } as any) {
    return { sender: { dtmf }, setCodecPreferences: jest.fn() };
  }

  function makeMockStream(id: string, trackKind: string) {
    return { id, getTracks: () => [{ kind: trackKind, id: "track-1" }] };
  }

  function withPublishingPeerConnection(brtc: BandwidthRtc, transceiver: ReturnType<typeof makeTransceiver>) {
    (brtc as any).publishingPeerConnection = { addTransceiver: jest.fn().mockReturnValue(transceiver) };
  }

  test("stores dtmf sender for audio track", () => {
    const brtc = new BandwidthRtc();
    const dtmfSender = { insertDTMF: jest.fn() };
    const transceiver = makeTransceiver(dtmfSender as any);
    withPublishingPeerConnection(brtc, transceiver);

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    expect((brtc as any).localDtmfSenders.get("stream-1")).toBe(dtmfSender);
  });

  test("does not store dtmf sender when sender.dtmf is null", () => {
    const brtc = new BandwidthRtc();
    withPublishingPeerConnection(brtc, makeTransceiver(null));

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    expect((brtc as any).localDtmfSenders.has("stream-1")).toBe(false);
  });

  test("appends the clock-matched telephone-event when missing from audio preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te8000, te48000] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    // Must pair with telephone-event/48000 (Opus clock), not the 8000 variant.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
  });

  test("replaces a clock-mismatched telephone-event already in preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te48000] }) };

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec, te8000] });

    // The mismatched 8000 event is dropped and replaced with the 48000 one from capabilities.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  test("keeps the clock-matched telephone-event already in preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec, te48000] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  test("falls back to original preferences when no clock-matched telephone-event is available", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    // Only a mismatched (8000) telephone-event exists; better to omit it than offer a dropped codec.
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te8000] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec]);
  });

  test("forces the clock-matched telephone-event even without explicit codecPreferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [opusCodec, te8000, te48000] }) };

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    // Full capabilities collapse to the primary codec + its matching-clock telephone-event.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
  });

  test("skips setCodecPreferences when RTCRtpSender is unavailable (e.g. non-browser environment)", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"))).not.toThrow();

    expect(transceiver.setCodecPreferences).not.toHaveBeenCalled();
  });
});

describe("bandwidthRtcV1 unpublish", () => {
  function makeTrack(id: string) {
    return { id, stop: jest.fn() };
  }

  function makeStream(id: string, tracks: any[]) {
    return { id, getTracks: () => tracks } as any;
  }

  function makeTransceiverFor(track: any) {
    return { sender: { track }, stop: jest.fn() };
  }

  function makePublishingPeerConnection(transceivers: any[], connectionState: string = "connected") {
    return {
      getTransceivers: jest.fn().mockReturnValue(transceivers),
      removeTrack: jest.fn(),
      createOffer: jest.fn().mockResolvedValue({ sdp: "v=0" }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      connectionState,
    };
  }

  function stubOfferSdp(brtc: BandwidthRtc, impl?: () => Promise<any>) {
    const offerSdp = jest.fn(impl ?? (() => Promise.resolve({ sdpAnswer: "sdp", peerType: "publish" })));
    (brtc as any).signaling.offerSdp = offerSdp;
    return offerSdp;
  }

  test("unpublish with an unknown id leaves other published streams in place and does not renegotiate", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    const transceiver = makeTransceiverFor(track);
    const pc = makePublishingPeerConnection([transceiver]);
    (brtc as any).publishingPeerConnection = pc;
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });
    const offerSdp = stubOfferSdp(brtc);

    await brtc.unpublish("unknown-id");

    expect((brtc as any).publishedStreams.has("stream-1")).toBe(true);
    expect(pc.removeTrack).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(offerSdp).not.toHaveBeenCalled();
  });

  test("unpublish(stream) stops that stream's audio level detector", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    const transceiver = makeTransceiverFor(track);
    const pc = makePublishingPeerConnection([transceiver]);
    (brtc as any).publishingPeerConnection = pc;
    const audioLevelDetector = { stop: jest.fn() };
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream, audioLevelDetector });
    stubOfferSdp(brtc);

    await brtc.unpublish({ mediaStream: stream } as any);

    expect(audioLevelDetector.stop).toHaveBeenCalledTimes(1);
  });

  test("unpublish after disconnect does not throw, stops the tracks, and does not call offerSdp", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    (brtc as any).publishingPeerConnection = undefined;
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });
    const offerSdp = stubOfferSdp(brtc);

    await expect(brtc.unpublish("stream-1")).resolves.toBeUndefined();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect((brtc as any).publishedStreams.has("stream-1")).toBe(false);
    expect(offerSdp).not.toHaveBeenCalled();
  });

  test("rejects with BandwidthRtcError when renegotiation fails, but still cleans up locally", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    const transceiver = makeTransceiverFor(track);
    const pc = makePublishingPeerConnection([transceiver]);
    (brtc as any).publishingPeerConnection = pc;
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });
    stubOfferSdp(brtc, () => Promise.reject(new Error("gateway rejected offer")));

    await expect(brtc.unpublish("stream-1")).rejects.toThrow(BandwidthRtcError);

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(pc.removeTrack).toHaveBeenCalledWith(transceiver.sender);
    expect((brtc as any).publishedStreams.has("stream-1")).toBe(false);
  });

  test("does not remove transceivers until an in-flight publish negotiation completes", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    const transceiver = makeTransceiverFor(track);
    const pc = makePublishingPeerConnection([transceiver]);
    (brtc as any).publishingPeerConnection = pc;
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });

    let resolveOfferSdp!: (value: any) => void;
    const deferredOfferSdp = new Promise((resolve) => {
      resolveOfferSdp = resolve;
    });
    (brtc as any).signaling.offerSdp = jest.fn().mockReturnValueOnce(deferredOfferSdp).mockResolvedValue({ sdpAnswer: "sdp", peerType: "publish" });

    // Simulate an in-flight publish negotiation holding publishMutex, blocked on the gateway's answer.
    const inFlightPublish = (brtc as any).publishMutex.runExclusive(() => (brtc as any).negotiatePublishSdp());

    const unpublishPromise = brtc.unpublish("stream-1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pc.removeTrack).not.toHaveBeenCalled();

    resolveOfferSdp({ sdpAnswer: "sdp", peerType: "publish" });
    await inFlightPublish;
    await unpublishPromise;

    expect(pc.removeTrack).toHaveBeenCalledWith(transceiver.sender);
  });

  test("does not hold publishMutex while waiting for the publish peer to reach connected", async () => {
    const brtc = new BandwidthRtc();
    const track = makeTrack("stream-1-track");
    const stream = makeStream("stream-1", [track]);
    const transceiver = makeTransceiverFor(track);
    const pc = makePublishingPeerConnection([transceiver], "connecting");
    (brtc as any).publishingPeerConnection = pc;
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });
    const offerSdp = stubOfferSdp(brtc);

    const unpublishPromise = brtc.unpublish("stream-1");

    // Give the wait loop a couple of polls to prove unpublish is actually waiting, not racing ahead.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(offerSdp).not.toHaveBeenCalled();

    // A concurrent publish-side task must be able to acquire and release publishMutex while
    // unpublish is still waiting for "connected" - proving the wait doesn't hold the mutex.
    const otherTask = jest.fn().mockResolvedValue(undefined);
    await (brtc as any).publishMutex.runExclusive(otherTask);
    expect(otherTask).toHaveBeenCalledTimes(1);

    pc.connectionState = "connected";
    await unpublishPromise;

    expect(offerSdp).toHaveBeenCalledTimes(1);
  });
});

describe("bandwidthRtcV1 init reconnect replay", () => {
  // init() only needs a stand-in RTCPeerConnection; the real negotiation performed by
  // setupPeerConnection is exercised elsewhere. Defaults to already connected so the
  // republish path's ICE wait resolves immediately; pass a mutable object with a different
  // connectionState to exercise that wait itself.
  function stubSetupPeerConnection(brtc: BandwidthRtc, pc: any = { connectionState: "connected" }) {
    (brtc as any).setupPeerConnection = jest.fn().mockResolvedValue(pc);
    return pc;
  }

  function makeTrack(kind: string, readyState: string = "live", enabled: boolean = true) {
    return { kind, id: `${kind}-track`, readyState, enabled, stop: jest.fn() };
  }

  function makeLiveStream(id: string, tracks: any[] = [makeTrack("audio")]) {
    return {
      id,
      getTracks: () => tracks,
      addTrack: jest.fn((track: any) => tracks.push(track)),
      removeTrack: jest.fn((track: any) => tracks.splice(tracks.indexOf(track), 1)),
    } as any;
  }

  test("does not replay when no streams were previously published (first connect)", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection");
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

    expect(addSpy).not.toHaveBeenCalled();
    expect(offerSpy).not.toHaveBeenCalled();
  });

  test("re-attaches previously published streams to the new publishing peer connection on reconnect", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    // Simulate the websocket "open" handler re-emitting "init" after a reconnect.
    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(addSpy).toHaveBeenCalledWith(mediaStream, undefined);
    expect(offerSpy).toHaveBeenCalledTimes(1);
  });

  test("renegotiates exactly once for all replayed streams", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    for (const id of ["stream-1", "stream-2", "stream-3"]) {
      (brtc as any).publishedStreams.set(id, { mediaStream: makeLiveStream(id) });
    }

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(addSpy).toHaveBeenCalledTimes(3);
    expect(offerSpy).toHaveBeenCalledTimes(1);
  });

  test("waits for the publish peer connection to reach connected before offering", async () => {
    const brtc = new BandwidthRtc();
    // The gateway rejects an offer with "peer not ready for sdp offers" until its own side of
    // the publish peer connection reaches connected - starting the offer immediately after
    // init() creates the peer connections raced that and failed against a live gateway.
    const pc = stubSetupPeerConnection(brtc, { connectionState: "connecting" });
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    (brtc as any).publishedStreams.set("stream-1", { mediaStream: makeLiveStream("stream-1") });

    const initPromise = brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);
    // Give the wait loop a couple of polls to prove it is actually waiting, not racing ahead.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(addSpy).not.toHaveBeenCalled();
    expect(offerSpy).not.toHaveBeenCalled();

    pc.connectionState = "connected";
    await initPromise;

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(offerSpy).toHaveBeenCalledTimes(1);
  });

  test("reports an error rather than offering into a peer connection that never connects", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc, { connectionState: "connecting" });
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const errorHandler = jest.fn();
    brtc.onError(errorHandler);

    (brtc as any).publishedStreams.set("stream-1", { mediaStream: makeLiveStream("stream-1") });
    jest.useFakeTimers({ doNotFake: ["nextTick"] });

    const initPromise = brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);
    await jest.advanceTimersByTimeAsync(15_000);
    await initPromise;

    expect(addSpy).not.toHaveBeenCalled();
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0][0].message).toMatch(/did not reach "connected"/);

    jest.useRealTimers();
  });

  test("replays with the codec preferences the stream was originally published with", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const codecPreferences = { audio: [{ mimeType: "audio/opus", clockRate: 48000 }] };
    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream, codecPreferences });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(addSpy).toHaveBeenCalledWith(mediaStream, codecPreferences);
  });

  test("publish retains codec preferences and constraints for a later replay", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    setupMocks();
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = {};
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    // publish() now negotiates via negotiatePublishSdp directly (under its own publishMutex
    // section), not the mutex-acquiring offerPublishSdp wrapper - see the unpublish/publish
    // race fix in bandwidthRtc.ts.
    jest.spyOn(brtc as any, "negotiatePublishSdp").mockResolvedValue(undefined);

    const mediaStream = makeLiveStream("stream-1");
    mockGetUserMedia.mockResolvedValue(mediaStream);
    const constraints = { audio: true, video: false };
    const codecPreferences = { audio: [{ mimeType: "audio/opus", clockRate: 48000 }] };

    await brtc.publish(constraints as any, undefined, undefined, codecPreferences as any);

    const published = (brtc as any).publishedStreams.get("stream-1");
    expect(published.codecPreferences).toBe(codecPreferences);
    expect(published.constraints).toBe(constraints);
  });

  test("re-acquires tracks that ended while disconnected instead of re-attaching them dead", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const endedTrack = makeTrack("audio", "ended");
    const mediaStream = makeLiveStream("stream-1", [endedTrack]);
    const constraints = { audio: true, video: false };
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream, constraints });

    const freshTrack = makeTrack("audio");
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [freshTrack] });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    // Re-acquired using the stored constraints' audio settings, but only for the kind
    // that actually ended - video is left out entirely rather than requested as false.
    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mediaStream.removeTrack).toHaveBeenCalledWith(endedTrack);
    expect(mediaStream.addTrack).toHaveBeenCalledWith(freshTrack);
    expect(mediaStream.getTracks()).toEqual([freshTrack]);
    expect(addSpy).toHaveBeenCalledWith(mediaStream, undefined);
  });

  test("does not re-acquire when every track is still live", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  test("derives re-acquisition constraints from track kinds when the application supplied the stream", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    // No constraints retained: the stream came from the application, not getUserMedia.
    const mediaStream = makeLiveStream("stream-1", [makeTrack("audio", "ended")]);
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [makeTrack("audio")] });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  test("drops DTMF senders from the closed peer connection before replaying", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });
    (brtc as any).localDtmfSenders.set(mediaStream.id, { insertDTMF: jest.fn(), canInsertDTMF: true });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect((brtc as any).localDtmfSenders.size).toBe(0);
  });

  test("reports a republish failure to the application instead of failing silently", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockRejectedValue(new Error("gateway said no"));

    const errorHandler = jest.fn();
    brtc.onError(errorHandler);

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    await expect(brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true)).resolves.toBeUndefined();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0][0].message).toContain("gateway said no");
  });

  test("reports a re-acquisition failure to the application", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const errorHandler = jest.fn();
    brtc.onError(errorHandler);

    const mediaStream = makeLiveStream("stream-1", [makeTrack("audio", "ended")]);
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });
    mockGetUserMedia.mockRejectedValue(new Error("NotAllowedError"));

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(offerSpy).not.toHaveBeenCalled();
  });

  test("carries over a muted track's enabled=false onto its replacement", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const mutedEndedTrack = makeTrack("audio", "ended", false);
    const mediaStream = makeLiveStream("stream-1", [mutedEndedTrack]);
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    const freshTrack = makeTrack("audio");
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [freshTrack] });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    expect(freshTrack.enabled).toBe(false);
  });

  test("skips a stream that was unpublished while its getUserMedia reacquire was pending", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const endedTrack = makeTrack("audio", "ended");
    const mediaStream = makeLiveStream("stream-1", [endedTrack]);
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    const freshTrack = makeTrack("audio");
    let resolveGetUserMedia!: () => void;
    mockGetUserMedia.mockReturnValue(
      new Promise((resolve) => {
        resolveGetUserMedia = () => resolve({ getTracks: () => [freshTrack] });
      }),
    );

    // isReconnect=true keeps this valid once init() only republishes on a reconnect (#18).
    const initPromise = (brtc as any).init({ publishSdpOffer: {}, subscribeSdpOffer: {} }, true);
    // Let reacquireEndedTracks start (and reach its getUserMedia await) before unpublishing
    // the stream out from under it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    (brtc as any).publishedStreams.delete(mediaStream.id);
    resolveGetUserMedia();

    await initPromise;

    // The freshly acquired track is live and would otherwise leak, so it must still be stopped.
    expect(freshTrack.stop).toHaveBeenCalledTimes(1);
    expect(addSpy).not.toHaveBeenCalled();
    expect(offerSpy).not.toHaveBeenCalled();
  });

  test("one stream's reacquisition failure does not block another stream's replay", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    const addSpy = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerSpy = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const errorHandler = jest.fn();
    brtc.onError(errorHandler);

    const brokenStream = makeLiveStream("stream-broken", [makeTrack("audio", "ended")]);
    const healthyStream = makeLiveStream("stream-healthy");
    (brtc as any).publishedStreams.set(brokenStream.id, { mediaStream: brokenStream });
    (brtc as any).publishedStreams.set(healthyStream.id, { mediaStream: healthyStream });
    mockGetUserMedia.mockRejectedValue(new Error("NotAllowedError"));

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true);

    // The healthy stream still gets attached and renegotiated...
    expect(addSpy).toHaveBeenCalledWith(healthyStream, undefined);
    expect(offerSpy).toHaveBeenCalledTimes(1);
    // ...and the broken one is skipped, not attached dead.
    expect(addSpy).not.toHaveBeenCalledWith(brokenStream, undefined);
    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  test("an onError handler that throws does not become an unhandled rejection", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockRejectedValue(new Error("gateway said no"));

    brtc.onError(() => {
      throw new Error("app handler blew up");
    });

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });

    await expect(brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any, true)).resolves.toBeUndefined();
  });

  test("concurrent init() calls are serialized rather than interleaved", async () => {
    const brtc = new BandwidthRtc();
    const order: string[] = [];
    let callNum = 0;
    (brtc as any).setupPeerConnection = jest.fn().mockImplementation(async () => {
      const n = ++callNum;
      order.push(`start-${n}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end-${n}`);
      return { connectionState: "connected", close: jest.fn() };
    });
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    await Promise.all([brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any), brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any)]);

    // setupPeerConnection is called twice per init() call (publish, then subscribe).
    // If the two init() calls ran concurrently, a later call's "start" could land
    // between an earlier call's "start" and "end". Serialized, every start/end pair
    // is contiguous regardless of which init() call it belongs to.
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3", "start-4", "end-4"]);
  });
});

describe("bandwidthRtcV1 connect method", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  test("should connect without error", async () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    await expect(
      bandwidthRtc.connect({
        endpointToken: "test-token",
      }),
    ).resolves.not.toThrow();
  });

  test("should set up event listeners after connecting", async () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    await bandwidthRtc.connect({
      endpointToken: "test-token",
    });

    // Access private signaling property via reflection
    const privateBandwidthRtc = bandwidthRtc as any;
    const signaling = privateBandwidthRtc.signaling;
    expect(signaling.on).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(signaling.on).toHaveBeenCalledWith("sdpOffer", expect.any(Function));
    expect(signaling.on).toHaveBeenCalledWith("init", expect.any(Function));
    expect(signaling.on).toHaveBeenCalledWith("fatalError", expect.any(Function));
  });

  test("forwards a fatal signaling error to the application error handler", () => {
    const bandwidthRtc = new BandwidthRtc("debug");
    const errorHandler = jest.fn();
    bandwidthRtc.onError(errorHandler);

    const error = new Error("Endpoint already has an active connection");
    (bandwidthRtc as any).handleError(error);

    expect(errorHandler).toHaveBeenCalledWith(error);
  });
});

describe("bandwidthRtcV1 retryIceOnFailed", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makePc(connectionState: string) {
    return { connectionState } as any as RTCPeerConnection;
  }

  test("does nothing when shouldRetry is false", async () => {
    const brtc = new BandwidthRtc();
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp");

    await (brtc as any).retryIceOnFailed(makePc("failed"), "publish", false);

    expect(offerPublishSdp).not.toHaveBeenCalled();
  });

  test("does not restart the publish connection when the subscribe connection failed", async () => {
    const brtc = new BandwidthRtc();
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp");

    await (brtc as any).retryIceOnFailed(makePc("failed"), "subscribe", true);

    expect(offerPublishSdp).not.toHaveBeenCalled();
  });

  test("re-offers once and stops once the publish connection recovers", async () => {
    const brtc = new BandwidthRtc();
    const pc = makePc("failed");
    // retryIceOnFailed only acts on the current publishing connection.
    (brtc as any).publishingPeerConnection = pc;
    jest.spyOn(brtc as any, "offerPublishSdp").mockImplementation(async () => {
      (pc as any).connectionState = "connected";
      return {} as any;
    });

    await (brtc as any).retryIceOnFailed(pc, "publish", true);

    expect((brtc as any).offerPublishSdp).toHaveBeenCalledTimes(1);
  });

  test("retries every 5s until the timeout elapses if still failed", async () => {
    const brtc = new BandwidthRtc();
    const pc = makePc("failed");
    (brtc as any).publishingPeerConnection = pc;
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue({} as any);

    const done = (brtc as any).retryIceOnFailed(pc, "publish", true);
    // Initial offer, then retries at 5s/10s/... up to the 30s timeout.
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);
    }
    await done;

    expect((brtc as any).offerPublishSdp).toHaveBeenCalledTimes(7);
  });

  test("does not throw when a retry's offerPublishSdp rejects", async () => {
    const brtc = new BandwidthRtc();
    const pc = makePc("failed");
    (brtc as any).publishingPeerConnection = pc;
    jest.spyOn(brtc as any, "offerPublishSdp").mockRejectedValue(new Error("signaling down"));

    const done = (brtc as any).retryIceOnFailed(pc, "publish", true);
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);
    }

    await expect(done).resolves.not.toThrow();
  });

  test("sends no offer when pc is no longer the publishing peer connection (e.g. init() replaced it)", async () => {
    const brtc = new BandwidthRtc();
    const pc = makePc("failed");
    // A different object is now the live publishing connection.
    (brtc as any).publishingPeerConnection = {};
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp");

    await (brtc as any).retryIceOnFailed(pc, "publish", true);

    expect(offerPublishSdp).not.toHaveBeenCalled();
  });
});

describe("bandwidthRtcV1 init on signaling reconnect", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  function makeMockStream(id: string) {
    return { id, getTracks: () => [] };
  }

  function makePreferencesResponse() {
    return {
      publishSdpOffer: { sdpOffer: "publish-offer" },
      subscribeSdpOffer: { sdpOffer: "subscribe-offer" },
    } as any;
  }

  test("first init does not close old peer connections or re-publish", async () => {
    const brtc = new BandwidthRtc();
    const setupPeerConnection = jest.spyOn(brtc as any, "setupPeerConnection").mockResolvedValue({ close: jest.fn() });
    const addStream = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection");
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue({});
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: makeMockStream("stream-1") });

    await brtc.init(makePreferencesResponse());

    expect(setupPeerConnection).toHaveBeenCalledTimes(2);
    expect(addStream).not.toHaveBeenCalled();
    expect(offerPublishSdp).not.toHaveBeenCalled();
  });

  test("reconnect closes stale peer connections and re-publishes existing streams", async () => {
    const brtc = new BandwidthRtc();
    const oldPublishPc = { close: jest.fn() };
    const oldSubscribePc = { close: jest.fn() };
    (brtc as any).publishingPeerConnection = oldPublishPc;
    (brtc as any).subscribingPeerConnection = oldSubscribePc;
    (brtc as any).subscribingPeerConnectionSdpRevision = 5;
    (brtc as any).subscribeTrackMetadata.set("track-1", { from: "someone" });
    (brtc as any).localDtmfSenders.set("stream-1", { insertDTMF: jest.fn() });

    const stream = makeMockStream("stream-1");
    (brtc as any).publishedStreams.set("stream-1", { mediaStream: stream });

    jest.spyOn(brtc as any, "setupPeerConnection").mockResolvedValue({ close: jest.fn(), connectionState: "connected" });
    const addStream = jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue({});

    await brtc.init(makePreferencesResponse(), true);

    expect(oldPublishPc.close).toHaveBeenCalledTimes(1);
    expect(oldSubscribePc.close).toHaveBeenCalledTimes(1);
    expect(addStream).toHaveBeenCalledWith(stream, undefined);
    expect(offerPublishSdp).toHaveBeenCalledTimes(1);
    expect((brtc as any).subscribingPeerConnectionSdpRevision).toBe(0);
    expect((brtc as any).subscribeTrackMetadata.size).toBe(0);
    expect((brtc as any).localDtmfSenders.size).toBe(0);
  });

  test("reconnect with no published streams does not re-offer", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = { close: jest.fn() };
    (brtc as any).subscribingPeerConnection = { close: jest.fn() };
    jest.spyOn(brtc as any, "setupPeerConnection").mockResolvedValue({ close: jest.fn() });
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue({});

    await brtc.init(makePreferencesResponse(), true);

    expect(offerPublishSdp).not.toHaveBeenCalled();
  });

  test("every init resets the publishing peer's ICE-restart revision, not only a reconnect", async () => {
    const brtc = new BandwidthRtc();
    jest.spyOn(brtc as any, "setupPeerConnection").mockResolvedValue({ close: jest.fn() });
    (brtc as any).publishingPeerConnectionSdpRevision = 3;

    await brtc.init(makePreferencesResponse());

    expect((brtc as any).publishingPeerConnectionSdpRevision).toBe(0);
  });
});

describe("bandwidthRtcV1 sdpOffer peerType routing", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  function makePc() {
    return {
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      createAnswer: jest.fn().mockResolvedValue({ sdp: "answer-sdp" }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  function withMockedAnswerSdp(brtc: BandwidthRtc) {
    const answerSdp = jest.fn().mockResolvedValue(undefined);
    (brtc as any).signaling.answerSdp = answerSdp;
    return answerSdp;
  }

  test("publish peerType offer is applied to the publishing connection and answered with answerSdp(sdp, publish); subscribing connection untouched", async () => {
    const brtc = new BandwidthRtc();
    const publishPc = makePc();
    const subscribePc = makePc();
    (brtc as any).publishingPeerConnection = publishPc;
    (brtc as any).subscribingPeerConnection = subscribePc;
    const answerSdp = withMockedAnswerSdp(brtc);

    await (brtc as any).handleSdpOffer({ peerType: "publish", sdpOffer: "offer-sdp", sdpRevision: 1 });

    expect(publishPc.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: "offer-sdp" });
    expect(publishPc.setLocalDescription).toHaveBeenCalledWith({ sdp: "answer-sdp" });
    expect(answerSdp).toHaveBeenCalledWith("answer-sdp", "publish");
    expect(subscribePc.setRemoteDescription).not.toHaveBeenCalled();
  });

  test.each([["subscribe"], [undefined]])("peerType %s routes to the subscribing connection (existing behaviour)", async (peerType) => {
    const brtc = new BandwidthRtc();
    const publishPc = makePc();
    const subscribePc = makePc();
    (brtc as any).publishingPeerConnection = publishPc;
    (brtc as any).subscribingPeerConnection = subscribePc;
    const answerSdp = withMockedAnswerSdp(brtc);

    await (brtc as any).handleSdpOffer({ peerType, sdpOffer: "offer-sdp", sdpRevision: 1 });

    expect(subscribePc.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: "offer-sdp" });
    expect(answerSdp).toHaveBeenCalledWith("answer-sdp", "subscribe");
    expect(publishPc.setRemoteDescription).not.toHaveBeenCalled();
  });

  test("a publish offer with a revision <= the last applied one is ignored", async () => {
    const brtc = new BandwidthRtc();
    const publishPc = makePc();
    (brtc as any).publishingPeerConnection = publishPc;
    (brtc as any).publishingPeerConnectionSdpRevision = 2;
    withMockedAnswerSdp(brtc);

    await (brtc as any).handleSdpOffer({ peerType: "publish", sdpOffer: "offer-sdp", sdpRevision: 2 });

    expect(publishPc.setRemoteDescription).not.toHaveBeenCalled();
  });

  test("init resets the publish revision, so a revision-1 offer is applied again after a second init", async () => {
    const brtc = new BandwidthRtc();
    jest.spyOn(brtc as any, "setupPeerConnection").mockResolvedValue({ close: jest.fn() });
    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);
    // Simulate a restart already applied on the first publishing connection.
    (brtc as any).publishingPeerConnectionSdpRevision = 1;

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);
    expect((brtc as any).publishingPeerConnectionSdpRevision).toBe(0);

    const publishPc = makePc();
    (brtc as any).publishingPeerConnection = publishPc;
    withMockedAnswerSdp(brtc);

    await (brtc as any).handleSdpOffer({ peerType: "publish", sdpOffer: "offer-sdp", sdpRevision: 1 });

    expect(publishPc.setRemoteDescription).toHaveBeenCalled();
  });

  test("a publish offer waits for an in-flight publish negotiation holding publishMutex", async () => {
    const brtc = new BandwidthRtc();
    const publishPc = makePc();
    (brtc as any).publishingPeerConnection = publishPc;
    withMockedAnswerSdp(brtc);

    let releaseMutex: () => void = () => {};
    const heldMutexTask = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    const mutexPromise = (brtc as any).publishMutex.runExclusive(() => heldMutexTask);

    const offerPromise = (brtc as any).handleSdpOffer({ peerType: "publish", sdpOffer: "offer-sdp", sdpRevision: 1 });

    // Give handleSdpOffer a chance to run; it should still be blocked on the mutex.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(publishPc.setRemoteDescription).not.toHaveBeenCalled();

    releaseMutex();
    await mutexPromise;
    await offerPromise;

    expect(publishPc.setRemoteDescription).toHaveBeenCalled();
  });
});

describe("bandwidthRtcV1 onconnectionstatechange wiring", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  test("connection 'failed' does not send an offer (retry disabled)", async () => {
    const brtc = new BandwidthRtc();
    const fakePc: any = { connectionState: "connected" };
    jest.spyOn(brtc as any, "createPeerConnection").mockReturnValue(fakePc);
    const offerPublishSdp = jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue({});

    await (brtc as any).setupPeerConnection("publish", () => {});
    (brtc as any).publishingPeerConnection = fakePc;

    fakePc.connectionState = "failed";
    await fakePc.onconnectionstatechange({ target: fakePc });

    expect(offerPublishSdp).not.toHaveBeenCalled();
  });
});

describe("bandwidthRtcV1 getCallStats", () => {
  const report = (entries: any[]) => new Map(entries.map((e) => [e.id, e]));
  const subReport = report([
    { id: "in", type: "inbound-rtp", kind: "audio", packetsReceived: 10, packetsLost: 1, bytesReceived: 2000, jitter: 0.01, audioLevel: 0.5, codecId: "c" },
    { id: "c", type: "codec", mimeType: "audio/opus" },
    { id: "cp", type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.05 },
  ]);
  const pubReport = report([
    { id: "out", type: "outbound-rtp", kind: "audio", packetsSent: 20, bytesSent: 4000 },
    { id: "r", type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.1, jitter: 0.02, roundTripTime: 0.08 },
  ]);
  const setup = (sub: any, pub: any) => {
    const brtc = new BandwidthRtc();
    (brtc as any).subscribingPeerConnection = sub && { getStats: sub };
    (brtc as any).publishingPeerConnection = pub && { getStats: pub };
    return brtc;
  };

  test("parses both reports including RTCP fields", async () => {
    const snap = await setup(jest.fn().mockResolvedValue(subReport), jest.fn().mockResolvedValue(pubReport)).getCallStats();
    expect(snap).toMatchObject({
      packetsReceived: 10,
      packetsLost: 1,
      bytesReceived: 2000,
      jitter: 0.01,
      audioLevel: 0.5,
      roundTripTime: 0.05,
      codec: "opus",
      packetsSent: 20,
      bytesSent: 4000,
      remoteFractionLost: 0.1,
      remoteJitter: 0.02,
      rtcpRoundTripTime: 0.08,
      inboundBitrate: 0,
      outboundBitrate: 0,
    });
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  test("computes bitrate from previous snapshot and clamps negative deltas", async () => {
    const brtc = setup(jest.fn().mockResolvedValue(subReport), jest.fn().mockResolvedValue(pubReport));
    const now = Date.now() / 1000;
    const prev: any = { bytesReceived: 1000, bytesSent: 9000, timestamp: now - 2 };
    const snap = await brtc.getCallStats(prev);
    expect(snap.inboundBitrate).toBeCloseTo(4000, -2);
    expect(snap.outboundBitrate).toBe(0);
  });

  test("sums counters across audio streams and keeps the worst quality values", async () => {
    const sub = report([
      { id: "in1", type: "inbound-rtp", kind: "audio", packetsReceived: 10, packetsLost: 1, bytesReceived: 2000, jitter: 0.01, audioLevel: 0.5, codecId: "c" },
      { id: "in2", type: "inbound-rtp", kind: "audio", packetsReceived: 5, packetsLost: 2, bytesReceived: 1000, jitter: 0.03, audioLevel: 0.2 },
      { id: "c", type: "codec", mimeType: "audio/opus" },
    ]);
    const pub = report([
      { id: "out1", type: "outbound-rtp", kind: "audio", packetsSent: 20, bytesSent: 4000 },
      { id: "out2", type: "outbound-rtp", kind: "audio", packetsSent: 7, bytesSent: 900 },
      { id: "r1", type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.1, jitter: 0.02, roundTripTime: 0.08 },
      { id: "r2", type: "remote-inbound-rtp", kind: "audio", fractionLost: 0.3, jitter: 0.01, roundTripTime: 0.2 },
    ]);
    const snap = await setup(jest.fn().mockResolvedValue(sub), jest.fn().mockResolvedValue(pub)).getCallStats();
    expect(snap).toMatchObject({
      packetsReceived: 15,
      packetsLost: 3,
      bytesReceived: 3000,
      jitter: 0.03,
      audioLevel: 0.5,
      codec: "opus",
      packetsSent: 27,
      bytesSent: 4900,
      remoteFractionLost: 0.3,
      remoteJitter: 0.02,
      rtcpRoundTripTime: 0.2,
    });
  });

  test("takes roundTripTime from the transport's selected candidate pair", async () => {
    const sub = report([
      { id: "active", type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.05 },
      { id: "t", type: "transport", selectedCandidatePairId: "active" },
      { id: "other", type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.9 },
    ]);
    const snap = await setup(jest.fn().mockResolvedValue(sub), undefined).getCallStats();
    expect(snap.roundTripTime).toBe(0.05);
  });

  test("ignores candidate pairs that are not nominated or selected", async () => {
    const sub = report([
      { id: "a", type: "candidate-pair", state: "succeeded", selected: true, currentRoundTripTime: 0.05 },
      { id: "b", type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.9 },
    ]);
    const snap = await setup(jest.fn().mockResolvedValue(sub), undefined).getCallStats();
    expect(snap.roundTripTime).toBe(0.05);
  });

  test("returns defaults when peer connections are undefined", async () => {
    const snap = await setup(undefined, undefined).getCallStats();
    expect(snap.codec).toBe("unknown");
    expect(snap.packetsReceived).toBe(0);
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  test("keeps defaults for a side whose getStats rejects", async () => {
    const snap = await setup(jest.fn().mockRejectedValue(new Error("boom")), jest.fn().mockResolvedValue(pubReport)).getCallStats();
    expect(snap.packetsReceived).toBe(0);
    expect(snap.bytesSent).toBe(4000);
  });
});

describe("bandwidthRtcV1 call stats trace", () => {
  const TRACE_INTERVAL_MS = 5 * 60 * 1000;
  const pc = () => ({ getStats: jest.fn().mockResolvedValue(new Map()), close: jest.fn() });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const traceCalls = () => (logger.debug as jest.Mock).mock.calls.filter(([msg]) => msg === "Call stats");

  test("logs a snapshot every 5 minutes after connect", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });

    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS - 1);
    expect(traceCalls()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(traceCalls()).toHaveLength(1);
    expect(traceCalls()[0][1]).toMatchObject({ codec: "unknown", rtcpRoundTripTime: 0 });
    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
    expect(traceCalls()).toHaveLength(2);
    brtc.disconnect();
  });

  test("stops tracing after disconnect", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });
    brtc.disconnect();

    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS * 2);
    expect(traceCalls()).toHaveLength(0);
  });

  test("skips the trace while no peer connection exists", async () => {
    const brtc = new BandwidthRtc();
    await brtc.connect({ endpointToken: "t" });

    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
    expect(traceCalls()).toHaveLength(0);
    brtc.disconnect();
  });

  const finalCalls = () => (logger.debug as jest.Mock).mock.calls.filter(([msg]) => String(msg).startsWith("Final call stats"));
  const fireSignaling = (brtc: BandwidthRtc, event: string) => (brtc as any).signaling.on.mock.calls.find(([name]: [string]) => name === event)[1]();

  test("logs a final snapshot on disconnect, read before the peer connection closes", async () => {
    const brtc = new BandwidthRtc();
    const publishing = pc();
    (brtc as any).publishingPeerConnection = publishing;
    await brtc.connect({ endpointToken: "t" });

    brtc.disconnect();
    expect(publishing.getStats.mock.invocationCallOrder[0]).toBeLessThan(publishing.close.mock.invocationCallOrder[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(finalCalls()).toHaveLength(1);
    expect(finalCalls()[0][0]).toBe("Final call stats (disconnect)");
  });

  test("logs a final snapshot when the signaling socket closes without disconnect()", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });

    fireSignaling(brtc, "disconnected");
    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS * 2);
    expect(finalCalls()).toHaveLength(1);
    expect(finalCalls()[0][0]).toBe("Final call stats (signaling disconnected)");
    expect(traceCalls()).toHaveLength(0);
  });

  test("logs the final snapshot once when disconnect() is followed by the signaling event", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });

    brtc.disconnect();
    fireSignaling(brtc, "disconnected");
    await jest.advanceTimersByTimeAsync(0);
    expect(finalCalls()).toHaveLength(1);
  });

  test("a connect() that replaces a live session labels the final snapshot as connect", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });

    const signaling = (brtc as any).signaling;
    signaling.connect.mockImplementationOnce(async () => fireSignaling(brtc, "disconnected"));
    await brtc.connect({ endpointToken: "t" });
    await jest.advanceTimersByTimeAsync(0);
    expect(finalCalls().map(([msg]) => msg)).toEqual(["Final call stats (connect)"]);
    brtc.disconnect();
  });

  test("logs nothing when the call ends before a trace started", async () => {
    const brtc = new BandwidthRtc();
    brtc.disconnect();
    await jest.advanceTimersByTimeAsync(0);
    expect(finalCalls()).toHaveLength(0);
  });

  test("reports a failed final read instead of dropping it", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = { getStats: jest.fn().mockRejectedValue(new Error("closed")), close: jest.fn() };
    await brtc.connect({ endpointToken: "t" });

    brtc.disconnect();
    await jest.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("getCallStats: publishing getStats failed", expect.any(Error));
    expect(finalCalls()[0][0]).toBe("Final call stats (disconnect) (incomplete)");
  });

  test("does not use a failed read as the next bitrate baseline", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    const brtc = new BandwidthRtc();
    const getStats = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(new Map());
    (brtc as any).publishingPeerConnection = { getStats, close: jest.fn() };
    await brtc.connect({ endpointToken: "t" });

    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
    expect((brtc as any).lastTracedCallStats).toBeUndefined();
    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
    expect((brtc as any).lastTracedCallStats).toBeDefined();
    brtc.disconnect();
  });

  test("a new connect() starts without the previous call's snapshot", async () => {
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = pc();
    await brtc.connect({ endpointToken: "t" });
    await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
    expect((brtc as any).lastTracedCallStats).toBeDefined();

    brtc.disconnect();
    await brtc.connect({ endpointToken: "t" });
    expect((brtc as any).lastTracedCallStats).toBeUndefined();
    brtc.disconnect();
  });

  describe("in-call trace", () => {
    const IN_CALL_INTERVAL_MS = 10 * 1000;
    const inCallCalls = () => (logger.debug as jest.Mock).mock.calls.filter(([msg]) => msg === "In-call stats");
    const finalInCallCalls = () => (logger.debug as jest.Mock).mock.calls.filter(([msg]) => String(msg).startsWith("Final in-call stats"));

    // Connects and runs init() with a mocked setupPeerConnection, capturing the subscribe ontrack handler
    const setup = async () => {
      const brtc = new BandwidthRtc();
      let onTrack: (event: any) => void = () => {};
      jest.spyOn(brtc as any, "setupPeerConnection").mockImplementation(async (...args: any[]) => {
        if (args[0] === "subscribe") {
          onTrack = args[1];
        }
        return pc();
      });
      await brtc.connect({ endpointToken: "t" });
      await brtc.init({ publishSdpOffer: { sdpOffer: "p" }, subscribeSdpOffer: { sdpOffer: "s" } } as any);
      return { brtc, startCall: (id: string) => startCall(onTrack, id) };
    };

    const startCall = (onTrack: (event: any) => void, id: string) => {
      const stream: any = { id };
      const track = { id: `track-${id}` };
      onTrack({ track, streams: [stream] });
      return { end: () => stream.onremovetrack({ track }) };
    };

    test("does not trace before a call stream is available", async () => {
      const { brtc } = await setup();

      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS * 3);
      expect(inCallCalls()).toHaveLength(0);
      expect(finalInCallCalls()).toHaveLength(0);
      brtc.disconnect();
    });

    test("logs every 10 seconds while a call stream is active, then a final snapshot when it ends", async () => {
      const { brtc, startCall } = await setup();
      const call = startCall("call-1");

      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS - 1);
      expect(inCallCalls()).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(inCallCalls()).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS);
      expect(inCallCalls()).toHaveLength(2);

      call.end();
      await jest.advanceTimersByTimeAsync(0);
      expect(finalInCallCalls().map(([msg]) => msg)).toEqual(["Final in-call stats (call ended)"]);
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS * 3);
      expect(inCallCalls()).toHaveLength(2);
      brtc.disconnect();
    });

    test("keeps tracing until the last of several concurrent call streams ends", async () => {
      const { brtc, startCall } = await setup();
      const first = startCall("call-1");
      const second = startCall("call-2");

      first.end();
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS);
      expect(finalInCallCalls()).toHaveLength(0);
      expect(inCallCalls()).toHaveLength(1);

      second.end();
      await jest.advanceTimersByTimeAsync(0);
      expect(finalInCallCalls()).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS * 3);
      expect(inCallCalls()).toHaveLength(1);
      brtc.disconnect();
    });

    test("starts a fresh trace for the next call", async () => {
      const { brtc, startCall } = await setup();
      startCall("call-1").end();
      startCall("call-2");

      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS);
      expect(inCallCalls()).toHaveLength(1);
      brtc.disconnect();
    });

    test("disconnect during a call logs one final snapshot, read before the peer connection closes", async () => {
      const { brtc, startCall } = await setup();
      startCall("call-1");
      const subscribing = (brtc as any).subscribingPeerConnection;

      brtc.disconnect();
      expect(subscribing.getStats.mock.invocationCallOrder[0]).toBeLessThan(subscribing.close.mock.invocationCallOrder[0]);
      fireSignaling(brtc, "disconnected");
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS * 3);
      expect(finalInCallCalls().map(([msg]) => msg)).toEqual(["Final in-call stats (disconnect)"]);
      expect(inCallCalls()).toHaveLength(0);
      expect((brtc as any).activeCallStreamIds.size).toBe(0);
    });

    test("a reconnect during a call logs a final snapshot before the old peer connections close", async () => {
      const { brtc, startCall } = await setup();
      startCall("call-1");
      const oldPublishing = (brtc as any).publishingPeerConnection;

      await brtc.init({ publishSdpOffer: { sdpOffer: "p" }, subscribeSdpOffer: { sdpOffer: "s" } } as any, true);
      expect(oldPublishing.getStats.mock.invocationCallOrder[0]).toBeLessThan(oldPublishing.close.mock.invocationCallOrder[0]);
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS * 3);
      expect(finalInCallCalls().map(([msg]) => msg)).toEqual(["Final in-call stats (reconnect)"]);
      expect(inCallCalls()).toHaveLength(0);
      expect((brtc as any).activeCallStreamIds.size).toBe(0);
      brtc.disconnect();
    });

    describe("final snapshot across a subscribe re-offer", () => {
      const inboundReport = new Map<string, any>([
        ["in", { id: "in", type: "inbound-rtp", kind: "audio", packetsReceived: 500, bytesReceived: 80000, jitter: 0.02, codecId: "c" }],
        ["c", { id: "c", type: "codec", mimeType: "audio/opus" }],
      ]);
      let revision = 0;

      // Swaps in a subscribing connection whose inbound stats vanish once setRemoteDescription runs, as when the gateway removes the call's track
      const setupReOffer = async () => {
        const { brtc, startCall } = await setup();
        const pcMock: any = {
          getStats: jest.fn().mockResolvedValue(inboundReport),
          close: jest.fn(),
          createAnswer: jest.fn().mockResolvedValue({ sdp: "answer-sdp" }),
          setLocalDescription: jest.fn().mockResolvedValue(undefined),
          setRemoteDescription: jest.fn().mockImplementation(async () => {
            pcMock.getStats.mockResolvedValue(new Map());
            pcMock.onSetRemoteDescription?.();
          }),
        };
        (brtc as any).subscribingPeerConnection = pcMock;
        (brtc as any).signaling.answerSdp = jest.fn().mockResolvedValue(undefined);
        const reOffer = () => (brtc as any).handleSdpOffer({ peerType: "subscribe", sdpOffer: "offer", sdpRevision: ++revision });
        return { brtc, startCall, pcMock, reOffer };
      };

      beforeEach(() => {
        revision = 0;
      });

      test("logs the snapshot read before the re-offer, which carries the call's inbound counters", async () => {
        const { brtc, startCall, pcMock, reOffer } = await setupReOffer();
        const call = startCall("call-1");
        pcMock.onSetRemoteDescription = () => call.end();

        await reOffer();

        expect(finalInCallCalls()).toHaveLength(1);
        expect(finalInCallCalls()[0][0]).toBe("Final in-call stats (call ended)");
        expect(finalInCallCalls()[0][1]).toMatchObject({ packetsReceived: 500, bytesReceived: 80000, jitter: 0.02, codec: "opus" });
        expect(pcMock.getStats.mock.invocationCallOrder[0]).toBeLessThan(pcMock.setRemoteDescription.mock.invocationCallOrder[0]);
        expect((brtc as any).preRenegotiationCallStats).toBeUndefined();
        brtc.disconnect();
      });

      test("falls back to a fresh read when the pre-offer read was incomplete", async () => {
        jest.spyOn(logger, "warn").mockImplementation(() => {});
        const { brtc, startCall, pcMock, reOffer } = await setupReOffer();
        const call = startCall("call-1");
        pcMock.onSetRemoteDescription = () => call.end();
        pcMock.getStats.mockRejectedValueOnce(new Error("boom"));

        await reOffer();
        await jest.advanceTimersByTimeAsync(0);

        expect(finalInCallCalls()).toHaveLength(1);
        expect(finalInCallCalls()[0][1]).toMatchObject({ packetsReceived: 0, codec: "unknown" });
        brtc.disconnect();
      });

      test("does not read stats on a subscribe offer when no in-call trace is running", async () => {
        const { brtc, pcMock, reOffer } = await setupReOffer();

        await reOffer();

        expect(pcMock.getStats).not.toHaveBeenCalled();
        expect(pcMock.setRemoteDescription).toHaveBeenCalledTimes(1);
        expect((brtc as any).preRenegotiationCallStats).toBeUndefined();
        brtc.disconnect();
      });

      test("a stash from one call is not used by a later call", async () => {
        const { brtc, startCall, pcMock, reOffer } = await setupReOffer();
        const first = startCall("call-1");
        // The offer is applied but the call keeps going, so the stash is left behind
        await reOffer();
        expect((brtc as any).preRenegotiationCallStats).toMatchObject({ packetsReceived: 500 });

        first.end();
        await jest.advanceTimersByTimeAsync(0);
        (logger.debug as jest.Mock).mockClear();

        startCall("call-2");
        expect((brtc as any).preRenegotiationCallStats).toBeUndefined();
        brtc.disconnect();
        await jest.advanceTimersByTimeAsync(0);
        expect(finalInCallCalls().map(([msg]) => msg)).toEqual(["Final in-call stats (disconnect)"]);
        expect(pcMock.getStats).toHaveBeenCalled();
      });

      test("disconnect during a call still does a fresh final read despite a stashed snapshot", async () => {
        const { brtc, startCall, pcMock, reOffer } = await setupReOffer();
        startCall("call-1");
        await reOffer();
        expect((brtc as any).preRenegotiationCallStats).toBeDefined();
        pcMock.getStats.mockClear();

        brtc.disconnect();
        await jest.advanceTimersByTimeAsync(0);

        // The 5-minute trace also reads on disconnect, so only the logged value shows the in-call read was fresh
        expect(finalInCallCalls().map(([msg]) => msg)).toEqual(["Final in-call stats (disconnect)"]);
        expect(finalInCallCalls()[0][1]).toMatchObject({ packetsReceived: 0 });
      });
    });

    test("does not use a failed read as the next bitrate baseline", async () => {
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const { brtc, startCall } = await setup();
      (brtc as any).publishingPeerConnection.getStats.mockRejectedValueOnce(new Error("boom"));
      startCall("call-1");

      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS);
      expect((brtc as any).lastInCallTracedStats).toBeUndefined();
      await jest.advanceTimersByTimeAsync(IN_CALL_INTERVAL_MS);
      expect((brtc as any).lastInCallTracedStats).toBeDefined();
      brtc.disconnect();
    });

    test("the 5-minute trace still fires during a call, independently of the in-call trace", async () => {
      const { brtc, startCall } = await setup();
      startCall("call-1");

      await jest.advanceTimersByTimeAsync(TRACE_INTERVAL_MS);
      expect(traceCalls()).toHaveLength(1);
      expect(inCallCalls()).toHaveLength(TRACE_INTERVAL_MS / IN_CALL_INTERVAL_MS);
      expect((brtc as any).lastTracedCallStats).toBeDefined();
      brtc.disconnect();
    });
  });
});
