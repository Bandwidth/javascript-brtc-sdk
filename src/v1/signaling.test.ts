import Signaling from "./signaling";
import { DiagnosticsBatcher } from "./diagnostics";
import { EndpointType } from "../types";

// Mock rpc-websockets
jest.mock("rpc-websockets", () => {
  return {
    Client: jest.fn().mockImplementation(() => {
      const mockClient = {
        on: jest.fn((event: string, callback: Function) => {
          // Automatically trigger 'ready' event for successful connections
          if (event === "ready") {
            setTimeout(() => callback({ endpointId: "test-endpoint" }), 0);
          }
        }),
        call: jest.fn().mockResolvedValue({}),
        notify: jest.fn().mockResolvedValue({}),
        close: jest.fn(),
        setAutoReconnect: jest.fn(),
        removeAllListeners: jest.fn(),
      };
      return mockClient;
    }),
  };
});

describe("Signaling constructor", () => {
  test("should create instance without diagnosticsBatcher", () => {
    const signaling = new Signaling();
    expect(signaling).toBeDefined();
    expect(signaling).toBeInstanceOf(Signaling);
  });

  test("should create instance with diagnosticsBatcher", () => {
    const diagnosticsBatcher = new DiagnosticsBatcher();
    const signaling = new Signaling(diagnosticsBatcher);
    expect(signaling).toBeDefined();
    expect(signaling).toBeInstanceOf(Signaling);
  });

  test("should set up diagnostics listener when diagnosticsBatcher is provided", () => {
    const diagnosticsBatcher = new DiagnosticsBatcher();
    const onSpy = jest.spyOn(diagnosticsBatcher, "on");

    new Signaling(diagnosticsBatcher);

    expect(onSpy).toHaveBeenCalledWith("diagnostics", expect.any(Function));
  });

  test("should not set up diagnostics listener when diagnosticsBatcher is not provided", () => {
    const signaling = new Signaling();
    expect(signaling).toBeDefined();
    // Should not throw or have any issues
  });
});

describe("Signaling connect method", () => {
  let signaling: Signaling;
  beforeEach(() => {
    signaling = new Signaling();
  });

  test("should connect without options", async () => {
    await expect(signaling.connect({ endpointToken: "test-token" })).resolves.not.toThrow();
  });

  test("should connect with options", async () => {
    const options = { websocketUrl: "wss://custom-url" };
    await expect(signaling.connect({ endpointToken: "test-token" }, options)).resolves.not.toThrow();
  });

  test("should set up event emitters correctly after connect", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // The 'ready' event should have been emitted due to our mock
    expect(emitSpy).toHaveBeenCalledWith("ready", { endpointId: "test-endpoint" });
  });

  test("should emit sdpOffer when websocket receives sdpOffer", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // Get the websocket instance and trigger sdpOffer event
    const ws = (signaling as any).ws;
    const sdpOfferCallback = ws.on.mock.calls.find((call: any) => call[0] === "sdpOffer")?.[1];

    if (sdpOfferCallback) {
      const testEvent = { sdp: "test-sdp-offer" };
      sdpOfferCallback(testEvent);
      expect(emitSpy).toHaveBeenCalledWith("sdpOffer", testEvent);
    }
  });

  test("should emit ready with connectStatus fields when gateway sends ready with connect status data", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // Simulate a second ready event from the gateway that includes connect status fields
    const ws = (signaling as any).ws;
    const readyCallback = ws.on.mock.calls.find((call: any) => call[0] === "ready")?.[1];

    if (readyCallback) {
      const readyWithConnectStatus = {
        endpointId: "test-endpoint",
        deviceId: "device-1",
        territory: "US",
        region: "us-east-1",
        connectStatus: "COMPLETED",
        accountId: "9900000",
        sessionId: "session-1",
        from: "ep-1",
        fromType: "ENDPOINT",
        fromTags: "tag1",
        to: "ep-2",
        toType: "ENDPOINT",
        toTags: "tag2",
      };
      readyCallback(readyWithConnectStatus);
      expect(emitSpy).toHaveBeenCalledWith(
        "ready",
        expect.objectContaining({
          endpointId: "test-endpoint",
          connectStatus: "COMPLETED",
          accountId: "9900000",
          sessionId: "session-1",
          from: "ep-1",
          fromType: "ENDPOINT",
          fromTags: "tag1",
          to: "ep-2",
          toType: "ENDPOINT",
          toTags: "tag2",
        }),
      );
    }
  });
});

