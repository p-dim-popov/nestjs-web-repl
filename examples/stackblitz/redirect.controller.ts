import { Controller, Get, Redirect } from '@nestjs/common';

// Sends the StackBlitz preview (which opens at "/") straight to the live
// REPL UI, so a visitor lands on the editor instead of a blank root.
@Controller()
export class RedirectController {
  @Get()
  @Redirect('/repl/dev/ui', 302)
  toRepl(): void {}
}
