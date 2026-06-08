type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

const inMemoryLogs: LogEntry[] = [];
const MAX_MEMORY_LOGS = 500;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function toArray(args: any[]): { message: string; data?: any } {
  if (args.length === 0) return { message: "" };
  if (args.length === 1) return { message: String(args[0]) };
  const last = args[args.length - 1];
  if (typeof last === "object" && last !== null && !(last instanceof Error)) {
    return { message: args.slice(0, -1).map(String).join(" "), data: last };
  }
  return { message: args.map(String).join(" ") };
}

function log(level: LogLevel, context: string, ...args: any[]) {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const { message, data } = toArray(args);
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    context,
    message,
    data,
  };
  inMemoryLogs.push(entry);
  if (inMemoryLogs.length > MAX_MEMORY_LOGS) {
    inMemoryLogs.shift();
  }
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${context}]`;
  switch (level) {
    case "error":
      console.error(prefix, message, data || "");
      break;
    case "warn":
      console.warn(prefix, message, data || "");
      break;
    default:
      console.log(prefix, message, data || "");
  }
}

export const logger = {
  setLevel: (level: LogLevel) => { currentLevel = level; },
  debug: (context: string, ...args: any[]) => log("debug", context, ...args),
  info: (context: string, ...args: any[]) => log("info", context, ...args),
  warn: (context: string, ...args: any[]) => log("warn", context, ...args),
  error: (context: string, ...args: any[]) => log("error", context, ...args),
  getLogs: (): LogEntry[] => [...inMemoryLogs],
  clearLogs: () => { inMemoryLogs.length = 0; },
};
