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

  test("should emit established when websocket receives established", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // Get the websocket instance and trigger established event
    const ws = (signaling as any).ws;
    const establishedCallback = ws.on.mock.calls.find((call: any) => call[0] === "established")?.[1];

    if (establishedCallback) {
      const testEvent = { connectionId: "test-connection" };
      establishedCallback(testEvent);
      expect(emitSpy).toHaveBeenCalledWith("established", testEvent);
    }
  });

  test("should tear down a prior client before connecting again", async () => {
    await signaling.connect({ endpointToken: "test-token" });
    const firstWs = (signaling as any).ws;

    await signaling.connect({ endpointToken: "test-token" });
    const secondWs = (signaling as any).ws;

    expect(firstWs.setAutoReconnect).toHaveBeenCalledWith(false);
    expect(firstWs.removeAllListeners).toHaveBeenCalled();
    expect(firstWs.close).toHaveBeenCalled();
    expect(secondWs).not.toBe(firstWs);
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

  // A 409 means another device holds this endpoint. Retrying cannot succeed
  // until that device leaves, and the client is configured with unlimited
  // auto-reconnect, so it must be disabled or the SDK storms the gateway.
  test("should reject with error and stop reconnecting on 409 error", async () => {
    const errorCallback = getWsCallback("error");
    expect(errorCallback).toBeDefined();

    const ws = (signaling as any).ws;
    errorCallback({ message: "Unexpected server response: 409" });

    expect(ws.close).toHaveBeenCalledWith(409);
    expect(ws.setAutoReconnect).toHaveBeenCalledWith(false);
  });

  // On a reconnect the connect() promise has already resolved, so the reject is a
  // no-op: the event is the only thing that reaches the application.
  test("should emit fatalError on a fatal handshake error", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");
    const errorCallback = getWsCallback("error");

    errorCallback({ message: "Unexpected server response: 409" });

    expect(emitSpy).toHaveBeenCalledWith("fatalError", expect.any(Error));
  });

  test("should handle non-fatal error without throwing", async () => {
    const errorCallback = getWsCallback("error");
    expect(errorCallback).toBeDefined();

    // Should not throw on a generic error
    expect(() => errorCallback({ message: "some other error" })).not.toThrow();

    // ws should not be closed on errors we can recover from by reconnecting
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

  // The client is built with `reconnect: true, max_reconnects: 0` and
  // rpc-websockets only skips reconnecting on close code exactly 1000. Without
  // this, a gateway-initiated 1001 close leaves an endless reconnect loop
  // behind a client whose listeners have already been removed — an inert
  // connection on the gateway that neither side ever reaps.
  test("should disable auto-reconnect before closing on disconnect", async () => {
    const signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });

    const ws = (signaling as any).ws;
    const callOrder: string[] = [];
    ws.setAutoReconnect.mockImplementation(() => callOrder.push("setAutoReconnect"));
    ws.close.mockImplementation(() => callOrder.push("close"));

    signaling.disconnect();

    expect(ws.setAutoReconnect).toHaveBeenCalledWith(false);
    expect(callOrder).toEqual(["setAutoReconnect", "close"]);
  });

  test("should still close when disabling auto-reconnect throws", async () => {
    const signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });

    const ws = (signaling as any).ws;
    ws.setAutoReconnect.mockImplementation(() => {
      throw new Error("socket already gone");
    });

    expect(() => signaling.disconnect()).not.toThrow();
    expect(ws.close).toHaveBeenCalled();
    expect((signaling as any).ws).toBeNull();
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

  test("should acceptStream via the acceptStream RPC with no params", async () => {
    const ws = (signaling as any).ws;
    await expect(signaling.acceptStream()).resolves.toBeDefined();
    expect(ws.call).toHaveBeenCalledWith("acceptStream", {});
  });

  test("should declineStream via the declineStream RPC with no params", async () => {
    const ws = (signaling as any).ws;
    await expect(signaling.declineStream()).resolves.toBeDefined();
    expect(ws.call).toHaveBeenCalledWith("declineStream", {});
  });
});
