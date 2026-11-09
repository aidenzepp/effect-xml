import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Pull from "effect/Pull";
import { Xml } from "effect/encoding";
import { XML_NAMESPACE, parseClark, splitQName } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import type { PathSegment, XmlDecodeError } from "./issue.ts";
import {
  InvalidEvent,
  UndeclaredPrefix,
  UnmappedNamespace,
  Limit,
  WellFormedness,
  XmlEncodeError,
  decodeError,
  formatMessage,
  limitParts,
  undeclaredParts,
  withPosition,
  xpath,
} from "./issue.ts";
import type { PrefixMap } from "./plan.ts";
import type { ElementStep, Position, PositionTree, PositionedEvent } from "./positions.ts";

/**
 * A start tag with Clark names, the xmlns declarations consumed, and the in-scope prefix map.
 *
 * `size` is the tag's as-written length in UTF-16 code units, upstream's `maxElementSize` formula:
 * the as-written name plus every as-written attribute key and value,
 * `xmlns` declarations included. Clark expansion never changes it.
 *
 * `position` is the start tag's source position, an own key only when the input event was a
 * `PositionedEvent`; a start resolved from a plain `Xml.Event` has no `position` key.
 */
export interface ResolvedStart {
  readonly _tag: "StartElement";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly scope: Readonly<Record<string, string>>;
  readonly size: number;
  readonly position?: Position;
}

/**
 * An end tag named with the Clark name of its start tag.
 */
export interface ResolvedEnd {
  readonly _tag: "EndElement";
  readonly name: string;
}

/**
 * A text event, unchanged from upstream.
 */
export interface ResolvedText {
  readonly _tag: "Text";
  readonly text: string;
}

/**
 * An event of the resolved stream. Declarations, doctypes, comments, and processing instructions
 * are dropped.
 */
export type ResolvedEvent = ResolvedStart | ResolvedEnd | ResolvedText;

/**
 * The resolution of an element name as written in one scope frame: its Clark name and its local
 * part, kept together so a cache hit splits nothing.
 */
interface ElementName {
  readonly name: string;
  readonly local: string;
}

/**
 * Resolved names for one scope frame, keyed by the name as written.
 *
 * Only prefixed attributes are cached: an unprefixed attribute is in no namespace, so its Clark
 * name is its name as written.
 */
interface NameCache {
  readonly elements: Map<string, ElementName>;
  readonly attributes: Map<string, string>;
}

/**
 * One open element: its prefix bindings, name cache, Clark name, as-written name and local part,
 * its index among its parent's element children, and the number of element children started under
 * it so far, which is the next child's index.
 *
 * A frame keeps the parts of its {@link ElementStep} rather than the step, so a start tag that
 * resolves allocates no step and no written-path entry; {@link pathsOf} builds both from the
 * frames when a start tag records a failure.
 */
interface Frame {
  readonly scope: Readonly<Record<string, string>>;
  readonly cache: NameCache;
  readonly name: string;
  readonly written: string;
  readonly local: string;
  readonly index: number;
  children: number;
}

/**
 * The per-run state of the channel: `push` adds output to `out` and records the first
 * failure instead of throwing. `push` accepts a plain upstream event or a `PositionedEvent`
 * and carries the latter's position onto the resolved start and its `UndeclaredPrefix` or
 * `WellFormedness` failure.
 */
interface Machine {
  out: ResolvedEvent[];
  failure: XmlDecodeError | undefined;
  push: (input: Xml.Event | PositionedEvent) => void;
}

/**
 * A consumer of the resolved stream that takes each event's fields as arguments, so a machine
 * built with one hands it every start, end, and text instead of allocating a `ResolvedEvent` and
 * adding it to `out`.
 *
 * The collector is one: {@link resolveCollect} feeds it from the machine directly.
 */
interface Sink {
  /**
   * Take a resolved start, the fields of a `ResolvedStart` but its `scope`.
   *
   * @param name - The Clark name.
   * @param attributes - The attributes keyed by Clark name, declarations consumed.
   * @param size - The as-written size stamp.
   * @param position - The start tag's source position, absent for a plain upstream event.
   */
  readonly start: (
    name: string,
    attributes: Readonly<Record<string, string>>,
    size: number,
    position: Position | undefined,
  ) => void;
  /**
   * Take the end of the innermost open element.
   */
  readonly end: () => void;
  /**
   * Take a text event.
   *
   * @param text - The text, unchanged from upstream.
   */
  readonly text: (text: string) => void;
}

/**
 * The start tag being resolved: the open frames above it (root first), its name as written, its
 * index among its parent's element children, its source position (absent for a plain upstream
 * event), and its attributes as written with their keys in order.
 */
interface Site {
  readonly stack: readonly Frame[];
  readonly written: string;
  readonly index: number;
  readonly stamp: Position | undefined;
  readonly source: Readonly<Record<string, string>>;
  readonly keys: readonly string[];
}

/**
 * Build the as-written names and the element path from the root to the element whose start
 * tag is being resolved. A start tag builds them only when it records a failure.
 *
 * @param site - The failing start tag.
 * @returns The as-written names and the element steps, root first, ending with the element's own.
 */
const pathsOf = (site: Site) => {
  const written: string[] = [];
  const elementPath: ElementStep[] = [];

  for (const frame of site.stack) {
    written.push(frame.written);
    elementPath.push({ index: frame.index, local: frame.local });
  }

  written.push(site.written);
  elementPath.push({ index: site.index, local: splitQName(site.written).local });

  return { elementPath, written };
};

/**
 * Position a failure at its start tag's source position when the tag carried one.
 *
 * @param error - The failure.
 * @param stamp - The start tag's source position, absent for a plain upstream event.
 * @returns The failure, positioned when the stamp is present.
 */
const placed = (error: XmlDecodeError, stamp: Position | undefined): XmlDecodeError =>
  stamp === undefined ? error : withPosition(error, stamp);

