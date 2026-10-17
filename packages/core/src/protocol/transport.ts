/**
 * The pub/sub medium that carries protocol messages between the instances of
 * a cluster: in-memory for one process, Redis for many. A transport moves
 * opaque strings and never parses them (GLOSSARY.md: "Transport").
 */
export interface RemoteReplTransport {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string, handler: (message: string) => void): Promise<void>;
  /** Releases every subscription and connection; the engine calls it from `stop()`. */
  close?(): void | Promise<void>;
}
