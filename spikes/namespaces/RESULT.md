# SPIKE-02 result: namespace resolution

Throwaway spike. Nothing here is library code. Run: `bun test spikes/namespaces`.

## Question

`branches/namespaces.md`: should a definition name elements and attributes by expanded name, resolved at decode from the in-scope `xmlns` map (A, with C's schema-side prefix map as the naming and encode convenience), or by the prefix as written (B)? Where do `xml:lang`, `xsi:schemaLocation`, and `xsi:type` get their meaning? The separating case is `bpig-mathml.xml`, which re-binds the default namespace to MathML on an inner `<math>` without changing any prefix.

## Approaches compared

- **A, `resolver.ts`.** `resolve(xml)` folds the upstream event stream (`Xml.decodeString` → `Stream.runFoldEffect`) with a scope stack. Every element becomes `{ name: { namespace, local }, attributes, children }`; attributes are keyed by the same expansion in Clark notation (`{uri}local`, or `local` for no namespace); `xmlns` and `xmlns:*` are consumed and not exposed; `xml:` is always bound; an undeclared prefix fails with `UndeclaredPrefix` carrying the XML path. `encode(map, tree)` re-spells the tree from a declared prefix map, emits every declaration on the root, and hands the events to `Xml.encodeString`; a namespace the map lacks fails with `UnmappedNamespace`. **C as a naming convenience:** `qname(map)("m:math")` translates a schema key through the same map, so definitions can be written with prefixes while matching by URI.
- **B, `literal.ts`.** `Xml.elements([root])` gives the upstream tree; `findLiteral` matches qualified names as written. `xmlns*` stay ordinary attributes.

Variants written under this directory: `fixtures/bpig-mathml-reprefixed.xml` (`xsi`→`xs`, `m`→`mml`, inner `<math xmlns=…>` re-spelled as `<mml:math>` with `mml:` children) and `fixtures/imsmanifest-reprefixed.xml` (default namespace moved to a `cp:` prefix on every element, `imsmd`→`lom`, `imsqti`→`qm`, `xsi`→`xs`). A third variant is built in the test by deleting the inner `xmlns` on `<math>`, which keeps every spelling and changes the vocabulary.

## Per-criterion scores

Evidence is a test name in `namespaces.test.ts` (line numbers from the committed file) or a command with pasted output below. 14 tests, 54 `expect` calls, 0 failures.

| #                  | Criterion                         | A                                                                                                                                                                                                                                                                                                                                                                                        | B                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1                 | One definition, both directions   | **4.** One `PrefixMap` value serves decode-side naming (`qname`) and the encode prefix table (`encode`); the resolved tree is the single model in both directions ("encode with a declared prefix map, then decode: same resolved tree", l.135; "C variant…", l.185). Not 5: the spike has no codec definition over the tree, so the claim covers the namespace layer only.              | **5** on the measure as written: the upstream `Element` is the one value and `Xml.encodeString` passes names through ("decodes both fixtures with names as written", l.205). Disqualified anyway by the C4 gate.                                                                                                                                               |
| C4                 | Namespace correctness (gate)      | **5.** Decode succeeds on both fixtures (l.55, l.76); both re-prefixed copies decode `toEqual` the originals ("C4 check 2", l.101); unprefixed attributes stay in no namespace under a default declaration, including `language="en"` on `imsmd:string` ("C4 check 3", l.106). The re-binding case: `<math>` resolves to MathML, and deleting the inner `xmlns` moves it to QTI (l.128). | **0.** Re-prefixed `bpig-mathml` has no `math` under the literal path, only `mml:math`; re-prefixed manifest is not even found by `Xml.elements(["manifest"])` and `imsmd:lom` is absent ("C4 check 2 fails", l.215). Two documents in different vocabularies compare equal once the `xmlns` attribute is dropped (l.229). Prefix spelling changes the result. |
| C5                 | Round-trip guarantee honesty      | **3.** Promise written below; resolved-tree equality after `encode → resolve` is green on both fixtures and the re-prefixed manifest encodes byte-identically to the original's encoding (l.135). The SPIKE-03 canonical comparator was not run here (not landed at spike time; copying an uncommitted sibling was out of scope).                                                        | **2.** Promise is trivially "spelling preserved"; the upstream round trip is not byte-identical (substrate map §1.1); comparator not run.                                                                                                                                                                                                                      |
| C9                 | Code outside Effect primitives    | **3.** `resolver.ts` is 233 non-blank, non-comment lines: 148 for the resolver fold (scope stack, name split, attribute expansion, tree assembly, two errors) and 85 for `qname`, the prefix chooser and the encoder spelling. Every piece is justified below. Over 200, so not 5.                                                                                                       | **5.** `literal.ts` is 22 lines, all of it a path lookup over the upstream tree.                                                                                                                                                                                                                                                                               |
| C10                | Error quality (undeclared prefix) | **3.** Path and expectation, no position: `undeclared namespace prefix "foo" on element <foo:bar> at /qti-assessment-item/qti-item-body/foo:bar; declare xmlns:foo on this element or an ancestor` (l.162); also raised for an attribute prefix. `Xml.Event` carries no line or column (`Xml.ts:133-137`), so the resolver cannot report one.                                            | **0.** No error at all: the upstream parser treats colons as name characters and accepts `<foo:bar/>` with no declaration (l.162, last assertion).                                                                                                                                                                                                             |
| C2, C3, C6, C7, C8 | n/a (not touched by this spike)   | n/a                                                                                                                                                                                                                                                                                                                                                                                      | n/a                                                                                                                                                                                                                                                                                                                                                            |

Weighted totals over the scored criteria (weight 51): **A 188 / 255**, **B 131 / 255 and disqualified** by the C4 gate.

### Pasted runs

`bun test spikes/namespaces`:

```text
bun test v1.4.2 (744846f84)

 14 pass
 0 fail
 54 expect() calls
Ran 14 tests across 1 file. [57.00ms]
```

Type check. The plan's command needed two additions under the pinned TypeScript 7.0.2: `--ignoreConfig` (tsc refuses file arguments while a `tsconfig.json` is present, TS5112) and `--allowImportingTsExtensions` (the test imports `./resolver.ts` and `./literal.ts` by extension, as Bun resolves them). Output was empty:

```sh
$ bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig --allowImportingTsExtensions spikes/namespaces/*.ts
$ echo $?
0
```

`bun x vp fmt --check spikes/namespaces`: `All matched files use the correct format.`

Line counts (`grep -cvE '^\s*(//.*)?$'`): `resolver.ts` 233 (148 before the `// Approach C` marker, 85 after), `literal.ts` 22, `namespaces.test.ts` 224.

### Code outside Effect primitives, piece by piece (effect-design rule)

| Piece                                                      | Effect API checked                                                                       | Requirement it misses                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope stack, `splitQName`, element and attribute expansion | `Xml.decodeString` (`Xml.ts:334-344`), `Xml.StartElement` (`:133-137`)                   | Names are reported as written; `xmlns` is an ordinary attribute (`Xml.ts:301-302`). No namespace resolution exists anywhere in `effect/encoding/Xml`.                            |
| Tree assembly inside `step`                                | `Xml.elements` / `Collector` (`Xml.ts:438-460`, `:1723-1789`)                            | `elements` matches and emits by qualified name with no hook to rewrite names mid-walk. The fold itself is `Stream.runFoldEffect`; only the frame push/pop is custom (~30 lines). |
| `UndeclaredPrefix`, `UnmappedNamespace`                    | `Schema.TaggedError` (the installed guide's error form); `Xml.XmlError` (`Xml.ts:51-64`) | `XmlError` is upstream's own error; the resolver reports a condition upstream does not detect, so it needs its own tag.                                                          |
| `qname`, `prefixFor`, `spell`, `toEvents`                  | `Xml.encodeString` / `Writer` (`Xml.ts:511-518`, `:1869-2037`)                           | The writer passes prefixed names and `xmlns:*` through unchanged; it has no prefix table and emits no declarations.                                                              |

## Deciding evidence

1. `bpig-mathml.xml` separates the approaches without any prefix variation: the inner `<math xmlns="…MathML">` is spelled exactly like a QTI `<math>` would be. A resolves it to MathML and sees the vocabulary change when the declaration is removed (l.128); B produces equal trees for the two documents once the `xmlns` attribute is ignored (l.229). The fixture is now a synthetic item written for this repository (it replaced a published example on 2026-11-09), but it keeps that example's construct: an unprefixed `<math>` that re-binds the default namespace, which QTI 3 permits. The "corpus never varies prefixes" half of the ledger's reversal condition therefore still does not rescue B.
2. Both re-prefixed copies decode under A to values `toEqual` the originals (l.101), and the re-prefixed manifest encodes byte-identically to the original's encoding (l.135): prefixes are not data.
3. Resolver cost is 148 lines for the decode side; the whole file is 233. That is above the C9 "under 200" bar, so the cost half of the reversal condition is met, but the correctness gate decides.

## Not implemented

- A codec or schema definition over the resolved tree; C1 is scored on the namespace layer only.
- `xsi:type` dispatch. The in-scope map is available to the resolver at attribute time (`Frame.scope`) and is the right place for a QName-valued attribute codec to read from, but nothing exposes it yet.
- Elements in no namespace under a default declaration (`xmlns=""`) on encode; the fixtures never need it (`spell` comment).
- Automatic prefix generation for namespaces missing from the map; `encode` fails instead (l.155).
- Per-subtree `xmlns` placement on encode; all declarations go on the root. Prefix memory for round-trip-stable spelling.
- The SPIKE-03 canonical comparator; equality is Bun's `toEqual` on the resolved tree.
- Positions on the undeclared-prefix error (events carry none).

**Round-trip promise for A, as implemented.** After `resolve → encode(map) → resolve`, the resolved tree is equal (names by URI, attributes by expanded name, text in document order with adjacent runs merged). Not preserved: prefix spelling, where `xmlns` declarations sit, comments and processing instructions (dropped, and text runs they split are merged, as upstream `Element` does), attribute-value whitespace (upstream normalizes literal line breaks to spaces per XML §3.3.3, `Xml.ts:122`, `:730`, so `xsi:schemaLocation` loses its line breaks on the first decode), self-closing tags, CDATA, quote style.

## Recommendation

Keep ledger D2: resolve to expanded names at decode (A), with C's schema-side prefix map as the authoring key and the encode prefix table. `xml:lang` and `xsi:schemaLocation` are ordinary namespaced attributes and need no special casing beyond the always-bound `xml` prefix (l.66). Unprefixed attributes are in no namespace (l.106). `xsi:type` should receive the element's in-scope map through a resolution context handed to attribute codecs. B is disqualified by the C4 gate on a real fixture and also accepts namespace-invalid input silently (C10 = 0). No ledger call reversed.

## Open questions

1. Attribute keys: this spike keys attributes by a Clark string because a `Record` cannot be keyed by a `{ namespace, local }` object. The plan says "keyed the same way"; a `ReadonlyMap<Name, string>` would need a value-equality map (`HashMap` with `Equal`), which is the design question for the real model.
2. Where the resolver lives: an alternative is to run `Xml.elements` and resolve post hoc over the upstream tree, since `Element` keeps `xmlns` attributes. It would remove the ~30 lines of tree assembly but ties resolution to the tree path (SPIKE-04) and loses the event boundary where positions would attach (SPIKE-07). The event walk was chosen for that reason; not measured.
3. Error positions: `Xml.Event` has no line or column, so a resolver-side error can only name the path. SPIKE-07 decides whether the library tracks positions itself.
4. Attribute whitespace normalization (`xsi:schemaLocation`) is a round-trip exclusion the SPIKE-03 promise must list.
5. The plan's `tsc` command does not run as written under TypeScript 7.0.2 (`--ignoreConfig`) and does not accept `.ts` relative imports (`--allowImportingTsExtensions`); recorded here, not fixed in the plan.
6. The resolver is above the C9 "under 200" bar at 233 lines. Whether the encoder's prefix chooser (85 lines) belongs to this layer or to the round-trip layer changes the count.