/**
 * Record the failure for a prefix that has no binding in scope, positioned at the start tag's
 * source position when the tag carried one.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The failing start tag.
 * @param prefix - The unbound prefix.
 * @param where - The construct that used the prefix.
 */
const undeclared = (machine: Machine, site: Site, prefix: string, where: string): void => {
  const { elementPath, written } = pathsOf(site);

  machine.failure = placed(
    decodeError({
      parts: undeclaredParts({ prefix, where }),
      path: xpath(written),
      reason: new UndeclaredPrefix({ elementPath, prefix, where }),
    }),
    site.stamp,
  );
};

/**
 * The namespace URI that only the `xmlns` prefix may name.
 */
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/**
 * A prefix-to-URI record built with `Object.fromEntries`, so that a key named `__proto__` is an
 * own property rather than a prototype assignment. The record keeps `Object.prototype`; reads go
 * through `lookup`, whose own-key check keeps inherited names such as `constructor` unbound.
 *
 * @param entries - The bindings to copy, later entries winning.
 * @returns A fresh ordinary record.
 */
const record = (
  ...entries: readonly (Readonly<Record<string, string>> | undefined)[]
): Record<string, string> =>
  Object.fromEntries(entries.flatMap((entry) => Object.entries(entry ?? {})));

/**
 * Look up a prefix among the own keys of a scope.
 *
 * @param scope - The in-scope bindings.
 * @param prefix - The prefix to read.
 * @returns The bound URI, or `undefined` when the prefix is unbound.
 */
const lookup = (scope: Readonly<Record<string, string>>, prefix: string): string | undefined =>
  Object.hasOwn(scope, prefix) ? scope[prefix] : undefined;

/**
 * Test whether an attribute key is a namespace declaration.
 *
 * @param key - The attribute key as written.
 * @returns `true` for `xmlns` and every `xmlns:` key.
 */
const isDeclaration = (key: string): boolean => key === "xmlns" || key.startsWith("xmlns:");

/**
 * Record a well-formedness failure of the namespace rules for the current element, positioned at
 * the start tag's source position when the tag carried one.
 *
 * The synthesized `Xml.XmlError` has no line or column, so the reason also carries `elementPath`,
 * built from the site, from which `decodeString` locates the element's start tag when the events
 * were unpositioned.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The failing start tag.
 * @param parts - The failing construct, the violated rule, and the repair.
 */
const illegal = (
  machine: Machine,
  site: Site,
  parts: { readonly what: string; readonly expectation: string; readonly repair: string },
): void => {
  const { elementPath, written } = pathsOf(site);
  const path = xpath(written);
  const cause = new Xml.XmlError({ kind: "Syntax", message: formatMessage({ ...parts, path }) });

  machine.failure = placed(
    decodeError({ parts, path, reason: new WellFormedness({ cause, elementPath }) }),
    site.stamp,
  );
};

/**
 * Check one namespace declaration against the reserved prefixes and URIs of Namespaces in XML 1.0.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The declaring start tag.
 * @param prefix - The declared prefix, empty for the default namespace.
 * @param uri - The declared URI.
 * @returns `true` when the declaration is legal.
 */
const checkDeclaration = (machine: Machine, site: Site, prefix: string, uri: string): boolean => {
  const attribute = prefix === "" ? "xmlns" : `xmlns:${prefix}`;
  const what = `declaration ${attribute} of <${site.written}>`;

  if (prefix === "xmlns") {
    illegal(machine, site, {
      expectation: "the xmlns prefix is reserved and cannot be declared",
      repair: "remove the declaration",
      what,
    });
  } else if (prefix !== "" && uri === "") {
    illegal(machine, site, {
      expectation: "a prefix cannot be bound to the empty namespace",
      repair: `bind ${attribute} to a namespace URI or remove the declaration`,
      what,
    });
  } else if (prefix === "xml" && uri !== XML_NAMESPACE) {
    illegal(machine, site, {
      expectation: `the xml prefix can only be bound to ${XML_NAMESPACE}`,
      repair: "remove the declaration or use that namespace",
      what,
    });
  } else if (prefix !== "xml" && (uri === XML_NAMESPACE || uri === XMLNS_NAMESPACE)) {
    illegal(machine, site, {
      expectation: `${uri} is reserved for the ${uri === XML_NAMESPACE ? "xml" : "xmlns"} prefix`,
      repair: `bind ${attribute} to a different namespace`,
      what,
    });
  }

  return machine.failure === undefined;
};

/**
 * Define one own enumerable data property on a resolved attributes record, with the result
 * `Object.fromEntries` gives.
 *
 * Plain assignment of `__proto__` calls the `Object.prototype` setter and replaces the record's
 * prototype instead of adding a key, so that key goes through `Object.defineProperty`.
 *
 * @param target - The record being built.
 * @param key - The Clark name.
 * @param value - The attribute value.
 */
const define = (target: Record<string, string>, key: string, value: string): void => {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    target[key] = value;
  }
};

/**
 * Resolve an element name as written in the scope its start tag opens, recording an
 * `UndeclaredPrefix` failure for an unbound prefix.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The start tag.
 * @param scope - The scope the start tag opens.
 * @returns The Clark name and local part, or `undefined` after a failure.
 */
const resolveElementName = (
  machine: Machine,
  site: Site,
  scope: Readonly<Record<string, string>>,
): ElementName | undefined => {
  const { written } = site;
  const colon = written.indexOf(":");

  if (colon === -1) {
    const uri = lookup(scope, "");

    return {
      local: written,
      name: uri === undefined || uri === "" ? written : `{${uri}}${written}`,
    };
  }

  const prefix = written.slice(0, colon);
  const local = written.slice(colon + 1);
  const uri = prefix === "xml" ? XML_NAMESPACE : lookup(scope, prefix);

  if (uri === undefined) {
    undeclared(machine, site, prefix, `element <${written}>`);

    return undefined;
  }

  return { local, name: `{${uri}}${local}` };
};

