import { Injectable } from '@nestjs/common';

// Holds state so the REPL can show that provider state persists between
// commands (get(CounterService).inc() climbs each run).
@Injectable()
export class CounterService {
  private count = 0;
  inc(): number {
    return ++this.count;
  }
}
