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
// Sound effects ship as bundled asset ids too (assets/sfx/*.wav).
declare module '*.wav' {
  const assetId: number;
  export default assetId;
}
