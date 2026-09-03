/**
 * A local endpoint that answers `eth_chainId` and nothing else.
 *
 * `assertChainMatches` is the one network call this project makes before it
 * trusts its own configuration, and the thing worth testing about it is what
 * happens when an endpoint answers with a DIFFERENT chain — a proxy repointed
 * after the URL was written down, or a Galileo endpoint that has been reset
 * onto a new chain id, which has happened twice. That needs an endpoint that
 * lies, which no public RPC will do on request.
 *
 * It is deliberately not a chain: it cannot quote, cannot fill and cannot sign,
 * so no test built on it can send anything anywhere.
 */
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";

export interface StubRpc {
  url: string;
  close: () => Promise<void>;
}

export async function startStubRpc(chainId: number): Promise<StubRpc> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const payload: unknown = body === "" ? {} : JSON.parse(body);
      const answer = (call: unknown): unknown => ({
        jsonrpc: "2.0",
        id: (call as {id?: number}).id ?? 0,
        result: `0x${chainId.toString(16)}`,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(payload) ? payload.map(answer) : answer(payload)));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the stub RPC did not bind to a port");
  }
  const {port} = address as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

/** A URL nothing is listening on, for the "the endpoint never answered" path. */
export async function closedPortUrl(): Promise<string> {
  const stub = await startStubRpc(1);
  await stub.close();
  return stub.url;
}
