// `express4` is the `npm:express@4` alias devDependency used by
// src/repl-router.express4.spec.ts; it has the same shape as `express`.
declare module 'express4' {
  import express from 'express';
  export = express;
}
