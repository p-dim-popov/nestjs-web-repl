export type SseEventType = 'command' | 'output' | 'system';

export interface WebReplEvent {
  id: number;
  type: SseEventType;
  commandId: string | null;
  data: unknown;
}

export interface CmdMessage {
  channel: string;
  commandId: string;
  command: string;
  originInstanceId: string;
}

export interface OutMessage {
  channel: string;
  event: WebReplEvent;
}

export interface SysMessage {
  channel: string;
  kind: 'claim' | 'release';
  instanceId: string;
}
