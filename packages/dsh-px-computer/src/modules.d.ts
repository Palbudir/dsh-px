/** Installed by the DSH plugin manager from this bundle's `dependencies`; only the entry point is used. */
declare module '@trycua/cua-driver' {
  export const CuaDriver: {
    create(options: undefined): import('./desktop').DriverLike
  }
}
