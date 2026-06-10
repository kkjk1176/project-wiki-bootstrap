"use strict";

function parseJsonlLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        const wrapped = new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
      }
    });
}

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function usageFromEvent(event) {
  if (event && typeof event === "object" && event.usage && typeof event.usage === "object") {
    return event.usage;
  }
  if (event && typeof event === "object" && event.message && event.message.usage && typeof event.message.usage === "object") {
    return event.message.usage;
  }
  return null;
}

function eventType(event) {
  if (!event || typeof event !== "object") return "unknown";
  if (typeof event.type === "string") return event.type;
  if (typeof event.event === "string") return event.event;
  return "unknown";
}

function classifyEvent(event) {
  const type = eventType(event).toLowerCase();
  const name = typeof event?.name === "string" ? event.name.toLowerCase() : "";
  const itemType = typeof event?.item?.type === "string" ? event.item.type.toLowerCase() : "";
  const toolName = typeof event?.tool === "string" ? event.tool.toLowerCase() : "";
  const combined = [type, name, itemType, toolName].filter(Boolean).join(" ");

  return {
    isTurn: Boolean(usageFromEvent(event)) || combined.includes("turn"),
    isCommand: combined.includes("command") || combined.includes("exec") || combined.includes("shell"),
    isTool: combined.includes("tool") || combined.includes("function_call"),
    isMcp: combined.includes("mcp"),
    isFileChange: combined.includes("file_change") || combined.includes("patch") || combined.includes("apply_patch"),
    isError: combined.includes("error") || event?.error,
  };
}

function mergeUsage(target, usage) {
  target.input_tokens += numberValue(usage.input_tokens);
  target.cached_input_tokens += numberValue(usage.cached_input_tokens);
  target.output_tokens += numberValue(usage.output_tokens);
  target.reasoning_output_tokens += numberValue(usage.reasoning_output_tokens);
  target.total_tokens += numberValue(usage.total_tokens);
}

function summarizeEvents(events, timing = {}) {
  const metrics = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    wall_ms: numberValue(timing.wall_ms),
    tokens_per_second: 0,
    codex_turn_count: 0,
    jsonl_event_count: events.length,
    command_event_count: 0,
    tool_event_count: 0,
    mcp_event_count: 0,
    file_change_event_count: 0,
    error_event_count: 0,
    unavailable_event_fields: [],
  };

  for (const event of events) {
    const usage = usageFromEvent(event);
    if (usage) {
      metrics.codex_turn_count += 1;
      mergeUsage(metrics, usage);
    }

    const classification = classifyEvent(event);
    if (classification.isCommand) metrics.command_event_count += 1;
    if (classification.isTool) metrics.tool_event_count += 1;
    if (classification.isMcp) metrics.mcp_event_count += 1;
    if (classification.isFileChange) metrics.file_change_event_count += 1;
    if (classification.isError) metrics.error_event_count += 1;
  }

  if (metrics.total_tokens === 0) {
    metrics.total_tokens = metrics.input_tokens + metrics.output_tokens + metrics.reasoning_output_tokens;
  }

  if (metrics.wall_ms > 0) {
    metrics.tokens_per_second = Math.round((metrics.output_tokens / (metrics.wall_ms / 1000)) * 1000) / 1000;
  }

  if (events.length > 0 && metrics.command_event_count === 0) {
    metrics.unavailable_event_fields.push("command_event_count");
  }
  if (events.length > 0 && metrics.mcp_event_count === 0) {
    metrics.unavailable_event_fields.push("mcp_event_count");
  }
  if (events.length > 0 && !events.some((event) => usageFromEvent(event))) {
    metrics.unavailable_event_fields.push("usage");
  }

  return metrics;
}

function summarizeJsonl(content, timing = {}) {
  return summarizeEvents(parseJsonlLines(content), timing);
}

module.exports = {
  classifyEvent,
  parseJsonlLines,
  summarizeEvents,
  summarizeJsonl,
};