/**
 * Record the failure for an attribute whose expanded name an earlier attribute of the same start
 * tag already uses, naming that earlier attribute as written.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The failing start tag.
 * @param cache - The frame's name cache, which holds every earlier prefixed attribute of the tag.
 * @param key - The colliding attribute as written.
 * @param expanded - The shared Clark name.
 */
const duplicate = (
  machine: Machine,
  site: Site,
  cache: NameCache,
  key: string,
  expanded: string,
): void => {
  const first = site.keys.find(
    (other) =>
      other !== key &&
      !isDeclaration(other) &&
      (other.includes(":") ? cache.attributes.get(other) : other) === expanded,
  );

  illegal(machine, site, {
    expectation: `expands to ${expanded}, which attribute ${first ?? ""} already uses`,
    repair: "remove one attribute or bind the prefixes to different namespaces",
    what: `attribute ${key} of <${site.written}>`,
  });
};

/**
 * Expand a start tag's attributes in the scope it opens, skipping its namespace declarations,
 * and fail an unbound prefix or a duplicate expanded name.
 *
 * Two attributes can share an expanded name only when one is prefixed: unprefixed keys are
 * distinct object keys and each is its own Clark name. So the duplicate check runs on each
 * attribute from the first prefixed one on, as an own-key test on the record being built; that
 * also catches an unprefixed key spelled as a Clark name, which only a non-validating `Tokenizer`
 * can produce.
 *
 * @param machine - The machine whose first failure is recorded.
 * @param site - The start tag.
 * @param scope - The scope the tag opens.
 * @param cache - The frame's name cache, read and filled for prefixed attributes.
 * @param declares - Whether the tag declares any namespace.
 * @returns The attributes keyed by Clark name, or `undefined` after a failure.
 */
const resolveAttributes = (
  machine: Machine,
  site: Site,
  scope: Readonly<Record<string, string>>,
  cache: NameCache,
  declares: boolean,
): Record<string, string> | undefined => {
  const { keys, source } = site;
  const attributes: Record<string, string> = {};
  let prefixed = false;

  for (const key of keys) {
    if (declares && isDeclaration(key)) {
      continue;
    }

    const colon = key.indexOf(":");
    let expanded = key;

    if (colon !== -1) {
      prefixed = true;

      const hit = cache.attributes.get(key);

      if (hit === undefined) {
        const prefix = key.slice(0, colon);
        const uri = prefix === "xml" ? XML_NAMESPACE : lookup(scope, prefix);

        if (uri === undefined) {
          undeclared(machine, site, prefix, `attribute ${key} of <${site.written}>`);

          return undefined;
        }

        expanded = `{${uri}}${key.slice(colon + 1)}`;
        cache.attributes.set(key, expanded);
      } else {
        expanded = hit;
      }
    }

    if (prefixed && Object.hasOwn(attributes, expanded)) {
      duplicate(machine, site, cache, key, expanded);

      return undefined;
    }

    define(attributes, expanded, source[key] ?? "");
  }

  return attributes;
};

/**
 * Build the machine that resolves names with a stack of scope frames.
 *
 * Without a sink the machine adds each resolved event to `out`; with one it hands each event's
 * fields to the sink and `out` stays empty. Failures are recorded on the machine either way.
 *
 * @param sink - The consumer of the resolved stream, absent to collect `ResolvedEvent`s in `out`.
 * @returns A fresh machine for one run.
 */
const makeMachine = (sink?: Sink): Machine => {
  const stack: Frame[] = [];

  /**
   * Resolve one start tag: check and consume its declarations, expand its name and attributes in
   * the scope it opens, and push its frame and resolved start, or record the first failure.
   *
   * @param machine - The machine whose output and first failure the tag adds to.
   * @param event - The start tag.
   * @param stamp - The start tag's source position, absent for a plain upstream event.
   */
  const start = (machine: Machine, event: Xml.StartElement, stamp: Position | undefined): void => {
    const parent = stack.at(-1);
    const index = parent === undefined ? 0 : parent.children;

    if (parent !== undefined) {
      parent.children += 1;
    }

    const { attributes: source, name: written } = event;
    const keys = Object.keys(source);
    const site: Site = { index, keys, source, stack, stamp, written };
    let size = written.length;
    let declaredEntries: [string, string][] | undefined;

    for (const key of keys) {
      const value = source[key] ?? "";

      size += key.length + value.length;

      if (isDeclaration(key)) {
        const prefix = key === "xmlns" ? "" : key.slice(6);

        if (!checkDeclaration(machine, site, prefix, value)) {
          return;
        }

        declaredEntries ??= [];
        declaredEntries.push([prefix, value]);
      }
    }

    const scope =
      declaredEntries === undefined
        ? (parent?.scope ?? record())
        : record(parent?.scope, Object.fromEntries(declaredEntries));

    const cache: NameCache =
      declaredEntries !== undefined || parent === undefined
        ? { attributes: new Map(), elements: new Map() }
        : parent.cache;

    let element = cache.elements.get(written);

    if (element === undefined) {
      element = resolveElementName(machine, site, scope);

      if (element === undefined) {
        return;
      }

      cache.elements.set(written, element);
    }

    const attributes = resolveAttributes(
      machine,
      site,
      scope,
      cache,
      declaredEntries !== undefined,
    );

    if (attributes === undefined) {
      return;
    }

    const { local, name } = element;

    stack.push({ cache, children: 0, index, local, name, scope, written });

    if (sink !== undefined) {
      sink.start(name, attributes, size, stamp);

      return;
    }

    machine.out.push(
      stamp === undefined
        ? { _tag: "StartElement", attributes, name, scope, size }
        : // oxlint-disable-next-line sort-keys -- `position` is the last key, the order `{ ...start, position }` gives.
          { _tag: "StartElement", attributes, name, scope, size, position: stamp },
    );
  };

  const machine: Machine = {
    failure: undefined,
    out: [],
    push: (input) => {
      if (machine.failure !== undefined) {
        return;
      }

      const positioned = Predicate.hasProperty(input, "event");
      const event = positioned ? input.event : input;

      if (event._tag === "Text") {
        if (sink === undefined) {
          machine.out.push({ _tag: "Text", text: event.text });
        } else {
          sink.text(event.text);
        }
      } else if (event._tag === "EndElement") {
        const frame = stack.pop();

        if (sink === undefined) {
          machine.out.push({ _tag: "EndElement", name: frame?.name ?? event.name });
        } else {
          sink.end();
        }
      } else if (event._tag === "StartElement") {
        start(machine, event, positioned ? input.position : undefined);
      }
    },
  };

  return machine;
};

