import pino from "pino";
import type { Config } from "./config.js";

export type Logger = pino.Logger;

export const createLogger = (level: Config["logLevel"]): Logger => pino({ level });
