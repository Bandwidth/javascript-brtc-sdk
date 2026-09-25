/**
 * @jest-environment node
 */
import { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { RpcClient, RpcTimeoutError } from "./rpcClient";

// Echo server that answers every call immediately, like the gateway's jrpc2 server.
function startServer(onMessage?: (msg: any, socket: any) => void): Promise<WebSocketServer> {
  return new Promise((resolve) => {
    const server: WebSocketServer = new WebSocketServer({ port: 0 }, () => resolve(server));
    server.on("connection", (socket) =>
      socket.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (onMessage) return onMessage(msg, socket);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { accepted: true } }));
      }),
    );
  });
}

function connect(server: WebSocketServer): Promise<RpcClient> {
  const client = new RpcClient(`ws://localhost:${(server.address() as AddressInfo).port}`, { reconnect: false });
  return new Promise((resolve) => client.on("open", () => resolve(client)));
}

// Holds back the send callback until after the reply has been processed: the
// ordering Node's TLS stack produces when the event loop stalls after a send.
function delaySendCallback(client: RpcClient) {
  const socket = (client as any).socket;
  const send = socket.send.bind(socket);
  socket.send = (data: any, opts: any, cb: (err?: Error) => void) => send(data, opts, (err?: Error) => setTimeout(() => cb(err), 50));
}

const settlesWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(
      () => "settled",
      () => "settled",
    ),
    new Promise((r) => setTimeout(() => r("pending"), ms)),
  ]);

describe("RpcClient", () => {
  let server: WebSocketServer;
  let client: RpcClient | undefined;

  afterEach(async () => {
    client?.close();
    server.clients.forEach((socket) => socket.terminate());
    await new Promise((r) => server.close(r));
  });

  test("resolves a reply that beats the send callback", async () => {
    server = await startServer();
    client = await connect(server);
    delaySendCallback(client);
    await expect(client.call("requestOutboundConnection", {})).resolves.toEqual({ accepted: true });
  });

  test("rejects when no reply arrives before the timeout", async () => {
    server = await startServer(() => {});
    client = await connect(server);
    await expect(client.call("requestOutboundConnection", {}, 100)).rejects.toThrow(
      new RpcTimeoutError('"requestOutboundConnection" reply timeout after 100ms'),
    );
  });

  test.each([null, 0])("never times out when the timeout is %p, like the stock call()", async (timeout) => {
    server = await startServer(() => {});
    client = await connect(server);
    expect(await settlesWithin(client.call("requestOutboundConnection", {}, timeout as any), 100)).toBe("pending");
    const pending: any[] = Object.values((client as any).queue);
    expect(pending).toHaveLength(1);
    expect(pending[0].timeout).toBeUndefined();
  });

  test("accepts ws options as the third argument, like the stock call()", async () => {
    server = await startServer();
    client = await connect(server);
    const send = jest.spyOn((client as any).socket, "send");
    await expect(client.call("requestOutboundConnection", {}, { binary: true })).resolves.toEqual({ accepted: true });
    expect(send).toHaveBeenCalledWith(expect.anything(), { binary: true }, expect.any(Function));
  });

  test("rejects and forgets the call when send throws synchronously", async () => {
    server = await startServer();
    client = await connect(server);
    (client as any).socket.send = () => {
      throw new Error("send failed");
    };
    await expect(client.call("requestOutboundConnection", {})).rejects.toThrow("send failed");
    expect((client as any).queue).toEqual({});
  });

  test("rejects pending calls when the socket closes, even with no listeners", async () => {
    server = await startServer((_msg, socket) => socket.close());
    client = await connect(server);
    client.removeAllListeners();
    await expect(client.call("requestOutboundConnection", {})).rejects.toThrow("websocket closed before reply");
    client = undefined; // already closed by the server
  });
});
