/**
 * Nothing, which is what this slot shows almost always.
 *
 * A parallel slot with no match renders its default, so without this the shell would 404 on every
 * page that is not a document.
 */
export default function Default() {
  return null;
}
