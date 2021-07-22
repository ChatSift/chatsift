declare module '@elastic/ecs-pino-format' {
  import type { LoggerOptions } from 'pino';
  export default function ecsFormat(): LoggerOptions;
}
