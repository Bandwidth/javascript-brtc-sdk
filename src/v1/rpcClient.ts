import { Client } from "rpc-websockets";

/**
 * Upper bound on how long any gateway RPC waits for its reply. Generous on
 * purpose: requestOutboundConnection is expected to block on the gateway for up
 * to ~30s once it waits for the application's accept/deny.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 45000;

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
 * This version registers the call before sending, always applies a reply
 * timeout, and fails every pending call when the socket closes: the gateway
 * handles each connection independently, so a reply can never arrive on a
 * reconnected socket.
 */
export class RpcClient extends Client {
  call(method: string, params?: object, timeout: number = DEFAULT_CALL_TIMEOUT_MS, ws_opts?: object): Promise<unknown> {
    // The fields below are private in rpc-websockets' typings but are what its
    // own message handler resolves replies against.
    const self = this as any;
    return new Promise((resolve, reject) => {
      if (!self.ready) return reject(new Error("socket not ready"));
      const rpc_id = self.generate_request_id(method, params);
      self.queue[rpc_id] = {
        promise: [resolve, reject],
        timeout: setTimeout(() => {
          delete self.queue[rpc_id];
          reject(new Error(`"${method}" reply timeout after ${timeout}ms`));
        }, timeout),
      };
      const message = { jsonrpc: "2.0", method, params: params || undefined, id: rpc_id };
      self.socket.send(self.dataPack.encode(message), ws_opts, (error?: Error) => {
        if (!error || !self.queue[rpc_id]) return;
        clearTimeout(self.queue[rpc_id].timeout);
        delete self.queue[rpc_id];
        reject(error);
      });
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
