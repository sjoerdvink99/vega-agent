import type { Config as VegaConfig } from "vega";
import type { Actor } from "./grammar/ast";
import type { ConfigSpec } from "./spec";

export type Config = {
  background: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  panel: string;
  rail: string;
  fail: string;
  actors: Record<Actor, string>;
  diverging: [string, string, string];
  font: string;
  size: number;
  advance: number;
};

export const DEFAULT_CONFIG: Config = {
  background: "#ffffff",
  ink: "#1c2027",
  muted: "#6a7280",
  faint: "#a3aab5",
  line: "#e4e7ec",
  panel: "#f4f5f7",
  rail: "#9aa2ae",
  fail: "#e5484d",
  actors: { model: "#7b61ff", tool: "#12a594", agent: "#e2a336", human: "#3e8ed0", code: "#8b95a5", _: "#6a7280" },
  diverging: ["#b35806", "#f1f2f4", "#2d6a9f"],
  font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  size: 11,
  advance: 0.6,
};

export const SMALL = 10.5;
export const TINY = 9.5;

export function configure(overrides: ConfigSpec = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides, actors: { ...DEFAULT_CONFIG.actors, ...overrides.actors } };
}

export const measure = (text: string, size: number, config: Config) => text.length * size * config.advance;

export function clip(text: string, width: number, size: number, config: Config): string {
  const room = Math.floor(width / (size * config.advance));
  if (text.length <= room) return text;
  return room > 1 ? `${text.slice(0, room - 1)}…` : "";
}

const channels = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

export function mix(from: string, to: string, t: number): string {
  const [a, b] = [channels(from), channels(to)];
  return `#${a
    .map((value, k) =>
      Math.round(value + (b[k] - value) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export const tint = (config: Config, color: string, amount: number) => mix(config.background, color, amount);

export function theme(config: Config): VegaConfig {
  const { font, ink, muted, faint, line, size } = config;
  const guide = { labelFont: font, labelColor: muted, titleFont: font, titleColor: muted, titleFontWeight: "normal" as const };
  return {
    text: { font, fontSize: size, fill: ink, baseline: "middle" },
    title: {
      font,
      fontSize: 12,
      fontWeight: 600,
      color: ink,
      anchor: "start",
      frame: "group",
      offset: 8,
      subtitleFont: font,
      subtitleFontSize: SMALL,
      subtitleColor: muted,
      subtitlePadding: 4,
    },
    axis: { ...guide, labelFontSize: TINY, domain: false, ticks: false, grid: true, gridColor: line, labelPadding: 6 },
    legend: {
      ...guide,
      layout: { top: { anchor: "end" } },
      titleLimit: 480,
      labelLimit: 240,
      labelFontSize: SMALL,
      titleFontSize: SMALL,
      symbolType: "square",
      symbolSize: 64,
      symbolStrokeWidth: 0,
      columnPadding: 14,
      gradientLength: 120,
      gradientThickness: 8,
    },
    style: {
      muted: { fill: muted, fontSize: SMALL },
      faint: { fill: faint, fontSize: SMALL },
      tick: { fill: muted, fontSize: TINY, align: "center" },
    },
  };
}
