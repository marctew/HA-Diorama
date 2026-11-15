// Where the decoder for compressed models is fetched from.

/** The `draco` folder beside the frontend's entry files, given the address
 * of any of the frontend's own files (an entry file, or a chunk). */
export function decoderPath(moduleUrl: string): string {
  return `${moduleUrl.replace(/(chunks\/)?[^/]*$/, "")}draco/`;
}
