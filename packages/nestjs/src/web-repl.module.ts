import { Module } from '@nestjs/common';
import { ConfigurableModuleClass } from './web-repl.module-definition';

@Module({})
export class WebReplModule extends ConfigurableModuleClass {}
