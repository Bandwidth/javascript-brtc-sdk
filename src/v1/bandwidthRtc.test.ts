import { BandwidthRtc } from "./bandwidthRtc";
import { setupMocks, setupNavigatorMocks } from "../mocks";

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

describe("bandwidthRtcV1 init reconnect replay", () => {
  // init() only needs a stand-in RTCPeerConnection; the real negotiation performed by
  // setupPeerConnection is exercised elsewhere. Defaults to already connected so the
  // republish path's ICE wait resolves immediately; pass a mutable object with a different
  // connectionState to exercise that wait itself.
  function stubSetupPeerConnection(brtc: BandwidthRtc, pc: any = { connectionState: "connected" }) {
    (brtc as any).setupPeerConnection = jest.fn().mockResolvedValue(pc);
    return pc;
  }

  function makeTrack(kind: string, readyState: string = "live") {
    return { kind, id: `${kind}-track`, readyState, stop: jest.fn() };
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
    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

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

    const initPromise = brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);
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

    const initPromise = brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);
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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

    expect(addSpy).toHaveBeenCalledWith(mediaStream, codecPreferences);
  });

  test("publish retains codec preferences and constraints for a later replay", async () => {
    const { mockGetUserMedia } = setupNavigatorMocks();
    setupMocks();
    const brtc = new BandwidthRtc();
    (brtc as any).publishingPeerConnection = {};
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

    // Re-acquired from the same constraints, swapped into the same MediaStream the
    // application already holds, and the dead track dropped.
    expect(mockGetUserMedia).toHaveBeenCalledWith(constraints);
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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  test("drops DTMF senders from the closed peer connection before replaying", async () => {
    const brtc = new BandwidthRtc();
    stubSetupPeerConnection(brtc);
    jest.spyOn(brtc as any, "addStreamToPublishingPeerConnection").mockImplementation(() => {});
    jest.spyOn(brtc as any, "offerPublishSdp").mockResolvedValue(undefined);

    const mediaStream = makeLiveStream("stream-1");
    (brtc as any).publishedStreams.set(mediaStream.id, { mediaStream });
    (brtc as any).localDtmfSenders.set(mediaStream.id, { insertDTMF: jest.fn(), canInsertDTMF: true });

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

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

    await expect(brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any)).resolves.toBeUndefined();

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

    await brtc.init({ publishSdpOffer: {}, subscribeSdpOffer: {} } as any);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(offerSpy).not.toHaveBeenCalled();
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
