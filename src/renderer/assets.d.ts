/** Font files are inlined into the bundle as data URLs (esbuild `dataurl` loader). */
declare module '*.woff2' {
  const url: string;
  export default url;
}
