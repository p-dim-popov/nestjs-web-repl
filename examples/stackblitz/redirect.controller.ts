import { Controller, Get, Redirect } from '@nestjs/common';

// Sends the StackBlitz preview (which opens at "/") to the package's landing
// route, which picks a random channel and redirects to its UI — so a visitor
// lands on the editor and sees the landing redirect in action.
@Controller()
export class RedirectController {
  @Get()
  @Redirect('/repl', 302)
  toRepl(): void {}
}
