import express from 'express';
import { createRemoteReplRouter } from './repl-router';
import { describeReplRouter } from '../test/repl-router.suite';

// Express 4 leg of the peer range `^4.16 || ^5`. `express4` is the alias
// devDependency `npm:express@4`; mocking `express` to it makes the router
// module itself resolve Express 4 (its `Router`/`json`), exactly as it would
// inside a consumer that installed Express 4.
vi.mock('express', async () => vi.importActual('express4'));

describeReplRouter('express 4', express, createRemoteReplRouter, 4);
