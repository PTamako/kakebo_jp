// OCR uses the original image. This creates a separate, device-only reference copy.
// iOS WebKit may return PNG when asked for WebP, so JPEG is an explicit fallback.
export async function compressReceiptImage(file, maxEdge = 1200, maxBytes = 200 * 1024) {
  if (!file || !(file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name))) throw new Error('画像ファイルを選択してください')
  let bitmap
  let image
  let objectUrl
  try {
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(file) } catch { /* iOS HEIC fallback below */ }
    }
    if (!bitmap) {
      objectUrl = URL.createObjectURL(file)
      image = new Image()
      image.src = objectUrl
      await image.decode()
    }
    const width = bitmap?.width || image.naturalWidth
    const height = bitmap?.height || image.naturalHeight
    if (!width || !height) throw new Error('画像を開けません')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画像を処理できません')
    const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality))
    const edges = [...new Set([maxEdge, 1100, 1000, 900, 800, 700, 600, 500, 400, 320, 240, 160])]
    for (const edge of edges) {
      const scale = Math.min(1, edge / Math.max(width, height))
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap || image, 0, 0, canvas.width, canvas.height)
      for (const type of ['image/webp', 'image/jpeg']) {
        for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
          const blob = await encode(type, quality)
          // Safari can silently substitute PNG: only accept the actual output format.
          if (blob && ['image/webp', 'image/jpeg'].includes(blob.type) && blob.size > 0 && blob.size <= maxBytes) return blob
          if (blob?.type !== type) break
        }
      }
    }
    throw new Error('端末で画像を保存用サイズに変換できませんでした')
  } finally {
    bitmap?.close?.()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