describe("Signaling websocket event handlers", () => {
  let signaling: Signaling;
  beforeEach(async () => {
    signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });
  });

  function getWsCallback(event: string) {
    const ws = (signaling as any).ws;
    return ws.on.mock.calls.find((call: any) => call[0] === event)?.[1];
  }

  test("should emit init and set up ping interval on open", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");
    const openCallback = getWsCallback("open");
    expect(openCallback).toBeDefined();

    await openCallback();

    expect(emitSpy).toHaveBeenCalledWith("init", expect.anything());
    expect((signaling as any).pingInterval).toBeDefined();
  });

  test("should reject with error and disconnect on 403 error", async () => {
    const errorCallback = getWsCallback("error");
    expect(errorCallback).toBeDefined();

    const ws = (signaling as any).ws;
    errorCallback({ message: "Unexpected server response: 403" });

    expect(ws.close).toHaveBeenCalledWith(403);
    expect(ws.setAutoReconnect).toHaveBeenCalledWith(false);
  });

  test("should handle non-403 error without throwing", async () => {
    const errorCallback = getWsCallback("error");
    expect(errorCallback).toBeDefined();

    // Should not throw on a generic error
    expect(() => errorCallback({ message: "some other error" })).not.toThrow();

    // ws should not be closed on non-403 errors
    const ws = (signaling as any).ws;
    expect(ws.setAutoReconnect).not.toHaveBeenCalled();
  });

  test("should clear ping interval and set isReady false on close", async () => {
    // Trigger open first to set up pingInterval
    const openCallback = getWsCallback("open");
    await openCallback();

    const closeCallback = getWsCallback("close");
    expect(closeCallback).toBeDefined();

    closeCallback(4000);

    expect((signaling as any).isReady).toBe(false);
  });

  test("should call _disconnect on close with code 1000", async () => {
    const closeCallback = getWsCallback("close");
    expect(closeCallback).toBeDefined();

    closeCallback(1000);

    // After _disconnect(false), ws should be null
    expect((signaling as any).ws).toBeNull();
    expect((signaling as any).isReady).toBe(false);
  });
});

describe("Signaling disconnect", () => {
  test("should call leave notification and close ws on disconnect", async () => {
    const signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });

    const ws = (signaling as any).ws;
    signaling.disconnect();

    expect(ws.notify).toHaveBeenCalledWith("leave");
    expect(ws.close).toHaveBeenCalled();
    expect(ws.removeAllListeners).toHaveBeenCalled();
    expect((signaling as any).ws).toBeNull();
    expect((signaling as any).isReady).toBe(false);
  });

  test("should handle disconnect with diagnosticsBatcher", async () => {
    const diagnosticsBatcher = new DiagnosticsBatcher();
    const shutdownSpy = jest.spyOn(diagnosticsBatcher, "shutdown");
    const signaling = new Signaling(diagnosticsBatcher);
    await signaling.connect({ endpointToken: "test-token" });

    signaling.disconnect();

    expect(shutdownSpy).toHaveBeenCalled();
    expect((signaling as any).ws).toBeNull();
  });

  test("should not throw when disconnect called without active ws", () => {
    const signaling = new Signaling();
    // Never connected, ws is null
    expect(() => signaling.disconnect()).not.toThrow();
  });
});

describe("Signaling test all the smaller functions", () => {
  let signaling: Signaling;
  beforeEach(async () => {
    signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });
  });

  test("should call disconnect without error", () => {
    expect(() => signaling.disconnect()).not.toThrow();
  });

  test("should requestOutboundConnection without error", async () => {
    await expect(signaling.requestOutboundConnection("endpoint-id", EndpointType.ENDPOINT)).resolves.toBeDefined();
  });

  test("should hangupConnection without error", async () => {
    await expect(signaling.hangupConnection("endpoint-id", EndpointType.ENDPOINT)).resolves.toBeDefined();
  });

  test("should answerSdp without error", async () => {
    await expect(signaling.answerSdp("sdp-offer-id", "sdp-answer")).resolves.toBeDefined();
  });

  test("should offerSdp without error", async () => {
    await expect(signaling.offerSdp("peer-type", "sdp-offer")).resolves.toBeDefined();
  });

  test("should send diagnostics without error", async () => {
    await expect((signaling as any).sendDiagnostics({ logs: [{ level: "info", message: "test-log" }] })).resolves.not.toThrow();
  });

  test("should setMediaPreferences without error", async () => {
    await expect((signaling as any).setMediaPreferences({ video: { maxBitrate: 1000, maxFramerate: 30 } })).resolves.not.toThrow();
  });
});
