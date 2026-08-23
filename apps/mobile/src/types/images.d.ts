// Static image assets resolve to a Metro asset id (number) at bundle time.
declare module '*.png' {
  const assetId: number;
  export default assetId;
}
