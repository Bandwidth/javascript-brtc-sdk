import { Client } from "rpc-websockets";

/**
 * Upper bound on how long any gateway RPC waits for its reply. It must stay
 * above the longest the gateway may hold a call open: requestOutboundConnection
 * is planned to block for up to ~30s waiting for the application's accept/deny,
 * then reply with a deny. If the gateway ever holds a call longer, raise this
 * too, or the client gives up on a call the gateway goes on to complete.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 45000;

/** Rejection for a call whose reply did not arrive within its timeout. */
export class RpcTimeoutError extends Error {}

/**
 * rpc-websockets' Client with call() fixed to never lose a reply.
 *
 * The stock call() registers the pending call only inside the socket's send
 * callback. Under Node over TLS that callback is deferred to setImmediate, so if
 * the event loop stalls for a few milliseconds after the send (GC, busy timers)
 * the gateway's reply is read first, finds no pending entry, and is silently
 * dropped; the entry is registered afterwards and the promise never settles.
 * This is still the case in the latest rpc-websockets release.
 *
 * This version registers the call before sending, applies a reply timeout by
 * default, and fails every pending call when the socket closes: the gateway
 * handles each connection independently, so a reply can never arrive on a
 * reconnected socket.
 */
export class RpcClient extends Client {
  /**
   * Same signature as the stock call(): ws_opts may be passed as the third
   * argument, and a falsy timeout (null, 0) means no timeout.
   */
  call(method: string, params?: object, timeout: number | object | null = DEFAULT_CALL_TIMEOUT_MS, ws_opts?: object): Promise<unknown> {
    if (!ws_opts && typeof timeout === "object" && timeout !== null) {
      ws_opts = timeout;
      timeout = DEFAULT_CALL_TIMEOUT_MS;
    }
    const replyTimeout = timeout as number | null;
    // The fields below are private in rpc-websockets' typings but are what its
    // own message handler resolves replies against.
    const self = this as any;
    return new Promise((resolve, reject) => {
      if (!self.ready) return reject(new Error("socket not ready"));
      const rpc_id = self.generate_request_id(method, params);
      const fail = (error: Error) => {
        if (!self.queue[rpc_id]) return;
        clearTimeout(self.queue[rpc_id].timeout);
        delete self.queue[rpc_id];
        reject(error);
      };
      self.queue[rpc_id] = { promise: [resolve, reject] };
      if (replyTimeout) {
        self.queue[rpc_id].timeout = setTimeout(() => fail(new RpcTimeoutError(`"${method}" reply timeout after ${replyTimeout}ms`)), replyTimeout);
      }
      try {
        const message = { jsonrpc: "2.0", method, params: params || undefined, id: rpc_id };
        self.socket.send(self.dataPack.encode(message), ws_opts, (error?: Error) => error && fail(error));
      } catch (error) {
        fail(error as Error);
      }
    });
  }

  // Hooked here rather than via on("close") so it survives removeAllListeners().
  emit<T extends string | symbol>(event: T, ...args: any[]): boolean {
    if (event === "close") this.failPendingCalls(new Error("websocket closed before reply"));
    return super.emit(event, ...args);
  }

  private failPendingCalls(error: Error) {
    const queue = (this as any).queue;
    for (const id of Object.keys(queue)) {
      const pending = queue[id];
      delete queue[id];
      clearTimeout(pending.timeout);
      pending.promise[1](error);
    }
  }
}
