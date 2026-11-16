import type { Level } from "./grammar/abstract";
import type { Actor } from "./grammar/ast";

export type Expression = string;
export type Color = string;
export type Count = number;
export type Size = number;
export type Width = Size | "container";
export type Name = string;

export interface ConfigSpec {
  background?: Color;
  ink?: Color;
  muted?: Color;
  faint?: Color;
  line?: Color;
  panel?: Color;
  rail?: Color;
  fail?: Color;
  actors?: Partial<Record<Actor, Color>>;
  diverging?: [Color, Color, Color];
  font?: string;
  size?: Size;
  advance?: Size;
}

export interface Base {
  $schema?: string;
  title?: string;
  width?: Width;
  legend?: boolean;
  config?: ConfigSpec;
}

export type Field =
  | "actor"
  | "count"
  | "difference"
  | "duration"
  | "end"
  | "ending"
  | "failed"
  | "from"
  | "longest"
  | "matching"
  | "median"
  | "rate"
  | "run"
  | "runs"
  | "share"
  | "spread"
  | "start"
  | "step"
  | "steps";

export type Tooltip = boolean | (Field | { field: Field; title?: string })[];

export type Ids = string[];

export interface Param {
  name: Name;
  select: "click" | "hover";
  value?: Ids;
}

export interface ParamRef {
  param: Name;
}

export interface UnitBase extends Base {
  params?: Param[];
  highlight?: Expression | ParamRef;
  tooltip?: Tooltip;
}

export interface DiagramSpec extends UnitBase {
  mark: "diagram";
  process: Expression;
  fold?: boolean;
  key?: boolean;
}

export type Interval = [number, number] | null;

export type Format = "runs" | "otel" | "openai_agents" | "langsmith" | "langfuse" | "messages" | "codex" | "claude_code" | "atif" | "swe_agent" | "openhands";

export interface InlineData {
  values: unknown[];
  format?: Format;
}

export interface UrlData {
  url: string;
  format?: Format;
}

export type Data = InlineData | UrlData;

export type FieldName = string;

export type TimeUnit = "s" | "ms" | "us" | "ns";

export interface ActorChannel {
  field: FieldName;
  map?: Record<string, Expression | null>;
}

export interface FailedChannel {
  field: FieldName;
  equal: string | number | boolean;
}

export interface TimeChannel {
  field: FieldName;
  unit: TimeUnit;
}

export interface GroupChannel {
  field: FieldName;
  order: string[];
}

export interface Mapping {
  group?: FieldName | GroupChannel;
  run?: FieldName;
  step?: FieldName;
  parent?: FieldName;
  actor?: FieldName | ActorChannel;
  name?: FieldName;
  failed?: FieldName | FailedChannel;
  start?: FieldName | TimeChannel;
  end?: FieldName | TimeChannel;
}

export type StepMapping = Mapping & { actor: FieldName | ActorChannel };

export type Scalar = string | number | boolean;

export interface EqualPredicate {
  field: FieldName;
  equal: Scalar;
}

export interface OneOfPredicate {
  field: FieldName;
  oneOf: Scalar[];
}

export interface RangePredicate {
  field: FieldName;
  range: [number | null, number | null];
}

export interface ValidPredicate {
  field: FieldName;
  valid: boolean;
}

export interface AndPredicate {
  and: Predicate[];
}

export interface OrPredicate {
  or: Predicate[];
}

export interface NotPredicate {
  not: Predicate;
}

export type Predicate = EqualPredicate | OneOfPredicate | RangePredicate | ValidPredicate | AndPredicate | OrPredicate | NotPredicate;

export interface FilterTransform {
  filter: Predicate;
}

export type Transform = FilterTransform;

export interface Sourced {
  data?: Data;
  transform?: Transform[];
  trace?: Mapping;
}

export interface TimelineSpec extends UnitBase, Sourced {
  mark: "timeline";
  filter?: ParamRef;
  lanes?: "step" | "agent";
}

export interface HandoffsSpec extends UnitBase, Sourced {
  mark: "handoffs";
  filter?: ParamRef;
}

export interface CorpusSpec extends UnitBase, Sourced {
  filter?: ParamRef;
}

export interface LeveledSpec extends CorpusSpec {
  level?: Level;
}

export interface IcicleSpec extends LeveledSpec {
  mark: "icicle";
  focus?: string[];
  height?: Size;
}

export interface VariantsSpec extends LeveledSpec {
  mark: "variants";
  limit?: Count;
}

export interface TransitionsSpec extends LeveledSpec {
  mark: "transitions";
  limit?: Count;
}

export interface GraphSpec extends LeveledSpec {
  mark: "graph";
  limit?: Count;
}

export interface SankeySpec extends LeveledSpec {
  mark: "sankey";
  limit?: Count;
  height?: Size;
}

export interface ActivitiesSpec extends LeveledSpec {
  mark: "activities";
  limit?: Count;
}

export interface SequencesSpec extends CorpusSpec {
  mark: "sequences";
  limit?: Count;
  x?: "step" | "time";
}

export type Measure = "steps" | "failures" | "duration";

export interface DistributionSpec extends CorpusSpec {
  mark: "distribution";
  measure?: Measure;
}

export interface DurationsSpec extends LeveledSpec {
  mark: "durations";
  limit?: Count;
}

export interface ProjectionSpec extends LeveledSpec {
  mark: "projection";
  height?: Size;
}

export type UnitSpec =
  | DiagramSpec
  | TimelineSpec
  | HandoffsSpec
  | IcicleSpec
  | VariantsSpec
  | TransitionsSpec
  | GraphSpec
  | SankeySpec
  | ActivitiesSpec
  | SequencesSpec
  | DistributionSpec
  | DurationsSpec
  | ProjectionSpec;

export type Views = [UnitSpec, ...UnitSpec[]];

export interface VConcatSpec extends Base, Sourced {
  vconcat: Views;
}

export interface HConcatSpec extends Base, Sourced {
  hconcat: Views;
}

export type Panel<U = UnitSpec> = U extends DiagramSpec ? never : U extends UnitSpec ? Omit<U, keyof Sourced> : never;

export interface Facet {
  field: FieldName;
  columns?: Count;
}

export interface FacetSpec extends Base, Sourced {
  facet: Facet;
  spec: Panel;
}

export type Spec = UnitSpec | VConcatSpec | HConcatSpec | FacetSpec;
