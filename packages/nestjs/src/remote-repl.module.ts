import { Module } from '@nestjs/common';
import { ConfigurableModuleClass } from './remote-repl.module-definition';

@Module({})
export class RemoteReplModule extends ConfigurableModuleClass {}