/**
 * A channel from upstream XML events to resolved events.
 *
 * `Xml.decodeString` reports names as written and treats `xmlns` as ordinary attributes;
 * nothing upstream maps prefixes to URIs. This is `makeChannel`'s shape
 * (module-private upstream, so copied rather than imported) over a machine that records its first
 * failure instead of throwing. Output produced before a failure is emitted first, and each input
 * chunk yields at most one output chunk.
 *
 * `xmlns=""` undeclares the default namespace: an unprefixed element under it is in no namespace,
 * and the scope records the empty binding. Namespaces in XML 1.0 violations (a duplicate expanded
 * attribute name, the `xmlns` prefix declared, a prefix bound to the empty URI, `xml` bound to
 * another URI, or another prefix bound to the `xml` or `xmlns` URI) fail with `WellFormedness`
 * carrying a constructed `Xml.XmlError` of kind `Syntax`, because they are well-formedness
 * constraints of that specification. Prefix lookups read own keys only.
 *
 * The input is upstream's events or the `PositionedEvent`s of `decodeStringWithPositions`,
 * told apart by the `event` property a positioned event has and an `Xml.Event` lacks. A positioned
 * start yields a `ResolvedStart` with that `position`, and an `UndeclaredPrefix` or
 * namespace-rule `WellFormedness` failure on it carries the same position through `withPosition`;
 * plain events resolve unchanged.
 *
 * No shipped decode path runs this channel: `readRoot` in `codec.ts` and `records` in
 * `channel.ts` run {@link resolveCollect}, the fused machine. This channel and {@link collect}
 * stay as the reference split that the differential tests compare `resolveCollect` against and
 * that the bench ladder times, so a behavior fix to resolution must land here and in
 * `resolveCollect` alike.
 *
 * @returns The resolving channel.
 */
export const resolveEvents = <IE, Done>(): Channel.Channel<
  Arr.NonEmptyReadonlyArray<ResolvedEvent>,
  XmlDecodeError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<Xml.Event | PositionedEvent>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (
      upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<Xml.Event | PositionedEvent>, IE, Done>,
      _scope,
    ) =>
      Effect.sync(() => {
        const machine = makeMachine();
        let done: Pull.Pull<never, never, Done> | undefined;

        const drain = (): Option.Option<Arr.NonEmptyReadonlyArray<ResolvedEvent>> => {
          const { out } = machine;

          if (Arr.isReadonlyArrayNonEmpty(out)) {
            machine.out = [];

            return Option.some(out);
          }

          return Option.none();
        };

        const step = Pull.matchEffect(upstream, {
          onDone: (value) => {
            done = Cause.done(value);

            return Effect.succeed(drain());
          },
          onFailure: Effect.failCause,
          onSuccess: (inputs) => {
            for (const input of inputs) {
              machine.push(input);
            }

            return Effect.succeed(drain());
          },
        });

        const pull: Pull.Pull<
          Arr.NonEmptyReadonlyArray<ResolvedEvent>,
          XmlDecodeError | IE,
          Done
        > = Effect.suspend(() =>
          machine.failure === undefined
            ? (done ??
              step.pipe(
                Effect.flatMap(Option.match({ onNone: () => pull, onSome: Effect.succeed })),
              ))
            : Effect.fail(machine.failure),
        );

        return pull;
      }),
  );

/**
 * An element under construction: its Clark name, resolved attributes, and children so far.
 */
interface OpenElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (OpenElement | string)[];
}

/**
 * A `PositionTree` node under construction, its children appended as their starts arrive.
 */
interface OpenTree {
  readonly position: Position;
  readonly local: string;
  readonly children: OpenTree[];
}

/**
 * The position tree of each record `collect` built from positioned events, keyed by the
 * record itself.
 *
 * The record type stays `{ name, attributes, children }`, so the tree rides beside it instead of
 * on it, and a weak key lets the tree live no longer than the record. `recordPositions` reads it;
 * the record channels drop it with {@link forgetRecordPositions} once a record has decoded.
 */
const recordTrees = new WeakMap<ResolvedElement, PositionTree>();

/**
 * The state of one collection: the elements completed so far, the first failure, and `push`,
 * which records a failure instead of throwing and ignores events after it. As a {@link Sink} it
 * takes the same events as arguments, which is how {@link resolveCollect} feeds it.
 */
interface Collector extends Sink {
  out: ResolvedElement[];
  failure: XmlDecodeError | undefined;
  readonly push: (event: ResolvedEvent) => void;
}

/**
 * The per-record budgets of `collect`. Each is a positive number or `Infinity`.
 */
interface Budgets {
  readonly maxElementSize: number;
  readonly maxElementNodes: number;
}

/**
 * The default `maxElementSize` of `collect`: 16 MiB of UTF-16 code units per record,
 * upstream's `defaultMaxElementSize`.
 */
export const defaultMaxElementSize = 16 * 1024 * 1024;

/**
 * The default `maxElementNodes` of `collect`: one million element starts and text runs per
 * record.
 *
 * A collected record retains about 152 bytes per empty element and about 157 bytes per text run
 * on Node v26.13.0, so a record at this budget retains at most about 150 MiB, within the 256 MiB
 * the budget allows (measured without `positions: true`; the bound with positions on is not
 * measured).
 */
export const defaultMaxElementNodes = 1_000_000;

