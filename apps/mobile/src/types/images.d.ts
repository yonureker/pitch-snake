// Static image assets resolve to a Metro asset id (number) at bundle time.
declare module '*.png' {
  const assetId: number;
  export default assetId;
}
// Audio ships the same way: the crowd tape is a bundled asset id.
declare module '*.m4a' {
  const assetId: number;
  export default assetId;
}
