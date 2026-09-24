/**
 * @jest-environment node
 */
// Exercises the real rpc-websockets client (no mock) against a local server, because
// the bug only shows up with the library's real ordering: it clears its socket and
// "ready" flag synchronously on close, then emits "close" on the next tick.
import { AddressInfo } from "net";
import { Server } from "rpc-websockets";
import Signaling from "./signaling";
import { DiagnosticsBatcher } from "./diagnostics";
import logger from "../logging";

describe("Signaling server-initiated close", () => {
  let server: Server;

  beforeEach(async () => {
    server = new Server({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.on("listening", resolve));
    server.register("setMediaPreferences", () => ({}));
  });

  afterEach(async () => {
    await server.close();
  });

  test("tears down without logging errors when the server closes the socket", async () => {
    const errorSpy = jest.spyOn(logger, "error");
    const port = (server.wss.address() as AddressInfo).port;
    server.on("connection", (socket: any) => {
      socket.send(JSON.stringify({ notification: "ready", params: { endpointId: "e-test" } }));
      // Close the way the gateway does when the endpoint is deleted.
      setTimeout(() => socket.close(1000), 50);
    });

    const batcher = new DiagnosticsBatcher();
    const signaling = new Signaling(batcher);
    await signaling.connect({ endpointToken: "t" }, { websocketUrl: `ws://127.0.0.1:${port}` });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect((signaling as any).ws).toBeNull();
    expect((signaling as any).isReady).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("disconnect() cancels a reconnect already scheduled after a 1001 close", async () => {
    const port = (server.wss.address() as AddressInfo).port;
    let connections = 0;
    server.on("connection", (socket: any) => {
      connections++;
      socket.send(JSON.stringify({ notification: "ready", params: { endpointId: "e-test" } }));
      if (connections === 1) {
        setTimeout(() => socket.close(1001), 50);
      }
    });

    const signaling = new Signaling(new DiagnosticsBatcher());
    await signaling.connect({ endpointToken: "t" }, { websocketUrl: `ws://127.0.0.1:${port}` });
    await new Promise((resolve) => setTimeout(resolve, 100));
    signaling.disconnect();

    // Past rpc-websockets' default 1s reconnect interval.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(connections).toBe(1);
  });
});