/**
 * Read one budget, mirroring upstream's module-private `checkLimit`.
 *
 * @param name - The budget's option name.
 * @param value - The caller's value, absent for the default.
 * @param fallback - The default.
 * @returns The budget, a positive number or `Infinity`.
 * @throws {Error} When the budget is not a positive number; `collect` runs this when its
 *   stream starts, so a bad budget is a defect, never a decode failure.
 */
const checkLimit = (name: string, value: number | undefined, fallback: number): number => {
  const limit = value ?? fallback;

  if (!(limit > 0)) {
    throw new Error(`collect: ${name} must be positive, got ${limit}`);
  }

  return limit;
};

/**
 * Construct a collector for a root-anchored path of Clark names or `"*"`.
 *
 * Tracks match depth as upstream's module-private `Collector` does: a counter
 * of open elements and the number of leading open elements that match the path. Once a start
 * matches the whole path, descendants are part of the collected tree whatever their names.
 *
 * The record's size is the sum of its elements' `size` stamps and its text lengths, reset when a
 * record opens, as upstream's `grow` sums it,
 * so the two agree on the same input. The record's node count adds one for every element start,
 * the root included, and one for every new text child; text merged into a trailing text child
 * adds nothing, matching upstream's merge of adjacent text. Exceeding
 * either budget records a `Limit` failure whose `record` is the ordinal of the open record.
 *
 * When the record root's start carries a `position`, a parallel stack builds the record's
 * `PositionTree`: one node per element start, element children only, in document order,
 * each named by its Clark name's local part. The finished tree goes to `recordTrees`, and a
 * `Limit` failure carries the root's position. A record whose root has no stamp builds no tree,
 * and a start without a stamp inside a stamped record abandons the tree, so the stacks never
 * disagree.
 *
 * @param path - The root-anchored match path.
 * @param budgets - The per-record budgets.
 * @returns A collector whose `out` accumulates the finished elements.
 */
const makeCollector = (path: readonly string[], budgets: Budgets): Collector => {
  let depth = 0;
  let matched = 0;
  let emitted = 0;
  let size = 0;
  let nodes = 0;
  const stack: OpenElement[] = [];
  let trees: OpenTree[] | undefined;

  /**
   * Build the `Limit` failure of the open record, at `/` plus its root's local name.
   *
   * @param limit - The budget the record exceeds.
   * @param measured - The record's count under that budget.
   * @returns The failure naming the record's ordinal.
   */
  const exceeded = (limit: keyof Budgets, measured: number): XmlDecodeError => {
    const [root] = stack;
    const element = root?.name ?? "";
    const reason = { element, limit, max: budgets[limit], measured };
    const [tree] = trees ?? [];

    const error = decodeError({
      parts: limitParts(reason),
      path: xpath([{ kind: "element", name: element }]),
      reason: new Limit(reason),
      record: emitted + 1,
    });

    return tree === undefined ? error : withPosition(error, tree.position);
  };

  /**
   * Add an open start's node to the record's position tree, or abandon the tree when the start
   * has no stamp. Runs after the start's element is pushed, so the tree stack is first cut back to
   * the start's open ancestors, the nodes of closed elements dropping off as `stack` does.
   *
   * @param name - The Clark name of the start that opens an element of the record.
   * @param position - The start's source position, absent for an unstamped start.
   */
  const branch = (name: string, position: Position | undefined): void => {
    if (trees === undefined) {
      return;
    }

    if (position === undefined) {
      trees = undefined;

      return;
    }

    const tree: OpenTree = {
      children: [],
      local: parseClark(name).local,
      position,
    };

    trees.length = stack.length - 1;
    trees.at(-1)?.children.push(tree);
    trees.push(tree);
  };

  /**
   * Reset the per-record counters and start a position tree when the record root is stamped.
   *
   * @param position - The record root's source position, absent for an unstamped root.
   */
  const begin = (position: Position | undefined): void => {
    size = 0;
    nodes = 0;
    trees = position === undefined ? undefined : [];
  };

  /**
   * Keep a finished record's position tree beside it, when the record built one.
   *
   * @param element - The finished record.
   */
  const seal = (element: OpenElement): void => {
    const [tree] = trees ?? [];

    if (tree !== undefined) {
      recordTrees.set(element, tree);
    }
  };

  /**
   * Add to the open record's size and check it against `maxElementSize`.
   *
   * @param amount - A start's `size` stamp or a text run's length.
   * @returns The `Limit` failure when the record now exceeds the budget.
   */
  const grow = (amount: number): XmlDecodeError | undefined => {
    size += amount;

    return size <= budgets.maxElementSize ? undefined : exceeded("maxElementSize", size);
  };

  /**
   * Add one node to the open record and check the count against `maxElementNodes`.
   *
   * @returns The `Limit` failure when the record now exceeds the budget.
   */
  const count = (): XmlDecodeError | undefined => {
    nodes += 1;

    return nodes <= budgets.maxElementNodes ? undefined : exceeded("maxElementNodes", nodes);
  };

  const collector: Collector = {
    end: () => {
      if (collector.failure !== undefined) {
        return;
      }

      const element = stack.pop();

      if (element !== undefined && stack.length === 0) {
        seal(element);
        collector.out.push(element);
        emitted += 1;
      }

      if (matched === depth) {
        matched -= 1;
      }

      depth -= 1;
    },
    failure: undefined,
    out: [],
    push: (event) => {
      if (event._tag === "StartElement") {
        collector.start(event.name, event.attributes, event.size, event.position);
      } else if (event._tag === "EndElement") {
        collector.end();
      } else {
        collector.text(event.text);
      }
    },
    start: (name, attributes, elementSize, position) => {
      if (collector.failure !== undefined) {
        return;
      }

      const at = depth;
      depth += 1;

      if (stack.length === 0) {
        const segment = path[at];

        if (matched !== at || (segment !== "*" && segment !== name)) {
          return;
        }

        matched += 1;

        if (matched < path.length) {
          return;
        }

        begin(position);
      }

      const element: OpenElement = { attributes, children: [], name };

      stack.at(-1)?.children.push(element);
      stack.push(element);
      branch(name, position);
      collector.failure = grow(elementSize) ?? count();
    },
    text: (run) => {
      if (collector.failure !== undefined) {
        return;
      }

      const open = stack.at(-1);

      if (open === undefined || run.length === 0) {
        return;
      }

      collector.failure = grow(run.length);

      if (collector.failure !== undefined) {
        return;
      }

      const last = open.children.length - 1;
      const previous = open.children[last];

      if (Predicate.isString(previous)) {
        open.children[last] = previous + run;
      } else {
        open.children.push(run);
        collector.failure = count();
      }
    },
  };

  return collector;
};

