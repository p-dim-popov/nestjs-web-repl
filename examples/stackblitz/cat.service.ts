import { Injectable } from '@nestjs/common';

@Injectable()
export class CatService {
  private readonly cats = ['Tom', 'Felix'];
  findAll(): string[] {
    return this.cats;
  }
}
