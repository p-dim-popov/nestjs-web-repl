// A plain application service, exposed to the REPL through the context
// object (the Express equivalent of the NestJS example's injectable).
export class CatService {
  private readonly cats = ['Tom', 'Felix'];
  findAll(): string[] {
    return this.cats;
  }
}