/**
 * A channel from resolved events to the elements matching a path.
 *
 * `Xml.elements` collects unresolved names, drops ancestor scope, and has no node budget;
 * this collects Clark-named `ResolvedElement`s from the resolved
 * stream. `path` is root-anchored: each element whose ancestors and own name match the path,
 * segment by segment, is emitted once its end tag arrives, and nested matches stay inside the outer
 * tree. A segment is a Clark name or `"*"`. Text is kept as string children with adjacent text
 * merged, including whitespace-only runs. The machine is `resolveEvents`' shape: each input chunk
 * yields at most one output chunk, and records completed before a failure in the same chunk are
 * emitted before it.
 *
 * `Xml.elements` has a `maxElementSize` but counts unresolved events, so the budget is
 * re-implemented here with upstream's formula: the as-written `size` stamp `resolveEvents`
 * puts on each start plus every text length, per record, so `maxElementSize` gives the same
 * number as `Xml.elements` for the same input. A record over the budget fails with
 * `XmlDecodeError` reason `Limit`, at `/` plus the record root's local name, with `record` the
 * record's ordinal. `maxElementNodes` counts element starts plus text runs per record, a text run
 * counted when it opens a new text child. A budget that is not a positive number is a defect
 * when the stream starts.
 *
 * Upstream events carry no position and `Xml.elements` keeps none, so when the input starts carry
 * `resolveEvents`' `position` stamps the collector builds each record's `PositionTree`
 * beside it, read back through `recordPositions`, and a `Limit` carries the record root's
 * position. Plain input builds no tree.
 *
 * No shipped decode path runs this channel: `readRoot` in `codec.ts` and `records` in
 * `channel.ts` run {@link resolveCollect}, the fused machine. {@link resolveEvents} and this
 * channel stay as the reference split that the differential tests compare `resolveCollect`
 * against and that the bench ladder times, so a behavior fix to collection must land here and in
 * `resolveCollect` alike.
 *
 * @param path - The root-anchored list of Clark names or `"*"`.
 * @param limits - The per-record budgets: `maxElementSize` (default
 *   `defaultMaxElementSize`) and `maxElementNodes` (default
 *   `defaultMaxElementNodes`); `Infinity` disables either.
 * @returns The collecting channel.
 */
export const collect = <IE, Done>(
  path: readonly string[],
  limits?: { readonly maxElementSize?: number; readonly maxElementNodes?: number },
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<ResolvedElement>,
  XmlDecodeError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<ResolvedEvent>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<ResolvedEvent>, IE, Done>, _scope) =>
      Effect.sync(() => {
        const collector = makeCollector(path, {
          maxElementNodes: checkLimit(
            "maxElementNodes",
            limits?.maxElementNodes,
            defaultMaxElementNodes,
          ),
          maxElementSize: checkLimit(
            "maxElementSize",
            limits?.maxElementSize,
            defaultMaxElementSize,
          ),
        });

        let done: Pull.Pull<never, never, Done> | undefined;

        const drain = (): Option.Option<Arr.NonEmptyReadonlyArray<ResolvedElement>> => {
          const { out } = collector;

          if (Arr.isReadonlyArrayNonEmpty(out)) {
            collector.out = [];

            return Option.some(out);
          }

          return Option.none();
        };

        const step = Pull.matchEffect(upstream, {
          onDone: (value) => {
            done = Cause.done(value);

            return Effect.succeed(drain());
          },
          onFailure: Effect.failCause,
          onSuccess: (inputs) => {
            for (const input of inputs) {
              collector.push(input);
            }

            return Effect.succeed(drain());
          },
        });

        const pull: Pull.Pull<
          Arr.NonEmptyReadonlyArray<ResolvedElement>,
          XmlDecodeError | IE,
          Done
        > = Effect.suspend(() =>
          collector.failure === undefined
            ? (done ??
              step.pipe(
                Effect.flatMap(Option.match({ onNone: () => pull, onSome: Effect.succeed })),
              ))
            : Effect.fail(collector.failure),
        );

        return pull;
      }),
  );

/**
 * A channel from upstream XML events to the elements matching a path: `resolveEvents` piped into
 * `collect`, fused into one machine.
 *
 * The resolving machine hands each start, end, and text straight to the collector as a
 * {@link Sink}, so no `ResolvedEvent` and no intermediate chunk is allocated. Records, position
 * trees, `Limit` budgets, and every failure are those of the two channels piped: each input chunk
 * yields at most one output chunk, the loop stops at the first failure of either part so the
 * earlier event's failure wins, and records completed before it are emitted first. A budget that
 * is not a positive number is a defect when the stream starts.
 *
 * @param path - The root-anchored list of Clark names or `"*"`.
 * @param limits - The per-record budgets, as `collect` takes them.
 * @returns The resolving and collecting channel.
 */
