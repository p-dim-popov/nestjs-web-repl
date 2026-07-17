export interface WebReplAdapter {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string, handler: (message: string) => void): Promise<void>;
  onModuleDestroy?(): void | Promise<void>;
}
