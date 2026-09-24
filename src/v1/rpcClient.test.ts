/**
 * @jest-environment node
 */
import { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { Client } from "rpc-websockets";
import { RpcClient } from "./rpcClient";

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

function connect(ClientType: typeof Client, server: WebSocketServer): Promise<Client> {
  const client = new ClientType(`ws://localhost:${(server.address() as AddressInfo).port}`, { reconnect: false });
  return new Promise((resolve) => client.on("open", () => resolve(client)));
}

// Holds back the send callback until after the reply has been processed: the
// ordering Node's TLS stack produces when the event loop stalls after a send.
function delaySendCallback(client: Client) {
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
  let client: Client | undefined;

  afterEach(async () => {
    client?.close();
    server.clients.forEach((socket) => socket.terminate());
    await new Promise((r) => server.close(r));
  });

  test("stock rpc-websockets loses a reply that beats the send callback", async () => {
    server = await startServer();
    client = await connect(Client, server);
    delaySendCallback(client);
    expect(await settlesWithin(client.call("requestOutboundConnection", {}), 300)).toBe("pending");
  });

  test("resolves a reply that beats the send callback", async () => {
    server = await startServer();
    client = await connect(RpcClient, server);
    delaySendCallback(client);
    await expect(client.call("requestOutboundConnection", {})).resolves.toEqual({ accepted: true });
  });

  test("rejects when no reply arrives before the timeout", async () => {
    server = await startServer(() => {});
    client = await connect(RpcClient, server);
    await expect(client.call("requestOutboundConnection", {}, 100)).rejects.toThrow('"requestOutboundConnection" reply timeout after 100ms');
  });

  test("rejects pending calls when the socket closes, even with no listeners", async () => {
    server = await startServer((_msg, socket) => socket.close());
    client = await connect(RpcClient, server);
    client.removeAllListeners();
    await expect(client.call("requestOutboundConnection", {})).rejects.toThrow("websocket closed before reply");
    client = undefined; // already closed by the server
  });
});
