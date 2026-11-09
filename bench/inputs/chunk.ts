/**
 * Splitting a document's text into the fixed-size chunks the stream class feeds one at a time.
 */

/**
 * The chunk size in UTF-16 code units, recorded in every results file's method.
 */
export const chunkBytes = 65_536;

// Native: `effect/String` has `slice` and separator-based `split` only, and `Array.chunksOf` needs the text copied into an array of code units first; neither slices a string into fixed-size pieces.
/**
 * Split text into consecutive slices of at most `size` UTF-16 code units.
 *
 * A surrogate pair may straddle two slices; the upstream text decoder buffers across chunks, so
 * the split is invisible to it, and the slices always join back to `text`.
 *
 * @param text - The document text to split.
 * @param size - The slice length in UTF-16 code units.
 * @returns The slices in order; empty text yields no slices.
 */
export const chunk = (text: string, size: number = chunkBytes): readonly string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );
