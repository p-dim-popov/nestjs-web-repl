import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { TOPICS } from './constants';

// The committed JSON Schema is the language-neutral contract (PROTOCOL.md).
// These samples are the exact shapes the engine publishes on the transport
// and writes into SSE `data:` lines; a schema that rejects any of them, or
// accepts the malformed variants, is wrong.
const schemaPath = join(__dirname, '..', '..', 'schema', 'protocol.schema.json');

describe('protocol JSON Schema (schema/protocol.schema.json)', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema, 'protocol');
  const validate = (def: string, value: unknown) => ajv.validate(`protocol#/definitions/${def}`, value);

  it('accepts the command message the origin instance publishes on webrepl:cmd', () => {
    expect(
      validate('CmdMessage', {
        channel: 'dev',
        commandId: 'cmd_1_ab12',
        command: 'get(CatService).findAll()',
        originInstanceId: 'inst_a',
      }),
    ).toBe(true);
  });

  it('rejects a command message with a missing field or a non-string command', () => {
    expect(validate('CmdMessage', { channel: 'dev', commandId: 'cmd_1', command: '1+1' })).toBe(false);
    expect(
      validate('CmdMessage', { channel: 'dev', commandId: 'cmd_1', command: 1, originInstanceId: 'a' }),
    ).toBe(false);
  });

  // Exactly what the engine emits (web-repl.service.ts emit/executeCommand,
  // onCmd's catch branch, and stream()'s heartbeat).
  const commandEvent = {
    id: 1,
    type: 'command',
    commandId: 'cmd_1_ab12',
    data: { command: 'const v = 10', instanceId: 'inst_a' },
  };
  const outputEvent = { id: 2, type: 'output', commandId: 'cmd_1_ab12', data: '10\n' };
  const doneEvent = { id: 3, type: 'system', commandId: 'cmd_1_ab12', data: { done: true } };
  const errorEvent = { id: 4, type: 'system', commandId: 'cmd_1_ab12', data: { error: 'boom' } };
  const pingEvent = { id: 0, type: 'system', commandId: null, data: { ping: true } };

  it('accepts every event variant the owner publishes on webrepl:out', () => {
    for (const event of [commandEvent, outputEvent, doneEvent, errorEvent]) {
      expect(validate('WireOutMessage', { channel: 'dev', event })).toBe(true);
    }
  });

  it('accepts a stray output chunk tagged with a null command id', () => {
    expect(validate('WireOutMessage', { channel: 'dev', event: { ...outputEvent, commandId: null } })).toBe(true);
  });

  it('rejects an event whose data does not match its type', () => {
    expect(validate('WireOutMessage', { channel: 'dev', event: { ...outputEvent, data: { chunk: 'x' } } })).toBe(false);
    expect(validate('WireOutMessage', { channel: 'dev', event: { ...commandEvent, data: { command: 'x' } } })).toBe(false);
    expect(validate('WireOutMessage', { channel: 'dev', event: { ...doneEvent, data: { done: false } } })).toBe(false);
    expect(validate('WireOutMessage', { channel: 'dev', event: { ...doneEvent, type: 'status' } })).toBe(false);
  });

  it('the heartbeat is an SSE-only event: valid in an SSE data line, never on the transport', () => {
    expect(validate('SseEvent', pingEvent)).toBe(true);
    expect(validate('WireOutMessage', { channel: 'dev', event: pingEvent })).toBe(false);
    expect(validate('TransportEvent', pingEvent)).toBe(false);
  });

  it('accepts claim and release system messages and rejects any other kind', () => {
    expect(validate('SysMessage', { channel: 'dev', kind: 'claim', instanceId: 'inst_a' })).toBe(true);
    expect(validate('SysMessage', { channel: 'dev', kind: 'release', instanceId: 'inst_a' })).toBe(true);
    expect(validate('SysMessage', { channel: 'dev', kind: 'heartbeat', instanceId: 'inst_a' })).toBe(false);
  });

  it('the Topic definition enumerates exactly the three transport topics', () => {
    for (const t of Object.values(TOPICS)) expect(validate('Topic', t)).toBe(true);
    expect(validate('Topic', 'webrepl:other')).toBe(false);
  });
});
