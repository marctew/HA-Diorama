// Ids are made by the client: lowercase letters, digits and underscores, at
// most 32 characters (the server checks).

export type MakeId = (prefix: string) => string;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A new id such as "w_k3f9x2ab". Collisions within one floor are not a
 * practical concern: 36^8 possibilities. */
export const newId: MakeId = (prefix) => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${id}`;
};