export const resolveCollect = <IE, Done>(
  path: readonly string[],
  limits?: { readonly maxElementSize?: number; readonly maxElementNodes?: number },
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<ResolvedElement>,
  XmlDecodeError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<Xml.Event | PositionedEvent>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (
      upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<Xml.Event | PositionedEvent>, IE, Done>,
      _scope,
    ) =>
      Effect.sync(() => {
        const collector = makeCollector(path, {
          maxElementNodes: checkLimit(
            "maxElementNodes",
            limits?.maxElementNodes,
            defaultMaxElementNodes,
          ),
          maxElementSize: checkLimit(
            "maxElementSize",
            limits?.maxElementSize,
            defaultMaxElementSize,
          ),
        });

        const machine = makeMachine(collector);
        let done: Pull.Pull<never, never, Done> | undefined;

        const drain = (): Option.Option<Arr.NonEmptyReadonlyArray<ResolvedElement>> => {
          const { out } = collector;

          if (Arr.isReadonlyArrayNonEmpty(out)) {
            collector.out = [];

            return Option.some(out);
          }

          return Option.none();
        };

        const step = Pull.matchEffect(upstream, {
          onDone: (value) => {
            done = Cause.done(value);

            return Effect.succeed(drain());
          },
          onFailure: Effect.failCause,
          onSuccess: (inputs) => {
            for (const input of inputs) {
              machine.push(input);

              if (collector.failure !== undefined || machine.failure !== undefined) {
                break;
              }
            }

            return Effect.succeed(drain());
          },
        });

        const pull: Pull.Pull<
          Arr.NonEmptyReadonlyArray<ResolvedElement>,
          XmlDecodeError | IE,
          Done
        > = Effect.suspend(() => {
          const failure = collector.failure ?? machine.failure;

          return failure === undefined
            ? (done ??
                step.pipe(
                  Effect.flatMap(Option.match({ onNone: () => pull, onSome: Effect.succeed })),
                ))
            : Effect.fail(failure);
        });

        return pull;
      }),
  );

/**
 * Read the position tree of a record `collect` built from positioned events.
 *
 * The tree is the input of `positionAt`: step 0 is the record root, and each
 * element child sits at its zero-based element-children index, so a failure's `ElementPath` inside
 * the record maps to its start tag's position.
 *
 * @param element - A record `collect` emitted.
 * @returns The record's tree, or `Option.none()` for a record collected from plain events.
 */
export const recordPositions = (element: ResolvedElement): Option.Option<PositionTree> =>
  Option.fromUndefinedOr(recordTrees.get(element));

/**
 * Drop the position tree of a record whose decode has finished, so the tree dies with the record
 * instead of at the next full collection.
 *
 * `recordTrees` is module-level, so its table lives in V8's old generation, and an entry keeps its
 * tree alive through the young-generation collection after the record itself became garbage. Trees
 * that survive young collections that way lead V8 to pretenure their allocation site, so every
 * positioned record's tree then lands in the old generation and stays there as garbage until a
 * mark-compact: about 10 MiB per run of the positioned record stream on Node at `bank-4m`
 * (`docs/rd/perf3b-spikes/stream-heap.md`).
 *
 * @param element - A record `collect` emitted whose position tree no reader needs again.
 */
export const forgetRecordPositions = (element: ResolvedElement): void => {
  recordTrees.delete(element);
};

/**
 * Encoding options for `toEvents`.
 */
export interface ToEventsOptions {
  readonly prefixes: PrefixMap;
  readonly declaration?: boolean;
}

/**
 * Choose the prefix that spells a namespace among the in-scope bindings.
 *
 * @param scope - The in-scope prefix bindings.
 * @param namespace - The namespace to spell.
 * @param isAttribute - Whether the name is an attribute, which never uses the default prefix.
 * @returns The prefix, `""` for the default namespace, or `undefined` when none is usable.
 */
export const prefixFor = (
  scope: PrefixMap,
  namespace: string,
  isAttribute: boolean,
): string | undefined => {
  if (namespace === XML_NAMESPACE) {
    return "xml";
  }

  return Object.keys(scope).find(
    (prefix) => scope[prefix] === namespace && (prefix !== "" || !isAttribute),
  );
};

/**
 * Spell a Clark name as written with an in-scope prefix.
 *
 * @param scope - The in-scope prefix bindings.
 * @param clarkName - The Clark name to spell.
 * @param isAttribute - Whether the name is an attribute.
 * @returns The qualified name, or `undefined` when an attribute's namespace has no usable prefix.
 */
export const spell = (
  scope: PrefixMap,
  clarkName: string,
  isAttribute: boolean,
): string | undefined => {
  const { local, namespace } = parseClark(clarkName);

  if (Option.isNone(namespace)) {
    return local;
  }

  const prefix = prefixFor(scope, namespace.value, isAttribute);

  if (prefix === undefined || prefix === "") {
    return isAttribute ? undefined : local;
  }

  return `${prefix}:${local}`;
};

/**
 * Choose the declaration an element needs to be spelled, if any.
 *
 * Reuse an in-scope prefix bound to the element's namespace; else declare the map's prefix for it;
 * else declare it as the default namespace; an element in no namespace under a default binding
 * declares `xmlns=""`.
 *
 * @param scope - The bindings in effect for the element, after any root declarations.
 * @param map - The definition's prefix map.
 * @param clarkName - The element's Clark name.
 * @returns The prefix to bind (`""` for the default) and its URI, or `undefined` when none is
 *   needed.
 */
export const declarationFor = (
  scope: PrefixMap,
  map: PrefixMap,
  clarkName: string,
): { readonly prefix: string; readonly uri: string } | undefined => {
  const { namespace } = parseClark(clarkName);

  if (Option.isNone(namespace)) {
    return (scope[""] ?? "") === "" ? undefined : { prefix: "", uri: "" };
  }

  if (prefixFor(scope, namespace.value, false) !== undefined) {
    return undefined;
  }

  const mapped = Object.keys(map).find(
    (prefix) => prefix !== "" && map[prefix] === namespace.value,
  );

  return { prefix: mapped ?? "", uri: namespace.value };
};

/**
 * Build the encode failure for an attribute that cannot be written.
 *
 * @param path - The segments from the root to the element that carries the attribute.
 * @param reason - The failing construct, rule, and repair, plus the reason to record.
 * @returns The failure, located at the element's Clark path.
 */
