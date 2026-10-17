import express from 'express';
import { createRemoteReplRouter } from './repl-router';
import { describeReplRouter } from '../test/repl-router.suite';

// Express 5 leg (the devDependency). The Express 4 leg is
// repl-router.express4.spec.ts; both run ../test/repl-router.suite.ts.
describeReplRouter('express 5', express, createRemoteReplRouter, 5);