const encodeFailure = (
  path: readonly PathSegment[],
  reason: {
    readonly what: string;
    readonly expectation: string;
    readonly repair: string;
    readonly tag: UnmappedNamespace | InvalidEvent;
  },
): XmlEncodeError => {
  const located = xpath(path);

  return new XmlEncodeError({
    message: formatMessage({ ...reason, path: located }),
    path: located,
    reason: reason.tag,
  });
};

/**
 * Spell an element's attributes, rejecting any that cannot be written faithfully.
 *
 * Fails with `UnmappedNamespace` for a namespaced attribute no prefix spells, and with
 * `InvalidEvent` (the closest existing encode reason, which carries a syntax `Xml.XmlError`) for an
 * attribute spelled `xmlns` or `xmlns:*`, which would override a namespace declaration, and for two
 * attributes spelled to the same qualified name.
 *
 * @param path - The segments from the root to this element.
 * @param scope - The bindings in effect for the element.
 * @param element - The element whose attributes are spelled.
 * @returns The spelled attributes, or the first failure.
 */
export const spellAttributes = (
  path: readonly PathSegment[],
  scope: PrefixMap,
  element: ResolvedElement,
): Record<string, string> | XmlEncodeError => {
  const spelled: Record<string, string> = {};

  const invalid = (what: string, expectation: string, repair: string): XmlEncodeError =>
    encodeFailure(path, {
      expectation,
      repair,
      tag: new InvalidEvent({
        cause: new Xml.XmlError({ kind: "Syntax", message: `${what}: ${expectation}` }),
      }),
      what,
    });

  for (const [key, value] of Object.entries(element.attributes)) {
    const name = spell(scope, key, true);

    if (name === undefined) {
      const { local, namespace } = parseClark(key);
      const uri = Option.getOrElse(namespace, () => "");

      return encodeFailure(path, {
        expectation: `no prefix is bound to namespace ${uri}`,
        repair: "add a prefix for it to the definition's namespaces map",
        tag: new UnmappedNamespace({ namespace: uri, what: `attribute ${local}` }),
        what: `attribute ${local}`,
      });
    }

    if (name === "xmlns" || name.startsWith("xmlns:")) {
      return invalid(
        `attribute ${name}`,
        "an attribute may not be spelled as a namespace declaration",
        "rename the attribute; declare namespaces through the definition's namespaces map",
      );
    }

    if (Object.hasOwn(spelled, name)) {
      return invalid(
        `attribute ${name}`,
        "two attributes spell to the same qualified name",
        "remove one of them or give them different names",
      );
    }

    spelled[name] = value;
  }

  return spelled;
};

/**
 * Walk one element depth-first, appending its events.
 *
 * @param out - The events produced so far.
 * @param scope - The bindings in effect for the parent; a child's own bindings never leak back.
 * @param element - The element to walk.
 * @param map - The definition's prefix map.
 * @param declarations - The map bindings to declare here, present on the root only.
 * @param parents - The segments of the ancestors, root first.
 * @returns The first failure, or `undefined` when the whole subtree was written.
 */
const walk = (
  out: Xml.Event[],
  scope: PrefixMap,
  element: ResolvedElement,
  map: PrefixMap,
  declarations: PrefixMap,
  parents: readonly PathSegment[],
): XmlEncodeError | undefined => {
  const rooted: PrefixMap = { ...scope, ...declarations };
  const needed = declarationFor(rooted, map, element.name);
  const added = needed === undefined ? {} : { [needed.prefix]: needed.uri };
  const bindings = record(declarations, added);
  const own = record(rooted, added);
  const path: readonly PathSegment[] = [...parents, { kind: "element", name: element.name }];

  const declared = Object.fromEntries(
    Object.entries(bindings).map(([prefix, uri]) => [
      prefix === "" ? "xmlns" : `xmlns:${prefix}`,
      uri,
    ]),
  );

  const name = spell(own, element.name, false) ?? element.name;
  const spelled = spellAttributes(path, own, element);

  if (spelled instanceof XmlEncodeError) {
    return spelled;
  }

  out.push({ _tag: "StartElement", attributes: { ...declared, ...spelled }, name });

  for (const child of element.children) {
    if (Predicate.isString(child)) {
      out.push({ _tag: "Text", text: child });
    } else {
      const failure = walk(out, own, child, map, {}, path);

      if (failure !== undefined) {
        return failure;
      }
    }
  }

  out.push({ _tag: "EndElement", name });

  return undefined;
};

/**
 * Walk a resolved tree into upstream events, choosing prefixes.
 *
 * Upstream's `Writer` writes names as given and knows nothing of namespaces, so
 * this spells each Clark name with a prefix in scope. The root declares the whole map as `xmlns`
 * and `xmlns:p` attributes; an element whose namespace has no usable prefix declares one on itself
 * (the map's prefix, else the default namespace), and a no-namespace element under a default
 * binding declares `xmlns=""`; attributes never take the default prefix; the XML namespace spells
 * `xml:`. Fails with `XmlEncodeError` for an attribute namespace no prefix spells, an attribute
 * spelled `xmlns`/`xmlns:*`, or two attributes spelled alike (see `spellAttributes`). A
 * `Declaration` event leads unless `declaration` is `false`.
 *
 * @param element - The root of the tree.
 * @param options - The prefix map and whether to lead with a declaration (default `true`).
 * @returns An effect yielding the events in document order.
 */
export const toEvents = (
  element: ResolvedElement,
  options: ToEventsOptions,
): Effect.Effect<readonly Xml.Event[], XmlEncodeError> =>
  Effect.suspend(() => {
    const out: Xml.Event[] =
      options.declaration === false
        ? []
        : // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- plan lock 9 fixes the declaration as encoding="UTF-8"; this is XML text, not a Node encoding name.
          [{ _tag: "Declaration", encoding: "UTF-8", version: "1.0" }];

    const failure = walk(out, {}, element, options.prefixes, options.prefixes, []);

    return failure === undefined ? Effect.succeed(out) : Effect.fail(failure);
  });
